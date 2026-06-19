import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorManager } from '../src/behavior';
import { IViewModel, IHtmlEntry } from '../src/view-model';
import { VisualConstants } from '../src/visual-constants';
import { setArmed, snapshot, resetForTests } from '../src/diagnostics/event-recorder';

const makeOptions = (hideTooltip: () => void) => {
    const point = {
        on: vi.fn().mockReturnThis()
    };
    const clear = { on: vi.fn().mockReturnThis() };
    return {
        options: {
            pointSelection: point as any,
            clearCatcherSelection: clear as any,
            viewModel: { hasCrossFiltering: true } as any,
            hideTooltip
        },
        point,
        clear
    };
};

describe('tooltip dismissal on interaction', () => {
    it('handleContextMenu calls hideTooltip', () => {
        const hideTooltip = vi.fn();
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(hideTooltip);
        const handler = { handleContextMenu: vi.fn(), handleSelection: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 1, clientY: 2 } as any;
        mgr.handleContextMenu(evt, { tooltips: [] } as any);
        expect(hideTooltip).toHaveBeenCalledTimes(1);
    });

    it('clear-catcher click calls hideTooltip', () => {
        const hideTooltip = vi.fn();
        const mgr = new BehaviorManager<any>();
        const { options, clear } = makeOptions(hideTooltip);
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        // find the 'click' handler registered on the clear-catcher selection
        const clickCall = (clear.on as any).mock.calls.find((c: any[]) => c[0] === 'click');
        expect(clickCall).toBeTruthy();
        const cb = clickCall[1];
        cb({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(hideTooltip).toHaveBeenCalledTimes(1);
    });
});

describe('BehaviorManager', () => {
    let behaviorManager: BehaviorManager<any>;
    let mockSelectionHandler: any;
    let mockPointSelection: any;
    let mockClearCatcherSelection: any;
    let mockViewModel: IViewModel;

    beforeEach(() => {
        behaviorManager = new BehaviorManager();

        mockSelectionHandler = {
            handleSelection: vi.fn(),
            handleContextMenu: vi.fn(),
            handleClearSelection: vi.fn()
        };

        // Create mock D3 selection-like objects
        mockPointSelection = {
            on: vi.fn().mockReturnThis(),
            classed: vi.fn().mockReturnThis()
        };

        mockClearCatcherSelection = {
            on: vi.fn().mockReturnThis()
        };

        mockViewModel = {
            isValid: true,
            isEmpty: false,
            hasCrossFiltering: true,
            hasGranularity: true,
            hasSelection: false,
            contentIndex: 0,
            htmlEntries: []
        };
    });

    describe('bindEvents', () => {
        it('should bind click, context menu, and clear catcher events', () => {
            const options = {
                pointSelection: mockPointSelection,
                clearCatcherSelection: mockClearCatcherSelection,
                viewModel: mockViewModel,
                hideTooltip: vi.fn()
            } as any;

            behaviorManager.bindEvents(options, mockSelectionHandler);

            // Should bind click to point selection
            expect(mockPointSelection.on).toHaveBeenCalledWith(
                'click',
                expect.any(Function)
            );

            // Should bind context menu to point selection
            expect(mockPointSelection.on).toHaveBeenCalledWith(
                'contextmenu',
                expect.any(Function)
            );

            // Should bind context menu to clear catcher
            expect(mockClearCatcherSelection.on).toHaveBeenCalledWith(
                'contextmenu',
                expect.any(Function)
            );

            // Should bind click to clear catcher
            expect(mockClearCatcherSelection.on).toHaveBeenCalledWith(
                'click',
                expect.any(Function)
            );
        });
    });

    describe('renderSelection', () => {
        it('should update viewModel selection state', () => {
            const options = {
                pointSelection: mockPointSelection,
                clearCatcherSelection: mockClearCatcherSelection,
                viewModel: mockViewModel,
                hideTooltip: vi.fn()
            } as any;

            behaviorManager.bindEvents(options, mockSelectionHandler);
            behaviorManager.renderSelection(true);

            expect(mockViewModel.hasSelection).toBe(true);
        });

        it('should apply unselected class to dimmed points', () => {
            const options = {
                pointSelection: mockPointSelection,
                clearCatcherSelection: mockClearCatcherSelection,
                viewModel: mockViewModel,
                hideTooltip: vi.fn()
            } as any;

            behaviorManager.bindEvents(options, mockSelectionHandler);
            behaviorManager.renderSelection(true);

            expect(mockPointSelection.classed).toHaveBeenCalledWith(
                VisualConstants.dom.unselectedClassSelector,
                expect.any(Function)
            );
        });
    });

    describe('handleContextMenu', () => {
        it('should call selectionHandler handleContextMenu with coordinates', () => {
            const options = {
                pointSelection: mockPointSelection,
                clearCatcherSelection: mockClearCatcherSelection,
                viewModel: mockViewModel,
                hideTooltip: vi.fn()
            } as any;

            behaviorManager.bindEvents(options, mockSelectionHandler);

            const mockEvent = {
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
                clientX: 100,
                clientY: 200
            } as any;

            const mockDataPoint: IHtmlEntry = {
                content: '<p>Test</p>',
                identity: {} as any,
                selected: false,
                tooltips: []
            };

            behaviorManager.handleContextMenu(mockEvent, mockDataPoint);

            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect(mockEvent.stopPropagation).toHaveBeenCalled();
            expect(
                mockSelectionHandler.handleContextMenu
            ).toHaveBeenCalledWith(mockDataPoint, { x: 100, y: 200 });
        });

        it('should handle null data point', () => {
            const options = {
                pointSelection: mockPointSelection,
                clearCatcherSelection: mockClearCatcherSelection,
                viewModel: mockViewModel,
                hideTooltip: vi.fn()
            } as any;

            behaviorManager.bindEvents(options, mockSelectionHandler);

            const mockEvent = {
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
                clientX: 100,
                clientY: 200
            } as any;

            behaviorManager.handleContextMenu(mockEvent, null as any);

            expect(
                mockSelectionHandler.handleContextMenu
            ).toHaveBeenCalledWith(null, { x: 100, y: 200 });
        });
    });

    describe('cross-filtering behavior', () => {
        it('should not handle clicks when cross-filtering is disabled', () => {
            mockViewModel.hasCrossFiltering = false;

            const options = {
                pointSelection: mockPointSelection,
                clearCatcherSelection: mockClearCatcherSelection,
                viewModel: mockViewModel,
                hideTooltip: vi.fn()
            } as any;

            behaviorManager.bindEvents(options, mockSelectionHandler);

            // Get the click handler that was registered
            const clickCall = mockPointSelection.on.mock.calls.find(
                (call: any[]) => call[0] === 'click'
            );
            expect(clickCall).toBeDefined();

            // Call the click handler with a mock event and data
            const mockEvent = { ctrlKey: false };
            const mockData = { content: 'test' };
            clickCall[1](mockEvent, mockData);

            // Selection handler should not be called when cross-filtering is disabled
            expect(mockSelectionHandler.handleSelection).not.toHaveBeenCalled();
        });
    });
});

describe('host-event instrumentation in behavior', () => {
    beforeEach(() => resetForTests());

    it('records a cross-filter event with tooltip context on selection click', () => {
        setArmed(true);
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), ctrlKey: false } as any;
        mgr.handleSelectionClick(evt, { tooltips: [{ displayName: 'Region', value: 'East' }] } as any);
        const s = snapshot();
        expect(s.some((e) => e.type === 'cross-filter' && e.context === 'Region="East"')).toBe(true);
    });

    it('records a drill event with x,y on context menu', () => {
        setArmed(true);
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 320, clientY: 140 } as any;
        mgr.handleContextMenu(evt, { tooltips: [{ displayName: 'Region', value: 'East' }] } as any);
        const s = snapshot();
        expect(s.some((e) => e.type === 'drill' && e.summary.includes('320'))).toBe(true);
    });

    it('records a background drill when the datum is null', () => {
        setArmed(true);
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 1, clientY: 2 } as any;
        mgr.handleContextMenu(evt, null as any);
        expect(snapshot().some((e) => e.type === 'drill' && e.context === 'background')).toBe(true);
    });

    it('records a cross-filter cleared event on clear-catcher click', () => {
        setArmed(true);
        const mgr = new BehaviorManager<any>();
        const { options, clear } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        const clickCall = (clear.on as any).mock.calls.find((c: any[]) => c[0] === 'click');
        expect(clickCall).toBeTruthy();
        clickCall[1]({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(
            snapshot().some((e) => e.type === 'cross-filter' && e.summary === 'cleared')
        ).toBe(true);
    });
});
