import { interactivityBaseService } from 'powerbi-visuals-utils-interactivityutils';
import IBehaviorOptions = interactivityBaseService.IBehaviorOptions;
import BaseDataPoint = interactivityBaseService.BaseDataPoint;
import IInteractiveBehavior = interactivityBaseService.IInteractiveBehavior;
import ISelectionHandler = interactivityBaseService.ISelectionHandler;

import { IHtmlEntry, IViewModel } from './view-model';
import { VisualConstants } from './visual-constants';
import { shouldDimPoint } from './domain-utils';
import { recordEvent } from './diagnostics/event-recorder';
import { formatTooltipItems } from './diagnostics/host-events';

/**
 * Behavior options for interactivity.
 */
export interface IHtmlBehaviorOptions<
    SelectableDataPoint extends BaseDataPoint
> extends IBehaviorOptions<SelectableDataPoint> {
    // Elements denoting a selectable data point in the visual
    pointSelection: d3.Selection<HTMLElement, IHtmlEntry, any, any>;
    // Element performing the role of clear-catcher (clears selection)
    clearCatcherSelection: d3.Selection<HTMLDivElement, any, any, any>;
    // Visual ViewModel
    viewModel: IViewModel;
    // Dismiss any active host tooltip on an interaction (cross-filter / context
    // menu). Always-on UX fix — independent of diagnostics. The visual wires it
    // to host.tooltipService.hide(...).
    hideTooltip: () => void;
}

/**
 * Used to control and bind visual interaction and behavior.
 */
export class BehaviorManager<
    SelectableDataPoint extends BaseDataPoint
> implements IInteractiveBehavior {
    // Interactivity options
    protected options: IHtmlBehaviorOptions<SelectableDataPoint>;
    // Handles selection event delegation to the visual host
    protected selectionHandler: ISelectionHandler;

    /**
     * Apply click behavior to selections as necessary.
     */
    protected bindClick() {
        const {
            pointSelection,
            viewModel: { hasCrossFiltering }
        } = this.options;
        pointSelection.on('click', (event, d) =>
            hasCrossFiltering ? this.handleSelectionClick(event, d) : null
        );
    }

    /**
     * Apply context menu behavior to selections as necessary.
     */
    protected bindContextMenu() {
        const { pointSelection, clearCatcherSelection } = this.options;
        pointSelection.on('contextmenu', (event, d) =>
            this.handleContextMenu(event, d)
        );
        clearCatcherSelection.on('contextmenu', (event) =>
            this.handleContextMenu(event, null)
        );
    }

    /**
     * Bounded tooltip context string for a datum.
     */
    private pointContext(d: IHtmlEntry | null): string {
        if (!d) return '';
        return formatTooltipItems(
            d.tooltips ?? [],
            VisualConstants.diagnostics.eventContextItems,
            VisualConstants.diagnostics.eventContextCap
        );
    }

    /**
     * Abstraction of common click event handling for a `SelectableDataPoint`
     *
     * @param event - click event
     * @param d     - datum from selection
     */
    handleSelectionClick(event: MouseEvent, d: IHtmlEntry) {
        event.preventDefault();
        event.stopPropagation();
        this.options.hideTooltip();
        recordEvent(
            'cross-filter',
            event.ctrlKey ? 'select (multi)' : 'select',
            this.pointContext(d) || undefined
        );
        this.selectionHandler.handleSelection(d, event.ctrlKey);
    }

    /**
     * Abstraction of common context menu event handling for a `SelectableDataPoint`.
     *
     * @param event - click event
     * @param d     - datum from selection
     */
    handleContextMenu(event: MouseEvent, d: IHtmlEntry) {
        event.preventDefault();
        event.stopPropagation();
        this.options.hideTooltip();
        recordEvent(
            'drill',
            `context-menu @ (${event.clientX},${event.clientY})`,
            d ? this.pointContext(d) || undefined : 'background'
        );
        event &&
            this.selectionHandler.handleContextMenu(d, {
                x: event.clientX,
                y: event.clientY
            });
    }

    /**
     * Apply click behavior to the clear-catcher (clearing active selections if clicked).
     */
    protected bindClearCatcher() {
        const {
            clearCatcherSelection,
            viewModel: { hasCrossFiltering }
        } = this.options;
        clearCatcherSelection.on('click', (event) => {
            if (hasCrossFiltering) {
                event.preventDefault();
                event.stopPropagation();
                this.options.hideTooltip();
                recordEvent('cross-filter', 'cleared');
                const mouseEvent: MouseEvent = <MouseEvent>event;
                mouseEvent && this.selectionHandler.handleClearSelection();
            }
        });
    }

    /**
     * Ensure that class has necessary options and tooling to perform interactivity/behavior requirements as needed.
     *
     * @param options           - interactivity & behavior options
     * @param selectionHandler  - selection handler instance
     */
    public bindEvents(
        options: IHtmlBehaviorOptions<SelectableDataPoint>,
        selectionHandler: ISelectionHandler
    ): void {
        this.options = options;
        this.selectionHandler = selectionHandler;
        this.bindClick();
        this.bindContextMenu();
        this.bindClearCatcher();
    }

    /**
     * Handle visual effects on selection and interactivity events.
     *
     * @param hasSelection - whether visual has selection state or not
     */
    public renderSelection(hasSelection: boolean): void {
        const { pointSelection, viewModel } = this.options;
        // Update viewModel selection state to match current state
        viewModel.hasSelection = hasSelection;
        pointSelection.classed(
            VisualConstants.dom.unselectedClassSelector,
            (d) => shouldDimPoint(hasSelection, d.selected)
        );
    }
}
