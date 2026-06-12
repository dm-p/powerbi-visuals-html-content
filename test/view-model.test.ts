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

        it('should set isValid to false when dataView has no categorical', () => {
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
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { sampling: true },
                                    displayName: 'Category'
                                },
                                values: []
                            }
                        ]
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
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML'
                                },
                                values: []
                            }
                        ]
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
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { sampling: true },
                                    displayName: 'Category'
                                },
                                values: []
                            },
                            {
                                source: {
                                    roles: { tooltips: true },
                                    displayName: 'Tooltip'
                                },
                                values: []
                            },
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML'
                                },
                                values: []
                            }
                        ]
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
                    categorical: {}
                }
            ];

            handler.validateDataView(dataViews);
            expect(handler.viewModel.isValid).toBe(false);
        });
    });

    describe('mapDataView', () => {
        const mockHost = {
            createSelectionIdBuilder: () => {
                const builder: any = {
                    withCategory: () => builder,
                    withMeasure: () => builder,
                    createSelectionId: () => ({ equals: () => false })
                };
                return builder;
            },
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
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'q0'
                            }
                        ]
                    },
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'q0'
                                },
                                values: ['<p>Test 1</p>', '<p>Test 2</p>']
                            }
                        ]
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
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'q0'
                            }
                        ]
                    },
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'q0'
                                },
                                values: [null, undefined]
                            }
                        ]
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
                                displayName: 'Category',
                                queryName: 'qs'
                            },
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'q0'
                            }
                        ]
                    },
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { sampling: true },
                                    displayName: 'Category',
                                    queryName: 'qs'
                                },
                                values: ['A']
                            }
                        ],
                        values: [
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'q0'
                                },
                                values: ['<p>Test</p>']
                            }
                        ]
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
                                displayName: 'Category',
                                queryName: 'qs'
                            },
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'q0'
                            }
                        ]
                    },
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { sampling: true },
                                    displayName: 'Category',
                                    queryName: 'qs'
                                },
                                values: ['A']
                            }
                        ],
                        values: [
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'q0'
                                },
                                values: ['<p>Test</p>']
                            }
                        ]
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
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'q0'
                            }
                        ]
                    },
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'q0'
                                },
                                values: []
                            }
                        ]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(dataViews, mockSettings, mockHost);

            expect(handler.viewModel.isEmpty).toBe(true);
        });

        it('should map measure-only content to a single entry (#130)', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            {
                                roles: { content: true },
                                displayName: 'Aggregate HTML',
                                queryName: 'mq'
                            }
                        ]
                    },
                    categorical: {
                        values: [
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'Aggregate HTML',
                                    queryName: 'mq'
                                },
                                values: ['<p>Aggregate</p>']
                            }
                        ]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(dataViews, mockSettings, mockHost);

            expect(handler.viewModel.htmlEntries.length).toBe(1);
            expect(handler.viewModel.htmlEntries[0].content).toBe(
                '<p>Aggregate</p>'
            );
            expect(handler.viewModel.isEmpty).toBe(false);
        });

        it('should ignore roles-less metadata columns without throwing (#159)', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            {
                                // no roles key — calc-group dynamic format string shape
                                displayName: '__Format',
                                queryName: 'fq'
                            },
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'mq'
                            }
                        ]
                    },
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'mq'
                                },
                                values: ['<p>Row 1</p>', '<p>Row 2</p>']
                            }
                        ],
                        values: [
                            {
                                source: {
                                    displayName: '__Format',
                                    queryName: 'fq'
                                },
                                values: ['@fmt1', '@fmt2']
                            }
                        ]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            expect(handler.viewModel.isValid).toBe(true);
            // Roles-less column sits at metadata index 0, so the provisional
            // (metadata-space) contentIndex must skip it (parity with the
            // pre-categorical #159 fix assertions).
            expect(handler.viewModel.contentIndex).toBe(1);
            expect(() =>
                handler.mapDataView(dataViews, mockSettings, mockHost)
            ).not.toThrow();
            expect(handler.viewModel.htmlEntries.length).toBe(2);
            expect(handler.viewModel.htmlEntries[0].content).toBe(
                '<p>Row 1</p>'
            );
            expect(handler.viewModel.htmlEntries[1].content).toBe(
                '<p>Row 2</p>'
            );
        });

        it('should map data and granularity when a roles-less column is present (#159)', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            { displayName: 'Format', format: '0.0%' },
                            {
                                roles: { sampling: true },
                                displayName: 'Category',
                                queryName: 'sq'
                            },
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'cq'
                            }
                        ]
                    },
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { sampling: true },
                                    displayName: 'Category',
                                    queryName: 'sq'
                                },
                                values: ['A']
                            },
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'cq'
                                },
                                values: ['<p>Test</p>']
                            }
                        ],
                        values: [
                            {
                                source: {
                                    displayName: 'Format',
                                    format: '0.0%'
                                },
                                values: ['0.5']
                            }
                        ]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(dataViews, mockSettings, mockHost);

            expect(handler.viewModel.hasGranularity).toBe(true);
            expect(handler.viewModel.htmlEntries.length).toBe(1);
            expect(handler.viewModel.htmlEntries[0].content).toBe(
                '<p>Test</p>'
            );
        });

        it('should exclude roles-less columns from tooltips (#159)', () => {
            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            { displayName: 'Format', format: '0.0%' },
                            {
                                roles: { tooltips: true },
                                displayName: 'Tooltip',
                                queryName: 'tq'
                            },
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'cq'
                            }
                        ]
                    },
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'cq'
                                },
                                values: ['<p>Test</p>']
                            }
                        ],
                        values: [
                            {
                                source: {
                                    roles: { tooltips: true },
                                    displayName: 'Tooltip',
                                    queryName: 'tq'
                                },
                                values: ['Tip value']
                            },
                            {
                                source: {
                                    displayName: 'Format',
                                    format: '0.0%'
                                },
                                values: ['0.5']
                            }
                        ]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(dataViews, mockSettings, mockHost);

            const tooltips = handler.viewModel.htmlEntries[0].tooltips;
            expect(tooltips.length).toBe(1);
            expect(tooltips[0].displayName).toBe('Tooltip');
            expect(tooltips[0].value).toBe('Tip value');
        });
    });
});
