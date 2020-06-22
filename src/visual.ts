// Power BI API Dependencies
    import 'core-js/stable';
    import './../style/visual.less';
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

// External dependencies
    import * as d3Select from 'd3-selection';

// Internal Dependencies
    import {
        VisualSettings
    } from "./VisualSettings";
    import {
        VisualConstants
    } from './VisualConstants';
    import {
        ViewModelHandler
    } from './ViewModel';
    import DomainUtils from './DomainUtils';

    export class Visual implements IVisual {

        // The root element for the entire visual
            private container: d3.Selection<HTMLDivElement, any, any, any>;
        // Used for handling issues in the visual
            private statusContainer: d3.Selection<HTMLDivElement, any, any, any>;
        // USed for HTML content from data model
            private contentContainer: d3.Selection<HTMLDivElement, any, any, any>;
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

        // Runs when the visual is initialised
            constructor(options: VisualConstructorOptions) {

                this.container = d3Select.select(options.element)
                    .append('div')
                        .attr('id', VisualConstants.dom.viewerIdSelector);
                this.statusContainer = this.container
                    .append('div')
                        .attr('id', VisualConstants.dom.statusIdSelector);
                this.contentContainer = this.container
                    .append('div')
                        .attr('id', VisualConstants.dom.contentIdSelector);
                this.host = options.host;
                this.localisationManager = this.host.createLocalizationManager();
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

                        // Parse the settings for use in the visual
                            this.settings = Visual.parseSettings(options && options.dataViews && options.dataViews[0]);

                        // If new data, we need to re-map it
                            switch (options.type) {
                                case VisualUpdateType.Data:
                                case VisualUpdateType.All: {
                                    this.updateStatus(this.localisationManager.getDisplayName('Status_Mapping_DataView'));
                                    this.viewModelHandler.validateDataView(options);
                                    viewModel.isValid && this.viewModelHandler.mapDataView(
                                        options.dataViews,
                                        this.settings
                                    );
                                    this.updateStatus();
                                    break;
                                }
                            }

                        // Do checks on potential outcomes and handle accordingly
                            if (!viewModel.isValid) {
                                throw new Error('View model mapping error');
                            }
                            if (viewModel.isEmpty) {
                                this.updateStatus(this.localisationManager.getDisplayName('Status_No_Data'));
                            }

                        // Render our content
                            let dataElements = DomainUtils.bindVisualDataToDom(
                                    this.contentContainer,
                                    viewModel.htmlEntries
                                );
                            DomainUtils.resolveHtmlGroupElement(dataElements, viewModel.contentFormatting.showRawHtml);
                            DomainUtils.resolveGroupSeparation(viewModel.contentFormatting.separation, dataElements);
                            DomainUtils.resolveBodyStyling(this.container, {
                                fontFamily: viewModel.contentFormatting.fontFamily,
                                fontSize: viewModel.contentFormatting.fontSize,
                                colour: viewModel.contentFormatting.fontColour,
                                textAlign: viewModel.contentFormatting.align
                            });
                            DomainUtils.resolveHyperlinkHandling(this.host, this.container, viewModel.contentFormatting.hyperlinks);
                            DomainUtils.resolveScrollableContent(this.container.node());

                        // Signal that we've finished rendering
                            this.events.renderingFinished(options);
                            return;

                    } catch(e) {

                        // Signal that we've encountered an error
                            this.events.renderingFailed(options, e);
                            this.contentContainer.selectAll('*').remove();
                            this.updateStatus(this.localisationManager.getDisplayName('Status_Invalid_View_Model'));

                    }

            }

        /**
         * Generic function to manage update of text within status container.
         * 
         * @param message   - Simple message to display. Omit to remove current content.
         */
            private updateStatus(message?: string) {
                this.statusContainer.html(message);
            }

            private static parseSettings(dataView: DataView): VisualSettings {
                return VisualSettings.parse(dataView);
            }

        /**
         * This function gets called for each of the objects defined in the capabilities files and allows you to select which of the
         * objects and properties you want to expose to the users in the property pane.
         *
         */
            public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
                const instances: VisualObjectInstance[] = (
                        <VisualObjectInstanceEnumerationObject>VisualSettings.enumerateObjectInstances(
                            this.settings || VisualSettings.getDefault(),
                            options
                        )
                    ).instances;
                let objectName = options.objectName;

                switch (objectName) {
                    case 'contentFormatting': {
                        if (this.settings.contentFormatting.showRawHtml) {
                            delete instances[0].properties['fontFamily'];
                        }
                        break;
                    }
                }
                return instances;
            }
    }       