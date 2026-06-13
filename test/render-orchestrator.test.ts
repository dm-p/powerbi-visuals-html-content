import { describe, it, expect } from 'vitest';
import {
    computeRenderFingerprint,
    isEntryAffectingUpdate
} from '../src/render-orchestrator';

/**
 * VisualUpdateType is a const enum in powerbi-visuals-api.  esbuild (used by
 * vitest) does not inline const enums from external declaration files, so we
 * mirror the literal values here.  Values: Data=2, Resize=4, ViewMode=8,
 * Style=16, ResizeEnd=32, All=2|4|8|16|32|64|128|256=510.
 */
const VUT = {
    Data: 1 << 1, // 2
    Resize: 1 << 2, // 4
    ViewMode: 1 << 3, // 8
    Style: 1 << 4, // 16
    ResizeEnd: 1 << 5 // 32
} as const;

const settings = (over: Record<string, unknown> = {}) =>
    ({
        contentFormatting: {
            contentFormattingCardBehavior: {
                format: { value: over.format ?? 'html' },
                hyperlinks: { value: over.hyperlinks ?? false },
                showRawHtml: { value: over.showRawHtml ?? false },
                userSelect: { value: false },
                renderMode: { value: over.renderMode ?? 'rebuild' }
            },
            contentFormattingCardDefaultBodyStyling: {
                fontFamily: { value: 'Arial' },
                fontSize: { value: 11 },
                fontColour: { value: { value: '#000' } },
                align: { value: 'left' },
                overrideInlineStyling: { value: false }
            }
        },
        stylesheet: { stylesheetCardMain: { stylesheet: { value: '' } } }
    }) as any;

describe('computeRenderFingerprint', () => {
    it('is stable for identical settings', () => {
        expect(computeRenderFingerprint(settings())).toBe(
            computeRenderFingerprint(settings())
        );
    });
    it('changes when a parse-affecting property changes', () => {
        expect(
            computeRenderFingerprint(settings({ format: 'markdown' }))
        ).not.toBe(computeRenderFingerprint(settings()));
    });
    it('changes when renderMode changes (forces rebuild baseline)', () => {
        expect(
            computeRenderFingerprint(settings({ renderMode: 'reconcile' }))
        ).not.toBe(computeRenderFingerprint(settings()));
    });
});

describe('isEntryAffectingUpdate', () => {
    it('is true on first render regardless of type', () => {
        expect(isEntryAffectingUpdate(VUT.Resize, true, false)).toBe(true);
    });
    it('is true when the Data bit is set', () => {
        expect(isEntryAffectingUpdate(VUT.Data, false, false)).toBe(true);
        expect(
            isEntryAffectingUpdate(VUT.Data | VUT.Resize, false, false)
        ).toBe(true);
    });
    it('is true when the fingerprint changed without a Data bit', () => {
        expect(isEntryAffectingUpdate(VUT.Resize, false, true)).toBe(true);
    });
    it('is false for viewport-only updates (resize / view-mode)', () => {
        expect(isEntryAffectingUpdate(VUT.Resize, false, false)).toBe(false);
        expect(isEntryAffectingUpdate(VUT.ViewMode, false, false)).toBe(false);
        expect(isEntryAffectingUpdate(VUT.ResizeEnd, false, false)).toBe(false);
    });
    it('treats undocumented high-bit types (126, 254) as entry-affecting via the Data bit (#422)', () => {
        // 126 = All | 64, 254 = All | 128; both contain Data (2). Equality
        // checks would miss these — only bitwise AND is correct.
        expect(isEntryAffectingUpdate(126, false, false)).toBe(true);
        expect(isEntryAffectingUpdate(254, false, false)).toBe(true);
    });
    it('treats a high-bit-decorated viewport update (no Data bit) as viewport-only', () => {
        // Resize (4) with an undocumented high bit (64) set, but no Data bit.
        expect(isEntryAffectingUpdate(VUT.Resize | 64, false, false)).toBe(
            false
        );
    });
});
