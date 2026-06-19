import { describe, it, expect, beforeEach } from 'vitest';
import { VisualFormattingSettingsModel } from '../src/visual-settings';
import { IViewModel } from '../src/view-model';
import { VisualConstants } from '../src/visual-constants';
import capabilities from '../capabilities.json';

describe('VisualFormattingSettingsModel', () => {
    let settings: VisualFormattingSettingsModel;
    let mockViewModel: IViewModel;

    beforeEach(() => {
        settings = new VisualFormattingSettingsModel();
        mockViewModel = {
            isValid: true,
            isEmpty: false,
            hasCrossFiltering: false,
            hasGranularity: false,
            hasSelection: false,
            contentIndex: 0,
            htmlEntries: [],
            contentFormatting: {}
        };
    });

    describe('constructor', () => {
        it('should initialize with contentFormatting card', () => {
            expect(settings.contentFormatting).toBeDefined();
            expect(settings.contentFormatting.name).toBe('contentFormatting');
        });

        it('should initialize with stylesheet card', () => {
            expect(settings.stylesheet).toBeDefined();
            expect(settings.stylesheet.name).toBe('stylesheet');
        });

        it('should initialize with crossFilter card', () => {
            expect(settings.crossFilter).toBeDefined();
            expect(settings.crossFilter.name).toBe('crossFilter');
        });

        it('should have four cards in total', () => {
            expect(settings.cards).toHaveLength(4);
        });
    });

    describe('handlePropertyVisibility', () => {
        describe('defaultBodyStyling visibility', () => {
            it('should show defaultBodyStyling when showRawHtml is false and no stylesheet', () => {
                settings.contentFormatting.contentFormattingCardBehavior.showRawHtml.value = false;
                settings.stylesheet.stylesheetCardMain.stylesheet.value = '';

                settings.handlePropertyVisibility(mockViewModel);

                expect(
                    settings.contentFormatting
                        .contentFormattingCardDefaultBodyStyling.visible
                ).toBe(true);
            });

            it('should hide defaultBodyStyling when showRawHtml is true', () => {
                settings.contentFormatting.contentFormattingCardBehavior.showRawHtml.value = true;
                settings.stylesheet.stylesheetCardMain.stylesheet.value = '';

                settings.handlePropertyVisibility(mockViewModel);

                expect(
                    settings.contentFormatting
                        .contentFormattingCardDefaultBodyStyling.visible
                ).toBe(false);
            });

            it('should hide defaultBodyStyling when stylesheet has content', () => {
                settings.contentFormatting.contentFormattingCardBehavior.showRawHtml.value = false;
                settings.stylesheet.stylesheetCardMain.stylesheet.value =
                    'body { color: red; }';

                settings.handlePropertyVisibility(mockViewModel);

                expect(
                    settings.contentFormatting
                        .contentFormattingCardDefaultBodyStyling.visible
                ).toBe(false);
            });

            it('should hide defaultBodyStyling when both showRawHtml and stylesheet are set', () => {
                settings.contentFormatting.contentFormattingCardBehavior.showRawHtml.value = true;
                settings.stylesheet.stylesheetCardMain.stylesheet.value =
                    'body { color: red; }';

                settings.handlePropertyVisibility(mockViewModel);

                expect(
                    settings.contentFormatting
                        .contentFormattingCardDefaultBodyStyling.visible
                ).toBe(false);
            });
        });

        describe('crossFilter visibility', () => {
            it('should hide crossFilter card when hasGranularity is false', () => {
                mockViewModel.hasGranularity = false;

                settings.handlePropertyVisibility(mockViewModel);

                expect(settings.crossFilter.visible).toBe(false);
            });

            it('should show useTransparency when hasGranularity and enabled', () => {
                mockViewModel.hasGranularity = true;
                settings.crossFilter.crossFilterCardMain.enabled.value = true;

                settings.handlePropertyVisibility(mockViewModel);

                expect(
                    settings.crossFilter.crossFilterCardMain.useTransparency
                        .visible
                ).toBe(true);
            });

            it('should hide useTransparency when hasGranularity but not enabled', () => {
                mockViewModel.hasGranularity = true;
                settings.crossFilter.crossFilterCardMain.enabled.value = false;

                settings.handlePropertyVisibility(mockViewModel);

                expect(
                    settings.crossFilter.crossFilterCardMain.useTransparency
                        .visible
                ).toBe(false);
            });

            it('should show transparencyPercent when hasGranularity, enabled, and useTransparency', () => {
                mockViewModel.hasGranularity = true;
                settings.crossFilter.crossFilterCardMain.enabled.value = true;
                settings.crossFilter.crossFilterCardMain.useTransparency.value = true;

                settings.handlePropertyVisibility(mockViewModel);

                expect(
                    settings.crossFilter.crossFilterCardMain.transparencyPercent
                        .visible
                ).toBe(true);
            });

            it('should hide transparencyPercent when enabled but useTransparency is false', () => {
                mockViewModel.hasGranularity = true;
                settings.crossFilter.crossFilterCardMain.enabled.value = true;
                settings.crossFilter.crossFilterCardMain.useTransparency.value = false;

                settings.handlePropertyVisibility(mockViewModel);

                expect(
                    settings.crossFilter.crossFilterCardMain.transparencyPercent
                        .visible
                ).toBe(false);
            });

            it('should hide transparencyPercent when not enabled', () => {
                mockViewModel.hasGranularity = true;
                settings.crossFilter.crossFilterCardMain.enabled.value = false;
                settings.crossFilter.crossFilterCardMain.useTransparency.value = true;

                settings.handlePropertyVisibility(mockViewModel);

                expect(
                    settings.crossFilter.crossFilterCardMain.transparencyPercent
                        .visible
                ).toBe(false);
            });
        });
    });

    describe('ContentFormattingSettings', () => {
        it('should have behavior group', () => {
            expect(
                settings.contentFormatting.contentFormattingCardBehavior
            ).toBeDefined();
            expect(
                settings.contentFormatting.contentFormattingCardBehavior.name
            ).toBe('contentFormatting-behavior');
        });

        it('should have noData group', () => {
            expect(
                settings.contentFormatting.contentFormattingCardNoData
            ).toBeDefined();
            expect(
                settings.contentFormatting.contentFormattingCardNoData.name
            ).toBe('contentFormatting-noData');
        });

        it('should have defaultBodyStyling group', () => {
            expect(
                settings.contentFormatting
                    .contentFormattingCardDefaultBodyStyling
            ).toBeDefined();
            expect(
                settings.contentFormatting
                    .contentFormattingCardDefaultBodyStyling.name
            ).toBe('contentFormatting-defaultBodyStyling');
        });

        it('should have format setting', () => {
            expect(
                settings.contentFormatting.contentFormattingCardBehavior.format
            ).toBeDefined();
        });

        it('exposes renderMode defaulting to rebuild', () => {
            const behavior =
                settings.contentFormatting.contentFormattingCardBehavior;
            expect(behavior.renderMode).toBeDefined();
            expect(behavior.renderMode.value).toBe('rebuild');
            expect(behavior.renderMode.value).toBe(
                VisualConstants.contentFormatting.renderMode
            );
            expect(behavior.slices).toContain(behavior.renderMode);
        });

        it('should have showRawHtml setting', () => {
            expect(
                settings.contentFormatting.contentFormattingCardBehavior
                    .showRawHtml
            ).toBeDefined();
        });

        it('should have hyperlinks setting', () => {
            expect(
                settings.contentFormatting.contentFormattingCardBehavior
                    .hyperlinks
            ).toBeDefined();
        });

        it('should have userSelect setting', () => {
            expect(
                settings.contentFormatting.contentFormattingCardBehavior
                    .userSelect
            ).toBeDefined();
        });

        it('should have noDataMessage setting', () => {
            expect(
                settings.contentFormatting.contentFormattingCardNoData
                    .noDataMessage
            ).toBeDefined();
        });

        it('should have font settings', () => {
            expect(
                settings.contentFormatting
                    .contentFormattingCardDefaultBodyStyling.fontFamily
            ).toBeDefined();
            expect(
                settings.contentFormatting
                    .contentFormattingCardDefaultBodyStyling.fontSize
            ).toBeDefined();
            expect(
                settings.contentFormatting
                    .contentFormattingCardDefaultBodyStyling.fontColour
            ).toBeDefined();
            expect(
                settings.contentFormatting
                    .contentFormattingCardDefaultBodyStyling.align
            ).toBeDefined();
        });
    });

    describe('StylesheetSettings', () => {
        it('should have main group', () => {
            expect(settings.stylesheet.stylesheetCardMain).toBeDefined();
            expect(settings.stylesheet.stylesheetCardMain.name).toBe(
                'stylesheet-main'
            );
        });

        it('should have stylesheet textarea', () => {
            expect(
                settings.stylesheet.stylesheetCardMain.stylesheet
            ).toBeDefined();
        });

        it('should default to empty stylesheet', () => {
            expect(
                settings.stylesheet.stylesheetCardMain.stylesheet.value
            ).toBe('');
        });
    });

    describe('CrossFilterSettings', () => {
        it('should have main group', () => {
            expect(settings.crossFilter.crossFilterCardMain).toBeDefined();
            expect(settings.crossFilter.crossFilterCardMain.name).toBe(
                'crossFilter-main'
            );
        });

        it('should have enabled toggle', () => {
            expect(
                settings.crossFilter.crossFilterCardMain.enabled
            ).toBeDefined();
        });

        it('should have useTransparency toggle', () => {
            expect(
                settings.crossFilter.crossFilterCardMain.useTransparency
            ).toBeDefined();
        });

        it('should have transparencyPercent slider', () => {
            expect(
                settings.crossFilter.crossFilterCardMain.transparencyPercent
            ).toBeDefined();
        });

        it('should default enabled to false', () => {
            expect(settings.crossFilter.crossFilterCardMain.enabled.value).toBe(
                false
            );
        });

        it('should default useTransparency to true', () => {
            expect(
                settings.crossFilter.crossFilterCardMain.useTransparency.value
            ).toBe(true);
        });

        it('should default transparencyPercent to 70', () => {
            expect(
                settings.crossFilter.crossFilterCardMain.transparencyPercent
                    .value
            ).toBe(70);
        });
    });
});

