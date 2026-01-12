import { describe, it, expect, beforeEach } from 'vitest';
import { ViewModelHandler } from '../src/view-model';

describe('ViewModelHandler', () => {
    let handler: ViewModelHandler;

    beforeEach(() => {
        handler = new ViewModelHandler();
    });

    describe('constructor and reset', () => {
        it('should initialize with default view model', () => {
            expect(handler.viewModel).toBeDefined();
            expect(handler.viewModel.isValid).toBe(false);
            expect(handler.viewModel.isEmpty).toBe(true);
            expect(handler.viewModel.hasCrossFiltering).toBe(false);
            expect(handler.viewModel.hasGranularity).toBe(false);
            expect(handler.viewModel.hasSelection).toBe(false);
            expect(handler.viewModel.contentIndex).toBe(-1);
            expect(handler.viewModel.htmlEntries).toEqual([]);
        });

        it('should reset view model to defaults', () => {
            // Modify view model
            handler.viewModel.isValid = true;
            handler.viewModel.isEmpty = false;
            handler.viewModel.htmlEntries = [
                {
                    content: 'test',
                    identity: {} as any,
                    selected: false,
                    tooltips: []
                }
            ];

            // Reset
            handler.reset();

            expect(handler.viewModel.isValid).toBe(false);
            expect(handler.viewModel.isEmpty).toBe(true);
            expect(handler.viewModel.htmlEntries).toEqual([]);
        });
    });

    describe('validateDataView', () => {
        it('should set isValid to false when dataViews is null', () => {
            handler.validateDataView(null as any);
            expect(handler.viewModel.isValid).toBe(false);
        });

        it('should set isValid to false when dataViews is empty array', () => {
            handler.validateDataView([]);
            expect(handler.viewModel.isValid).toBe(false);
        });

        it('should set isValid to false when dataView has no table', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: []
                    }
                }
            ];

            handler.validateDataView(dataViews);
            expect(handler.viewModel.isValid).toBe(false);
        });

        it('should set isValid to false when no content column exists', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            {
                                roles: { sampling: true },
                                displayName: 'Category'
                            }
                        ]
                    },
                    table: {
                        columns: [],
                        rows: []
                    }
                }
            ];

            handler.validateDataView(dataViews);
            expect(handler.viewModel.isValid).toBe(false);
            expect(handler.viewModel.contentIndex).toBe(-1);
        });

        it('should set isValid to true when content column exists', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            { roles: { content: true }, displayName: 'HTML' }
                        ]
                    },
                    table: {
                        columns: [
                            { roles: { content: true }, displayName: 'HTML' }
                        ],
                        rows: []
                    }
                }
            ];

            handler.validateDataView(dataViews);
            expect(handler.viewModel.isValid).toBe(true);
            expect(handler.viewModel.contentIndex).toBe(0);
        });

        it('should find content column at correct index', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            {
                                roles: { sampling: true },
                                displayName: 'Category'
                            },
                            {
                                roles: { tooltips: true },
                                displayName: 'Tooltip'
                            },
                            { roles: { content: true }, displayName: 'HTML' }
                        ]
                    },
                    table: {
                        columns: [
                            {
                                roles: { sampling: true },
                                displayName: 'Category'
                            },
                            {
                                roles: { tooltips: true },
                                displayName: 'Tooltip'
                            },
                            { roles: { content: true }, displayName: 'HTML' }
                        ],
                        rows: []
                    }
                }
            ];

            handler.validateDataView(dataViews);
            expect(handler.viewModel.isValid).toBe(true);
            expect(handler.viewModel.contentIndex).toBe(2);
        });

        it('should handle undefined dataViews', () => {
            handler.validateDataView(undefined as any);
            expect(handler.viewModel.isValid).toBe(false);
            expect(handler.viewModel.contentIndex).toBe(-1);
        });

        it('should handle dataView with missing metadata columns', () => {
            const dataViews: any[] = [
                {
                    metadata: {},
                    table: {
                        columns: [],
                        rows: []
                    }
                }
            ];

            handler.validateDataView(dataViews);
            expect(handler.viewModel.isValid).toBe(false);
        });
    });

    describe('mapDataView', () => {
        const mockHost = {
            createSelectionIdBuilder: () => ({
                withTable: () => ({
                    createSelectionId: () => ({ equals: () => false })
                })
            }),
            locale: 'en-US'
        } as any;

        const mockSettings = {
            crossFilter: {
                crossFilterCardMain: {
                    enabled: { value: false }
                }
            },
            contentFormatting: {}
        } as any;

        it('should not map data if view model is invalid', () => {
            handler.viewModel.isValid = false;

            handler.mapDataView([], mockSettings, mockHost);

            expect(handler.viewModel.htmlEntries).toEqual([]);
        });

        it('should map rows to htmlEntries when valid', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            { roles: { content: true }, displayName: 'HTML' }
                        ]
                    },
                    table: {
                        columns: [
                            { roles: { content: true }, displayName: 'HTML' }
                        ],
                        rows: [['<p>Test 1</p>'], ['<p>Test 2</p>']]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(dataViews, mockSettings, mockHost);

            expect(handler.viewModel.htmlEntries.length).toBe(2);
            expect(handler.viewModel.htmlEntries[0].content).toBe(
                '<p>Test 1</p>'
            );
            expect(handler.viewModel.htmlEntries[1].content).toBe(
                '<p>Test 2</p>'
            );
            expect(handler.viewModel.isEmpty).toBe(false);
        });

        it('should handle null content values', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            { roles: { content: true }, displayName: 'HTML' }
                        ]
                    },
                    table: {
                        columns: [
                            { roles: { content: true }, displayName: 'HTML' }
                        ],
                        rows: [[null], [undefined]]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(dataViews, mockSettings, mockHost);

            expect(handler.viewModel.htmlEntries.length).toBe(2);
            expect(handler.viewModel.htmlEntries[0].content).toBe('');
            expect(handler.viewModel.htmlEntries[1].content).toBe('');
        });

        it('should set hasGranularity when sampling column exists', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            {
                                roles: { sampling: true },
                                displayName: 'Category'
                            },
                            { roles: { content: true }, displayName: 'HTML' }
                        ]
                    },
                    table: {
                        columns: [
                            {
                                roles: { sampling: true },
                                displayName: 'Category'
                            },
                            { roles: { content: true }, displayName: 'HTML' }
                        ],
                        rows: [['A', '<p>Test</p>']]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(dataViews, mockSettings, mockHost);

            expect(handler.viewModel.hasGranularity).toBe(true);
        });

        it('should set hasCrossFiltering when enabled in settings', () => {
            const settingsWithCrossFilter = {
                ...mockSettings,
                crossFilter: {
                    crossFilterCardMain: {
                        enabled: { value: true }
                    }
                }
            } as any;

            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            {
                                roles: { sampling: true },
                                displayName: 'Category'
                            },
                            { roles: { content: true }, displayName: 'HTML' }
                        ]
                    },
                    table: {
                        columns: [
                            {
                                roles: { sampling: true },
                                displayName: 'Category'
                            },
                            { roles: { content: true }, displayName: 'HTML' }
                        ],
                        rows: [['A', '<p>Test</p>']]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(dataViews, settingsWithCrossFilter, mockHost);

            expect(handler.viewModel.hasGranularity).toBe(true);
            expect(handler.viewModel.hasCrossFiltering).toBe(true);
        });

        it('should set isEmpty to true when no rows exist', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            { roles: { content: true }, displayName: 'HTML' }
                        ]
                    },
                    table: {
                        columns: [
                            { roles: { content: true }, displayName: 'HTML' }
                        ],
                        rows: []
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(dataViews, mockSettings, mockHost);

            expect(handler.viewModel.isEmpty).toBe(true);
        });
    });
});
