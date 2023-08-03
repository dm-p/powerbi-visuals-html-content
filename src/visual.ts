// Power BI API Dependencies
import './../style/visual.less';
import 'overlayscrollbars/css/OverlayScrollbars.css';
import 'w3-css/w3.css';
import powerbi from 'powerbi-visuals-api';
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import DataView = powerbi.DataView;
import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds;
import {
    interactivitySelectionService,
    interactivityBaseService
} from 'powerbi-visuals-utils-interactivityutils';
import IInteractivityService = interactivityBaseService.IInteractivityService;
import SelectableDataPoint = interactivitySelectionService.SelectableDataPoint;

// External dependencies
import { select, Selection } from 'd3-selection';

// Internal Dependencies
import { ContentFormattingSettings, VisualSettings } from './visual-settings';
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
    resolveHover,
    shouldUseStylesheet
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
    private settings: VisualSettings;
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
            .attr('id', VisualConstants.dom.contentIdSelector);
        this.landingPageHandler = new LandingPageHandler(
            this.landingContainer,
            this.localisationManager
        );
        this.events = this.host.eventService;
        this.viewModelHandler.reset();
    }

    // Runs when data roles added or something changes
    public update(options: VisualUpdateOptions) {
        const { viewModel } = this.viewModelHandler;

        // Handle main update flow
        try {
            // Signal we've begun rendering
            this.events.renderingStarted(options);
            this.updateStatus();
            this.contentContainer.selectAll('*').remove();

            // Parse the settings for use in the visual
            this.settings = Visual.parseSettings(
                options && options.dataViews && options.dataViews[0]
            );

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
                        this.settings,
                        this.host
                    );
                this.updateStatus();
            }

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
                this.settings
            );
            if (viewModel.isEmpty) {
                this.updateStatus(
                    this.settings.contentFormatting.noDataMessage,
                    viewModel.contentFormatting.showRawHtml
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
                    this.settings
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
                viewModel.contentFormatting.hyperlinks
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
                this.settings
            );
        }
    }

    private static parseSettings(dataView: DataView): VisualSettings {
        return VisualSettings.parse(dataView);
    }

    /**
     * This function gets called for each of the objects defined in the capabilities files and allows you to select which of the
     * objects and properties you want to expose to the users in the property pane.
     *
     */
    public enumerateObjectInstances(
        options: EnumerateVisualObjectInstancesOptions
    ): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
        const objectName = options.objectName;
        const objectEnumeration: VisualObjectInstance[] = [];
        const { contentFormatting, stylesheet, crossFilter } = this.settings;
        switch (objectName) {
            case 'contentFormatting': {
                const properties = <ContentFormattingSettings>{
                    showRawHtml: contentFormatting.showRawHtml,
                    hyperlinks: contentFormatting.hyperlinks,
                    userSelect: contentFormatting.userSelect,
                    noDataMessage: contentFormatting.noDataMessage
                };
                if (
                    !contentFormatting.showRawHtml &&
                    !shouldUseStylesheet(stylesheet)
                ) {
                    properties.fontFamily = contentFormatting.fontFamily;
                    properties.fontSize = contentFormatting.fontSize;
                    properties.fontColour = contentFormatting.fontColour;
                    properties.align = contentFormatting.align;
                }
                objectEnumeration.push({
                    objectName,
                    properties: <any>properties,
                    selector: null,
                    propertyInstanceKind: {
                        noDataMessage:
                            VisualEnumerationInstanceKinds.ConstantOrRule
                    }
                });
                break;
            }
            case 'stylesheet': {
                objectEnumeration.push({
                    objectName,
                    properties: {
                        stylesheet: stylesheet.stylesheet
                    },
                    propertyInstanceKind: {
                        stylesheet: VisualEnumerationInstanceKinds.Rule
                    },
                    selector: null
                });
                break;
            }
            case 'crossFilter': {
                if (this.viewModelHandler.viewModel.hasGranularity) {
                    objectEnumeration.push({
                        objectName,
                        properties: {
                            enabled: crossFilter.enabled,
                            useTransparency: crossFilter.enabled
                                ? crossFilter.useTransparency
                                : undefined,
                            transparencyPercent:
                                crossFilter.enabled &&
                                crossFilter.useTransparency
                                    ? crossFilter.transparencyPercent
                                    : undefined
                        },
                        selector: null,
                        validValues: {
                            transparencyPercent: {
                                numberRange: {
                                    min: 0,
                                    max: 100
                                }
                            }
                        }
                    });
                }
            }
        }
        return objectEnumeration;
    }
}
