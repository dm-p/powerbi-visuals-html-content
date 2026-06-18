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
    getParsedHtmlAsDom,
    resolveForRawHtml,
    resolveHyperlinkHandling,
    resolveScrollableContent,
    resolveStyling,
    resolveHover,
    resolveTemplateContainer,
    renderTemplatedEntries,
    reconcileTemplatedEntries,
    TemplateContainer,
    TemplatedRenderOptions,
    getRawHtml
} from './domain-utils';
import LandingPageHandler from './landing-page-handler';
import { BehaviorManager, IHtmlBehaviorOptions } from './behavior';
import { RenderFormat } from './types';
import { RenderOrchestrator, RenderSteps } from './render-orchestrator';
import './diagnostics/diagnostics-dialog'; // registration side-effect — must be imported
import { beginCapture, endCapture } from './diagnostics/diagnostics-sink';
import {
    install as installConsoleCapture,
    snapshot as consoleSnapshot
} from './diagnostics/console-capture';
import {
    buildSnapshot,
    shouldShowDiagnosticsIcon,
    createDiagnosticsIcon,
    setIconVisibility
} from './diagnostics/diagnostics-snapshot';
import { SanitizerCapture } from './diagnostics/types';

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
    // assertion (!) tells the compiler the field is set before use. Typed as HTMLElement
    // (not HTMLDivElement) because a templated row root can be any tag (e.g. <tr>).
    private dataElements!: Selection<HTMLElement, IHtmlEntry, any, any>;
    // Cached template join container (the body-resolved render target + content
    // slot anchor). Established on rebuild and reused on reconcile; invalidated
    // on kind change / error so the next populated render re-resolves it.
    private templateContainer: TemplateContainer | undefined;
    // Diagnostics overlay icon (top-right). Created hidden in the constructor;
    // its visibility is gated each update by the toggle + host modal support.
    private diagnosticsIcon!: HTMLButtonElement;
    // Last armed sanitizer capture, surfaced when the dialog is opened.
    private lastSanitizerCapture: SanitizerCapture = {
        entries: [],
        overflow: 0
    };

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
        this.diagnosticsIcon = createDiagnosticsIcon(() =>
            this.openDiagnostics()
        );
        setIconVisibility(this.diagnosticsIcon, false);
        (this.container.node() as HTMLElement).appendChild(
            this.diagnosticsIcon
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

        const diagOn =
            this.formattingSettings.contentFormatting
                .contentFormattingCardBehavior.enableDiagnostics.value;
        if (diagOn) {
            installConsoleCapture();
        }
        setIconVisibility(
            this.diagnosticsIcon,
            shouldShowDiagnosticsIcon(
                diagOn,
                this.host.hostCapabilities?.allowModalDialog
            )
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
            if (diagOn) beginCapture();
            this.orchestrator.render(
                options,
                viewModel,
                this.formattingSettings
            );
            if (diagOn) this.lastSanitizerCapture = endCapture();
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, e);
            // Clear any partially-rendered DOM from the failed update so the
            // next update starts clean. (The reconcile stash can't be left
            // inconsistent here: it is stamped only AFTER a node's content is
            // rendered, so a mid-render throw leaves changed nodes un-stamped
            // and they re-render next reconcile regardless of this wipe.)
            this.contentContainer.selectAll('*').remove();
            this.updateStatus();
            // Drop the cached template container so the next update rebuilds
            // against a clean, freshly-resolved container rather than reusing a
            // stale one whose DOM was just wiped.
            this.templateContainer = undefined;
            // Reset orchestrator state to match the now-empty container, so the
            // next update rebuilds from scratch rather than skipping a
            // viewport-only render against stale cached state.
            this.orchestrator.reset();
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
            // No-data message or raw-HTML textarea. Clears content first
            // (state-kind reset) and invalidates the cached template container
            // so the next populated render is a fresh rebuild that re-resolves
            // the body wrapper.
            renderEmptyOrRaw: (viewModel, settings) => {
                this.contentContainer.selectAll('*').remove();
                this.templateContainer = undefined;
                const behavior =
                    settings.contentFormatting.contentFormattingCardBehavior;
                if (viewModel.isEmpty) {
                    this.updateStatus(
                        settings.contentFormatting.contentFormattingCardNoData
                            .noDataMessage.value,
                        behavior.showRawHtml.value
                    );
                } else {
                    // Populated content but showRawHtml is on: render entries via
                    // the template engine (so the raw view reflects the templated
                    // output) then replace with the raw view (resolveForRawHtml
                    // wipes the content + adds the textarea).
                    this.templateContainer = resolveTemplateContainer(
                        this.contentContainer.node() as HTMLElement,
                        viewModel.bodyTemplate,
                        { allowHyperlinks: behavior.hyperlinks.value }
                    );
                    renderTemplatedEntries(
                        this.templateContainer,
                        viewModel.htmlEntries,
                        {
                            format: behavior.format.value as RenderFormat,
                            allowHyperlinks: behavior.hyperlinks.value,
                            hasSelection: viewModel.hasSelection
                        } as TemplatedRenderOptions
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
            // Full rebuild: re-resolve the template container (this clears
            // #htmlContent and re-parses the body — that IS the rebuild wipe),
            // then render every entry into it.
            rebuild: (viewModel, settings) => {
                this.rebuildPopulated(viewModel, settings);
            },
            // Reconcile: reuse the cached template container and re-render ONLY
            // the changed/entered rows (unchanged rows keep their exact node so
            // inline iframes survive). The body wrapper is NOT re-parsed here; a
            // body change (static OR CF) trips the fingerprint and forces a
            // rebuild, so the cached container is always body-current.
            reconcile: (viewModel, settings) => {
                const behavior =
                    settings.contentFormatting.contentFormattingCardBehavior;
                this.updateStatus();
                if (!this.templateContainer) {
                    // No baseline (shouldn't happen — rebuild always seeds it).
                    // Fall back to a full rebuild against a clean container.
                    this.rebuildPopulated(viewModel, settings);
                    return;
                }
                const { merged } = reconcileTemplatedEntries(
                    this.templateContainer,
                    viewModel.htmlEntries,
                    {
                        format: behavior.format.value as RenderFormat,
                        allowHyperlinks: behavior.hyperlinks.value,
                        hasSelection: viewModel.hasSelection
                    } as TemplatedRenderOptions
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
     * Full populated rebuild: re-resolve the template container against the
     * resolved body (this clears #htmlContent and re-parses the body wrapper —
     * the rebuild wipe), then render every entry into the resulting join
     * container. Shared by the rebuild render step and the reconcile fallback
     * (which runs only if no cached container exists — i.e. defensively).
     */
    private rebuildPopulated(
        viewModel: IViewModel,
        settings: VisualFormattingSettingsModel
    ): void {
        const behavior =
            settings.contentFormatting.contentFormattingCardBehavior;
        this.updateStatus();
        this.templateContainer = resolveTemplateContainer(
            this.contentContainer.node() as HTMLElement,
            viewModel.bodyTemplate,
            { allowHyperlinks: behavior.hyperlinks.value }
        );
        const merged = renderTemplatedEntries(
            this.templateContainer,
            viewModel.htmlEntries,
            {
                format: behavior.format.value as RenderFormat,
                allowHyperlinks: behavior.hyperlinks.value,
                hasSelection: viewModel.hasSelection
            } as TemplatedRenderOptions
        );
        this.finalizePopulatedRender(merged, viewModel, settings);
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
        merged: Selection<HTMLElement, IHtmlEntry, any, any>,
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

    /** Assemble a bounded snapshot and open the host modal dialog. */
    private openDiagnostics(): void {
        const rawHtml = getRawHtml(
            this.styleSheetContainer,
            this.contentContainer,
            this.formattingSettings.stylesheet
        );
        const snapshot = buildSnapshot({
            rawHtml,
            sanitizer: this.lastSanitizerCapture,
            console: consoleSnapshot()
        });
        const d = VisualConstants.diagnostics.dialog;
        void this.host.openModalDialog(
            VisualConstants.diagnostics.dialogId,
            {
                title: d.title,
                size: d.size,
                // Literals avoid const-enum inlining ambiguity:
                position: { type: 0 /* VisualDialogPositionType.Center */ },
                actionButtons: [0 /* DialogAction.Close */]
            },
            snapshot
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
