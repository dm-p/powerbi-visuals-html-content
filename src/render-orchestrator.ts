/**
 * Pure render-lifecycle decision functions: the settings fingerprint and the
 * update classifier. Consumed by the RenderOrchestrator to choose between
 * rebuild, reconcile, and viewport-only render paths.
 */

import powerbi from 'powerbi-visuals-api';
import { VisualFormattingSettingsModel } from './visual-settings';
import { IViewModel } from './view-model';

/**
 * VisualUpdateType.Data = 1 << 1 = 2.
 * Defined as a const enum in powerbi-visuals-api, which esbuild/vitest does
 * not inline from external declaration files, so we use the literal value.
 */
const DATA_BIT = 1 << 1; // 2

/** Stable string of all parse/render-affecting settings. */
export function computeRenderFingerprint(
    settings: VisualFormattingSettingsModel
): string {
    const b = settings.contentFormatting.contentFormattingCardBehavior;
    const body =
        settings.contentFormatting.contentFormattingCardDefaultBodyStyling;
    return JSON.stringify([
        b.format.value,
        b.hyperlinks.value,
        b.showRawHtml.value,
        b.userSelect.value,
        b.renderMode.value,
        settings.stylesheet.stylesheetCardMain.stylesheet.value,
        body.fontFamily.value,
        body.fontSize.value,
        body.fontColour.value.value,
        body.align.value,
        body.overrideInlineStyling.value
    ]);
}

/** True when entries must be re-evaluated; false = viewport-only. */
export function isEntryAffectingUpdate(
    updateType: number,
    firstRender: boolean,
    fingerprintChanged: boolean
): boolean {
    const hasDataBit = (updateType & DATA_BIT) === DATA_BIT;
    return firstRender || hasDataBit || fingerprintChanged;
}

export interface RenderSteps {
    rebuild: (vm: IViewModel, settings: VisualFormattingSettingsModel) => void;
    reconcile: (
        vm: IViewModel,
        settings: VisualFormattingSettingsModel
    ) => void;
    renderEmptyOrRaw: (
        vm: IViewModel,
        settings: VisualFormattingSettingsModel
    ) => void;
    bindInteractivity: (vm: IViewModel) => void;
    resolveContainer: (settings: VisualFormattingSettingsModel) => void;
}

type RenderKind = 'populated' | 'empty-or-raw';

export class RenderOrchestrator {
    private firstRender = true;
    private lastFingerprint = '';
    private lastKind: RenderKind | undefined;
    constructor(private steps: RenderSteps) {}

    render(
        options: powerbi.extensibility.visual.VisualUpdateOptions,
        viewModel: IViewModel,
        settings: VisualFormattingSettingsModel,
        // Reserved for U5 wiring (passed through from Visual.update); unused here.
        _host: powerbi.extensibility.visual.IVisualHost
    ): void {
        const fingerprint = computeRenderFingerprint(settings);
        const fingerprintChanged = fingerprint !== this.lastFingerprint;
        const entryAffecting = isEntryAffectingUpdate(
            options.type,
            this.firstRender,
            fingerprintChanged
        );
        this.steps.resolveContainer(settings);
        if (entryAffecting) {
            const raw =
                settings.contentFormatting.contentFormattingCardBehavior
                    .showRawHtml.value;
            const kind: RenderKind =
                viewModel.isEmpty || raw ? 'empty-or-raw' : 'populated';
            const kindChanged = kind !== this.lastKind;
            const mode =
                settings.contentFormatting.contentFormattingCardBehavior
                    .renderMode.value;
            if (kind === 'empty-or-raw') {
                this.steps.renderEmptyOrRaw(viewModel, settings);
                // Reconcile only when a prior populated DOM baseline exists (not first
                // render, kind unchanged) and nothing parse-affecting changed; any of
                // these failing means there is no safe baseline to preserve, so rebuild.
            } else if (
                mode === 'reconcile' &&
                !fingerprintChanged &&
                !this.firstRender &&
                !kindChanged
            ) {
                this.steps.reconcile(viewModel, settings);
                this.steps.bindInteractivity(viewModel);
            } else {
                this.steps.rebuild(viewModel, settings);
                this.steps.bindInteractivity(viewModel);
            }
            this.lastKind = kind;
        }
        this.lastFingerprint = fingerprint;
        this.firstRender = false;
    }
}
