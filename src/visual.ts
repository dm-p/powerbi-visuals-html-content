// Power BI API Dependencies
import './../style/visual.less';
import 'overlayscrollbars/css/OverlayScrollbars.css';
import 'w3-css/w3.css';
import powerbi from 'powerbi-visuals-api';
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import {
    interactivitySelectionService,
    interactivityBaseService
} from 'powerbi-visuals-utils-interactivityutils';
import IInteractivityService = interactivityBaseService.IInteractivityService;
import SelectableDataPoint = interactivitySelectionService.SelectableDataPoint;
import { FormattingSettingsService } from 'powerbi-visuals-utils-formattingmodel';

// External dependencies
import OverlayScrollbars from 'overlayscrollbars';
import { select, Selection } from 'd3-selection';

// Internal Dependencies
import { VisualFormattingSettingsModel } from './visual-settings';
import { VisualConstants } from './visual-constants';
import { ViewModelHandler, IHtmlEntry, IViewModel } from './view-model';
import {
    bindVisualDataToDom,
    getParsedHtmlAsDom,
    reconcileVisualDataToDom,
    resolveForRawHtml,
    resolveHtmlGroupElement,
    resolveHyperlinkHandling,
    resolveScrollableContent,
    resolveStyling,
    resolveHover,
    stampRenderedContent
} from './domain-utils';
import LandingPageHandler from './landing-page-handler';
import { BehaviorManager, IHtmlBehaviorOptions } from './behavior';
import { RenderFormat } from './types';
import { RenderOrchestrator, RenderSteps } from './render-orchestrator';

export class Visual implements IVisual {
    // The root element for the entire visual
    private container: Selection<HTMLDivElement, any, any, any>;
    // Used for displaying landing page
    private landingContainer: Selection<HTMLDivElement, any, any, any>;
    // Used for handling issues in the visual
    private statusContainer: Selection<HTMLDivElement, any, any, any>;
    // Used for HTML content from data model
    private contentContainer: Selection<HTMLDivElement, any, any, any>;
    // Visual host services
    private host: IVisualHost;
    // Parsed visual settings
    private formattingSettings: VisualFormattingSettingsModel;
    // Formatting settings service
    private formattingSettingsService: FormattingSettingsService;
    // Handle rendering events
    private events: IVisualEventService;
    // Handle localisation of visual text
    private localisationManager: ILocalizationManager;
    // Visual view model
    private viewModelHandler: ViewModelHandler;
    // Handles landing page
    private landingPageHandler: LandingPageHandler;
    // Manages custom styling from the user
    private styleSheetContainer: Selection<HTMLStyleElement, any, any, any>;
    // Interactivity for data points
    private interactivity: IInteractivityService<SelectableDataPoint>;
    // Behavior of data points
    private behavior: BehaviorManager<SelectableDataPoint>;
    // Flag whether the user clicked into the visual or not (for focus management)
    private bodyFocusedWithClick = false;
    // Drives rendering decisions (rebuild vs reconcile vs viewport-only)
    private orchestrator: RenderOrchestrator;
    // Cached OverlayScrollbars instance (reused across updates to preserve scroll position)
    private scrollbars: OverlayScrollbars | undefined;
    // The rendered data element selection, carried from rebuild/reconcile to bindInteractivity.
    // Assigned in rebuild/reconcile before bindInteractivity is ever called; the non-null
    // assertion (!) tells the compiler the field is set before use.
    private dataElements!: Selection<HTMLDivElement, IHtmlEntry, any, any>;

