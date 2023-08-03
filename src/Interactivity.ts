import { interactivityBaseService } from 'powerbi-visuals-utils-interactivityutils';
import IBehaviorOptions = interactivityBaseService.IBehaviorOptions;
import BaseDataPoint = interactivityBaseService.BaseDataPoint;
import IInteractiveBehavior = interactivityBaseService.IInteractiveBehavior;
import ISelectionHandler = interactivityBaseService.ISelectionHandler;

import { IHtmlEntry, IViewModel, ViewModelHandler } from './ViewModel';
import { VisualConstants } from './VisualConstants';

/**
 * Behavior options for interactivity.
 */
export interface IHtmlBehaviorOptions<
    SelectableDataPoint extends BaseDataPoint
> extends IBehaviorOptions<SelectableDataPoint> {
    // Elements denoting a selectable data point in the visual
    pointSelection: d3.Selection<HTMLDivElement, IHtmlEntry, any, any>;
    // Element performing the role of clear-catcher (clears selection)
    clearCatcherSelection: d3.Selection<HTMLDivElement, any, any, any>;
    // Visual ViewModel
    viewModel: IViewModel;
}

/**
 * Used to control and bind visual interaction and behavior.
 */
export class BehaviorManager<SelectableDataPoint extends BaseDataPoint>
    implements IInteractiveBehavior {
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
        clearCatcherSelection.on('contextmenu', event =>
            this.handleContextMenu(event, null)
        );
    }

    /**
     * Abstraction of common click event handling for a `SelectableDataPoint`
     *
     * @param event - click event
     * @param d     - datum from selection
     */
    private handleSelectionClick(event: MouseEvent, d: IHtmlEntry) {
        event.preventDefault();
        event.stopPropagation();
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
        clearCatcherSelection.on('click', event => {
            if (hasCrossFiltering) {
                event.preventDefault();
                event.stopPropagation();
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
        pointSelection.classed(VisualConstants.dom.unselectedClassSelector, d =>
            ViewModelHandler.shouldDimPoint(viewModel, d)
        );
    }
}