describe('ContentFormattingCardBehavior enableDiagnostics', () => {
    it('exposes enableDiagnostics off by default after showRawHtml', () => {
        const model = new VisualFormattingSettingsModel();
        const behavior = model.contentFormatting.contentFormattingCardBehavior;
        expect(behavior.enableDiagnostics.value).toBe(false);
        const names = behavior.slices.map((s: any) => s.name);
        expect(names).toContain('enableDiagnostics');
        expect(names.indexOf('enableDiagnostics')).toBeGreaterThan(
            names.indexOf('showRawHtml')
        );
    });
});

describe('TemplatesSettings', () => {
    it('exposes body + row templates with byte-identical defaults', () => {
        const settings = new VisualFormattingSettingsModel();
        const main = settings.templates.templatesCardMain;
        expect(main.bodyTemplate.value).toBe('{{content}}');
        expect(main.rowTemplate.value).toBe('<div><div>{{row}}</div></div>');
        expect(main.slices).toContain(main.bodyTemplate);
        expect(main.slices).toContain(main.rowTemplate);
        expect(settings.cards).toContain(settings.templates);
    });
    it('bodyTemplate is conditional-formattable; rowTemplate is a plain property (no CF)', () => {
        const main = new VisualFormattingSettingsModel().templates
            .templatesCardMain;
        // bodyTemplate retains single-value CF (ConstantOrRule = 3)
        // VisualEnumerationInstanceKinds.ConstantOrRule = Constant(1) | Rule(2) = 3
        expect(main.bodyTemplate.instanceKind).toBe(3);
        // rowTemplate is a plain TextArea — no instanceKind set
        expect(main.rowTemplate.instanceKind).toBeUndefined();
    });
});