    // Runs when the visual is initialised
    constructor(options: VisualConstructorOptions) {
        this.container = select(options.element)
            .append('div')
            .attr('id', VisualConstants.dom.viewerIdSelector);
        this.host = options.host;
        this.viewModelHandler = new ViewModelHandler();
        this.localisationManager = this.host.createLocalizationManager();
        this.interactivity =
            interactivitySelectionService.createInteractivitySelectionService(
                this.host
            );
        this.behavior = new BehaviorManager();
        this.styleSheetContainer = select('head')
            .append('style')
            .attr('id', VisualConstants.dom.stylesheetIdSelector)
            .attr('name', VisualConstants.dom.stylesheetIdSelector)
            .attr('type', 'text/css');
        this.landingContainer = this.container
            .append('div')
            .attr('id', VisualConstants.dom.landingIdSelector);
        this.statusContainer = this.container
            .append('div')
            .attr('id', VisualConstants.dom.statusIdSelector);
        this.contentContainer = this.container
            .append('div')
            .attr('tabindex', 0)
            .attr('id', VisualConstants.dom.contentIdSelector);
        this.formattingSettingsService = new FormattingSettingsService(
            this.localisationManager
        );
        this.landingPageHandler = new LandingPageHandler(
            this.landingContainer,
            this.localisationManager
        );
        this.bindFocusEvents();
        this.events = this.host.eventService;
        this.viewModelHandler.reset();
        this.orchestrator = new RenderOrchestrator(this.buildRenderSteps());
    }

