// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import DataView = powerbi.DataView;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import PrimitiveValue = powerbi.PrimitiveValue;
import { valueFormatter } from 'powerbi-visuals-utils-formattingutils';
import { interactivitySelectionService } from 'powerbi-visuals-utils-interactivityutils';
import SelectableDataPoint = interactivitySelectionService.SelectableDataPoint;

// Internal dependencies
import {
    ContentFormattingSettings,
    VisualFormattingSettingsModel
} from './visual-settings';
import { mapCategoricalToTable } from './categorical-table';

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
 * A metadata column assigned to a tooltip-bearing role, paired with its row
 * index and a pre-built formatter, so per-row mapping can extract values
 * without repeating formatter creation.
 */
interface ITooltipColumn {
    column: DataViewMetadataColumn;
    index: number;
    formatter: valueFormatter.IValueFormatter;
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
                dataViews[0].categorical &&
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
        settings: VisualFormattingSettingsModel,
        host: IVisualHost
    ) {
        if (this.viewModel.isValid) {
            const { columns, rows, identities } = mapCategoricalToTable(
                dataViews[0].categorical,
                host
            );
            // validateDataView sets a provisional contentIndex from metadata.columns.
            // This recompute moves it into simulated-table column space
            // (categories-then-values), which is the index space `rows` uses.
            const contentIndex = this.getContentMetadataIndex(columns);
            this.viewModel.contentIndex = contentIndex;
            const hasGranularity = columns.some((c) => c.roles?.sampling);
            const hasCrossFiltering =
                hasGranularity &&
                settings.crossFilter.crossFilterCardMain.enabled.value;
            // Reconciling selection via per-row equals() scans of the previous
            // entries is quadratic across updates at the row cap; a key lookup
            // of previously-selected identities keeps it O(1) per row.
            const selectedKeys = new Set(
                this.viewModel.htmlEntries
                    .filter((dp) => dp.selected)
                    .map((dp) => (<ISelectionId>dp.identity).getKey())
            );
            const hasSelection =
                (selectedKeys.size > 0 && hasCrossFiltering) || false;
            // Resolve tooltip columns and their formatters once per update;
            // formatter creation is too expensive to repeat for every row.
            const tooltipColumns = [
                ...this.getTooltipColumns('sampling', columns, host),
                ...this.getTooltipColumns('tooltips', columns, host)
            ];
            const htmlEntries: IHtmlEntry[] =
                contentIndex > -1
                    ? rows.map((row, index) => {
                          const value = row[contentIndex];
                          return {
                              content: value ? value.toString() : '',
                              identity: identities[index],
                              selected:
                                  selectedKeys.size > 0 &&
                                  selectedKeys.has(identities[index].getKey()),
                              tooltips: this.getTooltipValues(
                                  tooltipColumns,
                                  row
                              )
                          };
                      })
                    : [];
            this.viewModel.hasCrossFiltering = hasCrossFiltering;
            this.viewModel.hasGranularity = hasGranularity;
            this.viewModel.hasSelection = hasSelection;
            this.viewModel.contentFormatting = settings.contentFormatting;
            this.viewModel.htmlEntries = htmlEntries;
            this.viewModel.isEmpty = htmlEntries.length === 0;
        }
    }

    /**
     * Checks the supplied columns for the correct index of the content column, so that we can map it correctly later.
     *
     * @param columns   - Array of metadata columns from the Power BI data view.
     */
    private getContentMetadataIndex(columns: DataViewMetadataColumn[]) {
        return columns.findIndex((c) => c.roles?.content);
    }

    /**
     * Resolve the columns assigned to the supplied role, paired with their
     * row index and a value formatter. Intended to run once per update so
     * that per-row mapping does not repeat formatter creation.
     *
     * @param role      - Data role to match columns against.
     * @param columns   - Array of metadata columns from the Power BI data view.
     * @param host      - Visual host services (for locale).
     */
    private getTooltipColumns(
        role: string,
        columns: DataViewMetadataColumn[],
        host: IVisualHost
    ): ITooltipColumn[] {
        return columns
            .map((column, index) => ({ column, index }))
            .filter(({ column }) => column.roles?.[role])
            .map(({ column, index }) => ({
                column,
                index,
                formatter: valueFormatter.create({
                    cultureSelector: host.locale,
                    format: column.format
                })
            }));
    }

    /**
     * For a data row, extract the values for the pre-resolved tooltip
     * columns.
     *
     * @param tooltipColumns    - Tooltip columns resolved by getTooltipColumns.
     * @param row               - Current simulated-table row.
     */
    private getTooltipValues(
        tooltipColumns: ITooltipColumn[],
        row: PrimitiveValue[]
    ): VisualTooltipDataItem[] {
        return tooltipColumns.map(({ column, index, formatter }) => ({
            displayName: column.displayName,
            value: formatter.format(row[index])
        }));
    }
}