describe('capabilities.json persistence parity', () => {
    // A format slice only PERSISTS if it is declared in capabilities.json under
    // its object's properties — the formatting-model class only builds the pane
    // UI. A slice missing from capabilities renders in the pane but reverts to
    // its default on the next update (the enableDiagnostics UAT bug).
    it('declares every contentFormatting behavior slice so values persist', () => {
        const model = new VisualFormattingSettingsModel();
        const sliceNames =
            model.contentFormatting.contentFormattingCardBehavior.slices.map(
                (s: { name: string }) => s.name
            );
        const props = (
            capabilities as {
                objects: {
                    contentFormatting: { properties: Record<string, unknown> };
                };
            }
        ).objects.contentFormatting.properties;
        for (const name of sliceNames) {
            expect(
                Object.prototype.hasOwnProperty.call(props, name),
                `capabilities.json must declare contentFormatting.${name} or its value will not persist`
            ).toBe(true);
        }
    });

    it('declares enableDiagnostics as a bool property', () => {
        const props = (
            capabilities as {
                objects: {
                    contentFormatting: {
                        properties: {
                            enableDiagnostics?: { type?: { bool?: boolean } };
                        };
                    };
                };
            }
        ).objects.contentFormatting.properties;
        expect(props.enableDiagnostics?.type?.bool).toBe(true);
    });
});
