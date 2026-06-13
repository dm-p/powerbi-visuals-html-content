/**
 * Pure render-lifecycle decision functions: the settings fingerprint and the
 * update classifier. Consumed by the RenderOrchestrator (added in a later
 * unit) to choose between rebuild, reconcile, and viewport-only render paths.
 */

import { VisualFormattingSettingsModel } from './visual-settings';

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