    /**
     * Returns properties pane formatting model content hierarchies, properties and latest formatting values, Then populate properties pane.
     * This method is called once every time we open properties pane or when the user edit any format property.
     */
    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(
            this.formattingSettings
        );
    }

    /**
     * Runs when data roles added or something changes
     */
    public update(options: VisualUpdateOptions) {
        const { viewModel } = this.viewModelHandler;
        this.formattingSettings =
            this.formattingSettingsService.populateFormattingSettingsModel(
                VisualFormattingSettingsModel,
                options.dataViews?.[0]
            );

        try {
            this.events.renderingStarted(options);
            if (
                powerbi.VisualUpdateType.Data ===
                (options.type & powerbi.VisualUpdateType.Data)
            ) {
                this.updateStatus(
                    this.localisationManager.getDisplayName(
                        'Status_Mapping_DataView'
                    )
                );
                this.viewModelHandler.validateDataView(options.dataViews);
                viewModel.isValid &&
                    this.viewModelHandler.mapDataView(
                        options.dataViews,
                        this.formattingSettings,
                        this.host
                    );
                this.updateStatus();
            }
            this.formattingSettings.handlePropertyVisibility(viewModel);
            this.landingPageHandler.handleLandingPage(
                viewModel.isValid,
                this.host
            );
            if (!viewModel.isValid) {
                throw new Error('View model mapping error');
            }
            this.orchestrator.render(
                options,
                viewModel,
                this.formattingSettings,
                this.host
            );
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, e);
            this.contentContainer.selectAll('*').remove();
            this.updateStatus();
        }
    }

    /**
     * Build the RenderSteps closures that the orchestrator dispatches to.
     * All closures capture `this` and faithfully reproduce the behaviour of
     * the old inline update() body, now split by render path.
     */
    private buildRenderSteps(): RenderSteps {
        return {
            // Runs every update: container-level styling and scroll (reusing
            // the cached OverlayScrollbars instance so a reconcile preserves
            // scroll position). Hyperlink binding is content-dependent and
            // runs after each render step instead.
            resolveContainer: (settings) => {
                resolveStyling(
                    this.styleSheetContainer,
                    this.container,
                    settings
                );
                this.scrollbars = resolveScrollableContent(
                    this.container.node() as HTMLDivElement,
                    this.scrollbars
                );
            },
            // No-data message or raw-HTML textarea. Clears content first (state-kind reset).
            renderEmptyOrRaw: (viewModel, settings) => {
                this.contentContainer.selectAll('*').remove();
                const behavior =
                    settings.contentFormatting.contentFormattingCardBehavior;
                if (viewModel.isEmpty) {
                    this.updateStatus(
                        settings.contentFormatting.contentFormattingCardNoData
                            .noDataMessage.value,
                        behavior.showRawHtml.value
                    );
                } else {
                    // populated content but showRawHtml is on: render entries then
                    // replace with the raw view (resolveForRawHtml wipes+adds textarea)
                    const dataElements = bindVisualDataToDom(
                        this.contentContainer,
                        viewModel.htmlEntries,
                        viewModel.hasSelection
                    );
                    resolveHtmlGroupElement(
                        dataElements,
                        behavior.format.value as RenderFormat,
                        behavior.hyperlinks.value
                    );
                    resolveForRawHtml(
                        this.styleSheetContainer,
                        this.contentContainer,
                        settings
                    );
                }
                resolveHyperlinkHandling(
                    this.host,
                    this.container,
                    behavior.hyperlinks.value
                );
            },
            // Full rebuild: wipe, bind all, render all, stamp baseline.
            rebuild: (viewModel, settings) => {
                const behavior =
                    settings.contentFormatting.contentFormattingCardBehavior;
                this.updateStatus();
                this.contentContainer.selectAll('*').remove();
                const merged = bindVisualDataToDom(
                    this.contentContainer,
                    viewModel.htmlEntries,
                    viewModel.hasSelection
                ) as Selection<HTMLDivElement, IHtmlEntry, any, any>;
                resolveHtmlGroupElement(
                    merged,
                    behavior.format.value as RenderFormat,
                    behavior.hyperlinks.value
                );
                stampRenderedContent(merged);
                this.finalizePopulatedRender(merged, viewModel, settings);
            },
            // Reconcile: keep unchanged nodes, render ONLY the changed/entered subset.
            reconcile: (viewModel, settings) => {
                const behavior =
                    settings.contentFormatting.contentFormattingCardBehavior;
                this.updateStatus();
                const { merged, toRender } = reconcileVisualDataToDom(
                    this.contentContainer,
                    viewModel.htmlEntries,
                    viewModel.hasSelection
                );
                // CONTRACT (per reconcileVisualDataToDom): render the ENTIRE toRender.
                resolveHtmlGroupElement(
                    toRender,
                    behavior.format.value as RenderFormat,
                    behavior.hyperlinks.value
                );
                this.finalizePopulatedRender(merged, viewModel, settings);
            },
            bindInteractivity: (viewModel) => {
                if (this.host.hostCapabilities.allowInteractions) {
                    this.interactivity.bind(<
                        IHtmlBehaviorOptions<SelectableDataPoint>
                    >{
                        behavior: this.behavior,
                        dataPoints: viewModel.htmlEntries,
                        clearCatcherSelection: this.container,
                        pointSelection: this.dataElements,
                        viewModel
                    });
                }
            }
        };
    }

    /**
     * Shared finalisation for the populated render paths (rebuild + reconcile):
     * apply the raw-HTML view if enabled, capture the rendered selection for
     * interactivity binding, wire hover/tooltips, and (re)bind hyperlink click
     * delegation onto the freshly rendered anchors. Hyperlink binding MUST run
     * after content render — resolveHyperlinkHandling selects existing <a>
     * elements, so newly appended anchors only get their click guard here.
     */
    private finalizePopulatedRender(
        merged: Selection<HTMLDivElement, IHtmlEntry, any, any>,
        viewModel: IViewModel,
        settings: VisualFormattingSettingsModel
    ): void {
        resolveForRawHtml(
            this.styleSheetContainer,
            this.contentContainer,
            settings
        );
        this.dataElements = merged;
        resolveHover(merged, this.host, viewModel.hasGranularity);
        resolveHyperlinkHandling(
            this.host,
            this.container,
            settings.contentFormatting.contentFormattingCardBehavior.hyperlinks
                .value
        );
    }

    /**
     * Ensure that when the user navigates to the visual using Power BI-supported keyboard shortcuts, the visual is focused accordingly. If
     * the user clicks on the body of the page, we should behave as normal.
     */
    private bindFocusEvents() {
        document.body.onmousedown = () => {
            this.bodyFocusedWithClick = true;
        };
        document.body.onfocus = () => {
            if (!this.bodyFocusedWithClick) {
                this.contentContainer.node().focus();
            }
            this.bodyFocusedWithClick = false;
        };
    }

    /**
     * Generic function to manage update of text within status container.
     *
     * @param message       - Simple message to display. Omit to remove current content.
     * @param showRawHtml   - Flag to confirm whether we should show Raw HTML or not
     */
    private updateStatus(message?: string, showRawHtml?: boolean) {
        this.statusContainer.selectAll('*').remove();
        if (message) {
            this.statusContainer.append('div').append(function () {
                return this.appendChild(getParsedHtmlAsDom(message, 'html'));
            });
        }
        if (showRawHtml) {
            resolveForRawHtml(
                this.styleSheetContainer,
                this.statusContainer,
                this.formattingSettings
            );
        }
    }
}
