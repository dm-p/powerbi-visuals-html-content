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

/**
 * Stable string of all parse/render-affecting settings.
 *
 * The EFFECTIVE body template participates so a body change forces a rebuild:
 * the body wrapper is parsed once per rebuild and reused (not re-parsed) on
 * reconcile, so a stale wrapper must be ruled out by the fingerprint. The
 * resolved body (from the view model, which folds in a CF "apply to all" body)
 * takes precedence over the static setting; a CF-resolved body change arrives
 * with a Data bit but would NOT otherwise rebuild in reconcile mode. The row
 * template's per-row CF variation is caught instead by the per-row content-diff
 * (rowRenderKey), so only the STATIC row value is included here as a coarse
 * guard for a global row-template change.
 *
 * @param settings              - Parsed visual formatting settings.
 * @param resolvedBodyTemplate  - The resolved body template from the view model
 *                                (overrides the static body setting when given).
 *                                Optional so existing callers/tests degrade.
 */
export function computeRenderFingerprint(
    settings: VisualFormattingSettingsModel,
    resolvedBodyTemplate?: string
): string {
    const b = settings.contentFormatting.contentFormattingCardBehavior;
    const body =
        settings.contentFormatting.contentFormattingCardDefaultBodyStyling;
    return JSON.stringify([
        b.format.value,
        b.hyperlinks.value,
        b.showRawHtml.value,
        b.enableDiagnostics.value,
        b.userSelect.value,
        b.renderMode.value,
        settings.stylesheet.stylesheetCardMain.stylesheet.value,
        body.fontFamily.value,
        body.fontSize.value,
        body.fontColour.value.value,
        body.align.value,
        body.overrideInlineStyling.value,
        resolvedBodyTemplate ??
            settings.templates.templatesCardMain.bodyTemplate.value,
        settings.templates.templatesCardMain.rowTemplate.value
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
        settings: VisualFormattingSettingsModel
    ): void {
        const fingerprint = computeRenderFingerprint(
            settings,
            viewModel.bodyTemplate
        );
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

    /**
     * Reset to the initial state so the next render is treated as a first
     * render (a clean rebuild). The visual calls this after wiping the content
     * container on an error, so the orchestrator's cached state can never
     * disagree with the now-empty DOM — otherwise a subsequent viewport-only
     * update (no Data bit, unchanged fingerprint) would skip rendering and
     * leave the wiped container blank.
     */
    reset(): void {
        this.firstRender = true;
        this.lastFingerprint = '';
        this.lastKind = undefined;
    }
}
