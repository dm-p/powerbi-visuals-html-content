import { describe, it, expect, vi } from 'vitest';
import {
    computeRenderFingerprint,
    isEntryAffectingUpdate,
    RenderOrchestrator
} from '../src/render-orchestrator';

/**
 * VisualUpdateType is a const enum in powerbi-visuals-api; esbuild/vitest
 * cannot inline const enums from external declaration files, so we mirror the
 * literal values here.  Only the bits used by the tests are defined:
 * Data=2, Resize=4, ViewMode=8, Style=16, ResizeEnd=32.
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
    it('changes when the stylesheet text changes', () => {
        const base = settings();
        const withCss = settings();
        withCss.stylesheet.stylesheetCardMain.stylesheet.value =
            '.x{color:red}';
        expect(computeRenderFingerprint(withCss)).not.toBe(
            computeRenderFingerprint(base)
        );
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
        // 126 (0b1111110) and 254 (0b11111110) are undocumented composite update
        // types the host has emitted in the wild (#422). Both include the Data bit
        // (2), so the bitwise-AND classifier catches them; an `=== Data` check would
        // not. The exact high bits (64/128/256 = sub-selection / format-mode /
        // filter-options changes) are irrelevant — only the Data bit matters here.
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

// Minimal fakes; the orchestrator's render steps are injected so we can
// assert which branch ran without a real Power BI host or live DOM.
const makeDeps = () => ({
    rebuild: vi.fn(),
    reconcile: vi.fn(),
    renderEmptyOrRaw: vi.fn(),
    bindInteractivity: vi.fn(),
    resolveContainer: vi.fn()
});

const populatedViewModel = {
    isValid: true,
    isEmpty: false,
    htmlEntries: [{ content: 'A', identity: { getKey: () => 'a' } }]
} as any;

describe('RenderOrchestrator dispatch', () => {
    it('viewport-only update does not touch entries', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        o.render({ type: VUT.Data } as any, populatedViewModel, settings()); // first render seeds state
        deps.rebuild.mockClear();
        deps.reconcile.mockClear();
        o.render({ type: VUT.Resize } as any, populatedViewModel, settings());
        expect(deps.rebuild).not.toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
        expect(deps.resolveContainer).toHaveBeenCalled();
    });

    it('entry-affecting update in rebuild mode rebuilds', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        o.render(
            { type: VUT.Data } as any,
            populatedViewModel,
            settings({ renderMode: 'rebuild' })
        );
        expect(deps.rebuild).toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
    });

    it('reconcile mode with unchanged fingerprint reconciles (not first render)', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        const s = settings({ renderMode: 'reconcile' });
        o.render({ type: VUT.Data } as any, populatedViewModel, s); // first = rebuild baseline
        deps.rebuild.mockClear();
        o.render({ type: VUT.Data } as any, populatedViewModel, s);
        expect(deps.reconcile).toHaveBeenCalled();
        expect(deps.rebuild).not.toHaveBeenCalled();
    });

    it('reconcile mode rebuilds when the fingerprint changed', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        o.render(
            { type: VUT.Data } as any,
            populatedViewModel,
            settings({ renderMode: 'reconcile' })
        );
        deps.rebuild.mockClear();
        deps.reconcile.mockClear();
        o.render(
            { type: VUT.Data } as any,
            populatedViewModel,
            settings({ renderMode: 'reconcile', format: 'markdown' })
        );
        expect(deps.rebuild).toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
    });

    it('empty view model takes the empty path, never reconcile', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        o.render(
            { type: VUT.Data } as any,
            { isValid: true, isEmpty: true, htmlEntries: [] } as any,
            settings({ renderMode: 'reconcile' })
        );
        expect(deps.renderEmptyOrRaw).toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
    });

    it('first render in reconcile mode rebuilds (no baseline yet)', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        o.render(
            { type: VUT.Data } as any,
            populatedViewModel,
            settings({ renderMode: 'reconcile' })
        );
        expect(deps.rebuild).toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
    });

    it('reconcile mode rebuilds when kind changed (empty -> populated)', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        const s = settings({ renderMode: 'reconcile' });
        // first render is empty -> kind 'empty-or-raw'
        o.render(
            { type: VUT.Data } as any,
            { isValid: true, isEmpty: true, htmlEntries: [] } as any,
            s
        );
        deps.rebuild.mockClear();
        deps.reconcile.mockClear();
        // now populated with the SAME settings (fingerprint unchanged): the
        // kind changed empty->populated, so there is no DOM baseline to
        // reconcile against -> must rebuild, not reconcile.
        o.render({ type: VUT.Data } as any, populatedViewModel, s);
        expect(deps.rebuild).toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
    });

    it('reset() forces the next render to rebuild even on a viewport-only update', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        const s = settings({ renderMode: 'reconcile' });
        o.render({ type: VUT.Data } as any, populatedViewModel, s); // baseline
        o.render({ type: VUT.Data } as any, populatedViewModel, s); // reconcile active
        deps.rebuild.mockClear();
        deps.reconcile.mockClear();
        // Simulate the error-recovery path: container wiped + orchestrator reset.
        o.reset();
        // A viewport-only update type would normally skip entry rendering, but
        // after reset the next render must rebuild so the wiped DOM is restored.
        o.render({ type: VUT.Resize } as any, populatedViewModel, s);
        expect(deps.rebuild).toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
    });
});
