import { Selection } from 'd3-selection';
import { interactivityBaseService } from 'powerbi-visuals-utils-interactivityutils';
import IBehaviorOptions = interactivityBaseService.IBehaviorOptions;
import BaseDataPoint = interactivityBaseService.BaseDataPoint;
import IInteractiveBehavior = interactivityBaseService.IInteractiveBehavior;
import ISelectionHandler = interactivityBaseService.ISelectionHandler;

import { IHtmlEntry, IViewModel } from '../view-model';
import { VisualConstants } from '../visual-constants';
import { shouldDimPoint } from '../domain-utils';
import { recordEvent } from '../diagnostics/event-recorder';
import {
    tooltipContext,
    TooltipItem,
    eventCoords
} from '../diagnostics/host-events';
import { resolveInteractivity } from './policy';

/**
 * Behavior options for interactivity.
 */
export interface IHtmlBehaviorOptions<
    SelectableDataPoint extends BaseDataPoint
> extends IBehaviorOptions<SelectableDataPoint> {
    // Elements denoting a selectable data point in the visual
    pointSelection: Selection<HTMLElement, IHtmlEntry, any, any>;
    // Element performing the role of clear-catcher (clears selection)
    clearCatcherSelection: Selection<HTMLDivElement, any, any, any>;
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
    // Interactivity options (assigned in bindEvents, not the constructor)
    protected options!: IHtmlBehaviorOptions<SelectableDataPoint>;
    // Handles selection event delegation to the visual host (assigned in bindEvents)
    protected selectionHandler!: ISelectionHandler;

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
        return d ? tooltipContext(d.tooltips as TooltipItem[]) : '';
    }

    /**
     * Abstraction of common click event handling for a `SelectableDataPoint`
     *
     * @param event - click event
     * @param d     - datum from selection
     */
    handleSelectionClick(event: MouseEvent, d: IHtmlEntry) {
        if (!resolveInteractivity(event.target as Element | null, 'filter')) {
            // Inert region: don't toggle, and stop the click reaching the
            // clear-catcher (which would otherwise wipe the selection).
            event.stopPropagation();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.options.hideTooltip();
        // `d.selected` is the PRE-toggle state, so a Ctrl+click on an already-
        // selected point removes it from the selection, otherwise it adds it; a
        // plain click replaces the selection. Surfacing add/remove makes it
        // clear how each click changes the multi-select context.
        const op = event.ctrlKey ? (d.selected ? 'remove' : 'add') : 'select';
        recordEvent('cross-filter', op, this.pointContext(d) || undefined);
        this.selectionHandler.handleSelection(d, event.ctrlKey);
    }

    /**
     * Abstraction of common context menu event handling for a `SelectableDataPoint`.
     *
     * @param event - click event
     * @param d     - datum from selection
     */
    handleContextMenu(event: MouseEvent, d: IHtmlEntry | null) {
        // Always preventDefault so the browser's native menu never appears.
        event.preventDefault();
        if (
            !resolveInteractivity(
                event.target as Element | null,
                'context-menu'
            )
        ) {
            // Inert region: show neither our drill menu nor the native one, and
            // stop the event bubbling to ancestor (clear-catcher / host) handlers.
            event.stopPropagation();
            return;
        }
        event.stopPropagation();
        this.options.hideTooltip();
        recordEvent(
            'context-menu',
            eventCoords(event),
            d ? this.pointContext(d) || undefined : 'background'
        );
        event &&
            // null d is the intended "background" right-click; the host's
            // handleContextMenu tolerates it even though its type wants a point.
            this.selectionHandler.handleContextMenu(d as IHtmlEntry, {
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
                if (
                    !resolveInteractivity(
                        event.target as Element | null,
                        'filter'
                    )
                ) {
                    return; // inert region — don't clear
                }
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
