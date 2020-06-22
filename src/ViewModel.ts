// Power BI API Dependencies
    import powerbi from 'powerbi-visuals-api';
    import DataView = powerbi.DataView;
    import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;

import { ContentFormattingSettings, VisualSettings } from './VisualSettings';

/**
 * View model structure
 */
    export interface IViewModel {
        isValid: boolean;
        isEmpty: boolean;
        contentFormatting?: ContentFormattingSettings;
        htmlEntries: string[];
    }

/**
 * Visual view model and necessary logic to manage its state.
 */
    export class ViewModelHandler {

        viewModel: IViewModel;

        constructor() {
            this.reset();
        }

        /**
         * Initialises an empty view model for the visual.
         */
            reset() {
                this.viewModel = {
                    isValid: false,
                    isEmpty: true,
                    htmlEntries: []
                };
            }

        /**
         * Checks that the supplied data view contains the correct combination of data roles and values, and sets the isValid flag
         * for the view model accordingly.
         * 
         * @param dataViews     - Data views from the visual's update method.
         */
            validateDataView(
                options: VisualUpdateOptions
            ) {
                this.viewModel.isValid = 
                    options &&
                    options.dataViews &&
                    options.dataViews[0] &&
                    options.dataViews[0].table &&
                    true;
            }

        /**
         * Maps a set of values from the data view and sets the necessary objects in the view model to handle them later on (including flags).
         * 
         * @param dataViews     - Data views from the visual's update method.
         * @param settings      - Parsed visual settings.
         */
            mapDataView(
                dataViews: DataView[],
                settings: VisualSettings
            ) {
                const htmlEntries = dataViews[0].table.rows.map((v) => v.toString());
                this.viewModel.contentFormatting = settings.contentFormatting;
                this.viewModel.htmlEntries = htmlEntries;
                this.viewModel.isEmpty = htmlEntries.length <= 0;
            }

    }
