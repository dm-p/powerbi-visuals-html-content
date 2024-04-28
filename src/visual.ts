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
import { select, Selection } from 'd3-selection';

// Internal Dependencies
import { VisualFormattingSettingsModel } from './visual-settings';
import { VisualConstants } from './visual-constants';
import { ViewModelHandler } from './view-model';
import {
    bindVisualDataToDom,
    getParsedHtmlAsDom,
    resolveForRawHtml,
    resolveHtmlGroupElement,
    resolveHyperlinkHandling,
    resolveScrollableContent,
    resolveStyling,
    resolveHover
} from './domain-utils';
import LandingPageHandler from './landing-page-handler';
import { BehaviorManager, IHtmlBehaviorOptions } from './behavior';

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

    // Runs when the visual is initialised
    constructor(options: VisualConstructorOptions) {
        this.container = select(options.element)
            .append('div')
            .attr('id', VisualConstants.dom.viewerIdSelector);
        this.host = options.host;
        this.viewModelHandler = new ViewModelHandler();
        this.localisationManager = this.host.createLocalizationManager();
        this.interactivity = interactivitySelectionService.createInteractivitySelectionService(
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
        // Parse the settings for use in the visual
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            options.dataViews?.[0]
        );

        // Handle main update flow
        try {
            // Signal we've begun rendering
            this.events.renderingStarted(options);
            this.updateStatus();
            this.contentContainer.selectAll('*').remove();

            // If new data, we need to re-map it
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
                this.viewModelHandler.viewModel.isValid,
                this.host
            );

            // Do checks on potential outcomes and handle accordingly
            if (!viewModel.isValid) {
                throw new Error('View model mapping error');
            }
            resolveStyling(
                this.styleSheetContainer,
                this.container,
                this.formattingSettings
            );
            if (viewModel.isEmpty) {
                this.updateStatus(
                    this.formattingSettings.contentFormatting
                        .contentFormattingCardNoData.noDataMessage.value,
                    viewModel.contentFormatting.contentFormattingCardBehavior
                        .showRawHtml.value
                );
            } else {
                const dataElements = bindVisualDataToDom(
                    this.contentContainer,
                    viewModel.htmlEntries,
                    viewModel.hasSelection
                );
                resolveHtmlGroupElement(dataElements);
                resolveForRawHtml(
                    this.styleSheetContainer,
                    this.contentContainer,
                    this.formattingSettings
                );
                if (this.host.hostCapabilities.allowInteractions) {
                    this.interactivity.bind(<
                        IHtmlBehaviorOptions<SelectableDataPoint>
                    >{
                        behavior: this.behavior,
                        dataPoints: viewModel.htmlEntries,
                        clearCatcherSelection: this.container,
                        pointSelection: dataElements,
                        viewModel
                    });
                }
                resolveHover(dataElements, this.host, viewModel.hasGranularity);
            }
            resolveHyperlinkHandling(
                this.host,
                this.container,
                viewModel.contentFormatting.contentFormattingCardBehavior
                    .hyperlinks.value
            );
            resolveScrollableContent(this.container.node());

            // Signal that we've finished rendering
            this.events.renderingFinished(options);
            return;
        } catch (e) {
            // Signal that we've encountered an error
            this.events.renderingFailed(options, e);
            this.contentContainer.selectAll('*').remove();
            this.updateStatus();
        }
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
            this.statusContainer.append('div').append(function() {
                return this.appendChild(getParsedHtmlAsDom(message));
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
