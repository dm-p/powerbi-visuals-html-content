import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorManager } from '../src/behavior';
import { IViewModel, IHtmlEntry } from '../src/view-model';
import { VisualConstants } from '../src/visual-constants';

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
                viewModel: mockViewModel
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
                viewModel: mockViewModel
            } as any;

            behaviorManager.bindEvents(options, mockSelectionHandler);
            behaviorManager.renderSelection(true);

            expect(mockViewModel.hasSelection).toBe(true);
        });

        it('should apply unselected class to dimmed points', () => {
            const options = {
                pointSelection: mockPointSelection,
                clearCatcherSelection: mockClearCatcherSelection,
                viewModel: mockViewModel
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
                viewModel: mockViewModel
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
                viewModel: mockViewModel
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
                viewModel: mockViewModel
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
