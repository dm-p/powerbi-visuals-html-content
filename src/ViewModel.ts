// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import DataView = powerbi.DataView;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;

// Internal dependencies
import { ContentFormattingSettings, VisualSettings } from './VisualSettings';

/**
 * View model structure
 */
export interface IViewModel {
    isValid: boolean;
    isEmpty: boolean;
    contentIndex: number;
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
            contentIndex: -1,
            htmlEntries: []
        };
    }

    /**
     * Checks that the supplied data view contains the correct combination of data roles and values, and sets the isValid flag
     * for the view model accordingly.
     *
     * @param dataViews     - Data views from the visual's update method.
     */
    validateDataView(dataViews: DataView[]) {
        const hasBasicDataView =
            (dataViews &&
                dataViews[0] &&
                dataViews[0].table &&
                dataViews[0].metadata &&
                dataViews[0].metadata.columns &&
                true) ||
            false;
        this.viewModel.contentIndex = hasBasicDataView
            ? this.getContentMetadataIndex(dataViews[0].metadata.columns)
            : -1;
        this.viewModel.isValid =
            hasBasicDataView && this.viewModel.contentIndex > -1;
    }

    /**
     * Maps a set of values from the data view and sets the necessary objects in the view model to handle them later on (including flags).
     *
     * @param dataViews     - Data views from the visual's update method.
     * @param settings      - Parsed visual settings.
     */
    mapDataView(dataViews: DataView[], settings: VisualSettings) {
        if (this.viewModel.isValid) {
            const rows = dataViews[0].table.rows,
                htmlEntries = rows.map(v => {
                    const value = v[this.viewModel.contentIndex];
                    return value ? value.toString() : '';
                });
            this.viewModel.contentFormatting = settings.contentFormatting;
            this.viewModel.htmlEntries = htmlEntries;
            this.viewModel.isEmpty = rows.length === 0;
        }
    }

    /**
     * Checks the supplied columns for the correct index of the content column, so that we can map it correctly later.
     *
     * @param columns   - Array of metadata columns from the Power BI data view.
     */
    private getContentMetadataIndex(columns: DataViewMetadataColumn[]) {
        return columns.findIndex(c => c.roles.content);
    }
}
