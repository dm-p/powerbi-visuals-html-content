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
import VisualUpdateType = powerbi.VisualUpdateType;
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds;

// External dependencies
import { select, Selection } from 'd3-selection';

// Internal Dependencies
import { VisualSettings } from './VisualSettings';
import { VisualConstants } from './VisualConstants';
import { ViewModelHandler } from './ViewModel';
import DomainUtils from './DomainUtils';
import LandingPageHandler from './LandingPageHandler';

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
    private viewModelHandler = new ViewModelHandler();
    // Handles landing page
    private landingPageHandler: LandingPageHandler;
    // Manages custom styling from the user
    private styleSheetContainer: Selection<HTMLStyleElement, any, any, any>;

    // Runs when the visual is initialised
    constructor(options: VisualConstructorOptions) {
        this.container = select(options.element)
            .append('div')
            .attr('id', VisualConstants.dom.viewerIdSelector);
        this.host = options.host;
        this.localisationManager = this.host.createLocalizationManager();
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
        const viewModel = this.viewModelHandler.viewModel;

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
            switch (options.type) {
                case VisualUpdateType.Data:
                case VisualUpdateType.All: {
                    this.updateStatus(
                        this.localisationManager.getDisplayName(
                            'Status_Mapping_DataView'
                        )
                    );
                    this.viewModelHandler.validateDataView(options.dataViews);
                    viewModel.isValid &&
                        this.viewModelHandler.mapDataView(
                            options.dataViews,
                            this.settings
                        );
                    this.updateStatus();
                    break;
                }
            }

            this.landingPageHandler.handleLandingPage(
                this.viewModelHandler.viewModel.isValid,
                this.host
            );

            // Do checks on potential outcomes and handle accordingly
            if (!viewModel.isValid) {
                throw new Error('View model mapping error');
            }
            DomainUtils.resolveStyling(
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
                let dataElements = DomainUtils.bindVisualDataToDom(
                    this.contentContainer,
                    viewModel.htmlEntries
                );
                DomainUtils.resolveHtmlGroupElement(dataElements);
                DomainUtils.resolveForRawHtml(
                    this.styleSheetContainer,
                    this.contentContainer,
                    this.settings
                );
            }
            DomainUtils.resolveHyperlinkHandling(
                this.host,
                this.container,
                viewModel.contentFormatting.hyperlinks
            );
            DomainUtils.resolveContextMenu(
                this.container,
                this.host.createSelectionManager()
            );
            DomainUtils.resolveScrollableContent(this.container.node());

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
        this.statusContainer.append('div').html(message);
        if (showRawHtml) {
            DomainUtils.resolveForRawHtml(
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
        const instances: VisualObjectInstance[] = (<
            VisualObjectInstanceEnumerationObject
        >VisualSettings.enumerateObjectInstances(
            this.settings || VisualSettings.getDefault(),
            options
        )).instances;
        let objectName = options.objectName;

        switch (objectName) {
            case 'contentFormatting': {
                if (this.settings.contentFormatting.showRawHtml) {
                    delete instances[0].properties['fontFamily'];
                }
                if (DomainUtils.shouldUseStylesheet(this.settings.stylesheet)) {
                    delete instances[0].properties['fontFamily'];
                    delete instances[0].properties['fontSize'];
                    delete instances[0].properties['fontColour'];
                    delete instances[0].properties['align'];
                }
                instances[0].propertyInstanceKind = {
                    noDataMessage: VisualEnumerationInstanceKinds.ConstantOrRule
                };
                break;
            }
            case 'stylesheet': {
                instances[0].propertyInstanceKind = {
                    stylesheet: VisualEnumerationInstanceKinds.Rule
                };
                break;
            }
        }
        return instances;
    }
}
