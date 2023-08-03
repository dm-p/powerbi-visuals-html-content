// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import DataView = powerbi.DataView;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import DataViewTableRow = powerbi.DataViewTableRow;
import { valueFormatter } from 'powerbi-visuals-utils-formattingutils';
import { interactivitySelectionService } from 'powerbi-visuals-utils-interactivityutils';
import SelectableDataPoint = interactivitySelectionService.SelectableDataPoint;

// Internal dependencies
import { ContentFormattingSettings, VisualSettings } from './visual-settings';

/**
 * View model structure
 */
export interface IViewModel {
    isValid: boolean;
    isEmpty: boolean;
    hasCrossFiltering: boolean;
    hasGranularity: boolean;
    hasSelection: boolean;
    contentIndex: number;
    contentFormatting?: ContentFormattingSettings;
    htmlEntries: IHtmlEntry[];
}

export interface IHtmlEntry extends SelectableDataPoint {
    content: string;
    tooltips: VisualTooltipDataItem[];
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
            hasCrossFiltering: false,
            hasGranularity: false,
            hasSelection: false,
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
    mapDataView(
        dataViews: DataView[],
        settings: VisualSettings,
        host: IVisualHost
    ) {
        if (this.viewModel.isValid) {
            const hasGranularity = dataViews[0].table.columns.some(
                c => c.roles.sampling
            );
            const hasCrossFiltering =
                hasGranularity && settings.crossFilter.enabled;
            const { columns, rows } = dataViews[0].table;
            const initialSelection = this.viewModel.htmlEntries;
            const hasSelection =
                (initialSelection.some(dp => dp.selected) &&
                    hasCrossFiltering) ||
                false;
            const htmlEntries: IHtmlEntry[] = rows.map((row, index) => {
                const value = row[this.viewModel.contentIndex];
                const selectionIdBuilder = host.createSelectionIdBuilder();
                const identity = selectionIdBuilder
                    .withTable(dataViews[0].table, index)
                    .createSelectionId();
                return {
                    content: value ? value.toString() : '',
                    identity,
                    selected: this.isSelected(initialSelection, identity),
                    tooltips: [
                        ...this.getTooltipData('sampling', columns, row, host),
                        ...this.getTooltipData('tooltips', columns, row, host)
                    ]
                };
            });
            this.viewModel.hasCrossFiltering = hasCrossFiltering;
            this.viewModel.hasGranularity = hasGranularity;
            this.viewModel.hasSelection = hasSelection;
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

    /**
     * For a data row, extract the columns that have been assigned to the
     * tooltips role and return their corresponding values.
     *
     * @param columns   - Array of metadata columns from the Power BI data view.
     * @param row       - Current table row from the data view.
     */
    private getTooltipData(
        role: string,
        columns: DataViewMetadataColumn[],
        row: DataViewTableRow,
        host: IVisualHost
    ) {
        const tooltipValues: VisualTooltipDataItem[] = [];
        columns.forEach((c, i) => {
            const formatter = valueFormatter.create({
                cultureSelector: host.locale,
                format: c.format
            });
            if (c.roles[role]) {
                tooltipValues.push({
                    displayName: c.displayName,
                    value: formatter.format(row[i])
                });
            }
        });
        return tooltipValues;
    }

    /**
     * For an array of selectable data points, determine if the specificed selectionId is currently selected or not.
     *
     * @param initialSelection  - all selectable data points to inspect
     * @param selectionId       - selectionId to search for
     */
    private isSelected(
        initialSelection: interactivitySelectionService.SelectableDataPoint[],
        selectionId: ISelectionId
    ): boolean {
        const selectedDataPoint = (initialSelection || []).find(dp =>
            selectionId.equals(<ISelectionId>dp.identity)
        );
        return selectedDataPoint ? selectedDataPoint.selected : false;
    }
}
