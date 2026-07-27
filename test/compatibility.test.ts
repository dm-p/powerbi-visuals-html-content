import { describe, it, expect } from 'vitest';
import type powerbi from 'powerbi-visuals-api';
import {
    resolveCompatibility,
    readPersistedLegacyRendering,
    dataViewHasContentRole,
    CompatibilityState
} from '../src/compatibility';

/**
 * Spec: docs/brainstorms/2026-07-27-legacy-rendering-compatibility-mode.md
 *
 * The persisted `compatibility.legacyRendering` bool doubles as the version
 * marker. Classification matrix: marker present/absent × data/no-data ×
 * editable/view, plus the per-session cache and once-per-session persist
 * guard. Persistence itself (the deferred persistProperties call) is wired in
 * src/visual.ts; this module only *decides*.
 */

const freshState = (): CompatibilityState => ({
    mode: undefined,
    persistAttempted: false
});

describe('resolveCompatibility', () => {
    it('persisted marker wins: true → legacy ON, no persist', () => {
        const state = freshState();
        const r = resolveCompatibility(true, state, false, true);
        expect(r.legacyRendering).toBe(true);
        expect(r.shouldPersist).toBe(false);
        expect(state.mode).toBe(true);
    });

    it('persisted marker wins: false → legacy OFF, no persist, even with data bound', () => {
        const state = freshState();
        const r = resolveCompatibility(false, state, true, true);
        expect(r.legacyRendering).toBe(false);
        expect(r.shouldPersist).toBe(false);
    });

    it('persisted marker overrides a stale session cache (pane toggle flip)', () => {
        const state: CompatibilityState = {
            mode: true,
            persistAttempted: true
        };
        const r = resolveCompatibility(false, state, true, true);
        expect(r.legacyRendering).toBe(false);
        expect(state.mode).toBe(false);
    });

    it('unclassified + data bound → legacy ON (migrated 1.6 visual)', () => {
        const r = resolveCompatibility(undefined, freshState(), true, true);
        expect(r.legacyRendering).toBe(true);
    });

    it('unclassified + no data → legacy OFF (fresh visual on landing page)', () => {
        const r = resolveCompatibility(undefined, freshState(), false, true);
        expect(r.legacyRendering).toBe(false);
    });

    it('editable + unclassified → shouldPersist true', () => {
        const r = resolveCompatibility(undefined, freshState(), true, true);
        expect(r.shouldPersist).toBe(true);
    });

    it('view mode → never persist', () => {
        const r = resolveCompatibility(undefined, freshState(), true, false);
        expect(r.legacyRendering).toBe(true);
        expect(r.shouldPersist).toBe(false);
    });

    it('session cache is authoritative once set: heuristic does not re-run', () => {
        // Session classified modern (no data at first update); data arrives
        // later the same session — mode must NOT flip to legacy.
        const state = freshState();
        resolveCompatibility(undefined, state, false, false);
        const r = resolveCompatibility(undefined, state, true, false);
        expect(r.legacyRendering).toBe(false);
    });

    it('persist guard: once attempted, never asks again this session', () => {
        const state: CompatibilityState = {
            mode: true,
            persistAttempted: true
        };
        const r = resolveCompatibility(undefined, state, true, true);
        expect(r.shouldPersist).toBe(false);
    });

    it('view-mode session later opened editable (same session) → persists the cached mode', () => {
        const state = freshState();
        resolveCompatibility(undefined, state, true, false);
        const r = resolveCompatibility(undefined, state, true, true);
        expect(r.legacyRendering).toBe(true);
        expect(r.shouldPersist).toBe(true);
    });

    it('observing a persisted marker re-arms the persist guard', () => {
        const state: CompatibilityState = {
            mode: true,
            persistAttempted: true
        };
        resolveCompatibility(true, state, true, true);
        expect(state.persistAttempted).toBe(false);
    });

    it('pane reset mid-session re-stamps the cached mode (marker seen, then absent)', () => {
        const state = freshState();
        // Session opened with a persisted marker...
        resolveCompatibility(true, state, true, true);
        // ...then "Reset to default" wipes it: cached mode survives and a
        // re-stamp is requested immediately.
        const r = resolveCompatibility(undefined, state, true, true);
        expect(r.legacyRendering).toBe(true);
        expect(r.shouldPersist).toBe(true);
    });
});

describe('readPersistedLegacyRendering', () => {
    it('returns undefined when the marker object is absent', () => {
        expect(readPersistedLegacyRendering(undefined)).toBeUndefined();
        expect(
            readPersistedLegacyRendering({
                metadata: {}
            } as unknown as powerbi.DataView)
        ).toBeUndefined();
    });

    it('returns the persisted bool when present', () => {
        const dv = {
            metadata: {
                objects: { compatibility: { legacyRendering: true } }
            }
        } as unknown as powerbi.DataView;
        expect(readPersistedLegacyRendering(dv)).toBe(true);
        const dv2 = {
            metadata: {
                objects: { compatibility: { legacyRendering: false } }
            }
        } as unknown as powerbi.DataView;
        expect(readPersistedLegacyRendering(dv2)).toBe(false);
    });
});

describe('dataViewHasContentRole', () => {
    it('false for undefined / empty dataViews', () => {
        expect(dataViewHasContentRole(undefined)).toBe(false);
        expect(dataViewHasContentRole([])).toBe(false);
    });

    it('false when no column carries the content role', () => {
        const dvs = [
            {
                metadata: { columns: [{ roles: { sampling: true } }] }
            }
        ] as unknown as powerbi.DataView[];
        expect(dataViewHasContentRole(dvs)).toBe(false);
    });

    it('true when a column carries the content role', () => {
        const dvs = [
            {
                metadata: {
                    columns: [
                        { roles: { sampling: true } },
                        { roles: { content: true } }
                    ]
                }
            }
        ] as unknown as powerbi.DataView[];
        expect(dataViewHasContentRole(dvs)).toBe(true);
    });
});
