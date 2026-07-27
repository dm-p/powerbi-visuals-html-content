import type powerbi from 'powerbi-visuals-api';

/**
 * Legacy (v1.6) rendering compatibility classification.
 *
 * Spec: docs/brainstorms/2026-07-27-legacy-rendering-compatibility-mode.md
 *
 * The persisted `compatibility.legacyRendering` bool doubles as the version
 * marker: absent ⇒ the instance has never been classified. Classification is
 * resolved in-memory FIRST (rendering never waits on persistence); the caller
 * persists the marker only when the report is editable, deferred until after
 * the current update's rendering-event pair has closed (src/visual.ts).
 */

/** Per-session classification state, held on the visual instance. */
export interface CompatibilityState {
    /** Resolved mode for this session; undefined = not yet classified. */
    mode: boolean | undefined;
    /** True once a persist has been scheduled this session (guard). */
    persistAttempted: boolean;
}

/** Result of resolving one update's compatibility mode. */
export interface CompatibilityResolution {
    /** The mode this update must render with. */
    legacyRendering: boolean;
    /** True when the caller should schedule a persistProperties stamp. */
    shouldPersist: boolean;
}

/**
 * Resolve the rendering mode for one update. Mutates `state.mode` so the
 * session cache survives across updates. Precedence:
 *   1. persisted marker (also refreshes the session cache — the pane toggle
 *      writes through this path; observing a marker also re-arms the
 *      persist guard, so a later marker ABSENCE — a format-pane "Reset to
 *      default" — is treated as a fresh event and re-stamped immediately
 *      from the session cache rather than silently left unmarked);
 *   2. session cache (heuristic runs at most once per session);
 *   3. data-bound heuristic: content role bound ⇒ migrated ⇒ legacy ON.
 * Persistence is requested only when the marker is absent, the report is
 * editable, and no persist has been attempted this session.
 *
 * The caller MUST set `state.persistAttempted = true` when it actually
 * schedules the persist requested via `shouldPersist` — this function only
 * requests, it never records the attempt.
 */
export const resolveCompatibility = (
    persisted: boolean | undefined,
    state: CompatibilityState,
    hasContentRole: boolean,
    editable: boolean
): CompatibilityResolution => {
    if (persisted !== undefined) {
        state.mode = persisted;
        // Re-arm the persist guard: while a marker exists, any future
        // marker ABSENCE (format-pane "Reset to default") is a fresh event
        // that must be re-stamped — otherwise a reset in the same session
        // that originally stamped the marker would silently save the report
        // unmarked and defer reclassification to the next open. Loop-safe:
        // the re-stamp's echo carries the marker and lands back here.
        state.persistAttempted = false;
        return { legacyRendering: persisted, shouldPersist: false };
    }
    if (state.mode === undefined) {
        state.mode = hasContentRole;
    }
    return {
        legacyRendering: state.mode,
        shouldPersist: editable && !state.persistAttempted
    };
};

/**
 * Raw marker read. Deliberately NOT the formatting-settings model, which
 * cannot distinguish "absent" from "explicitly set to the default".
 */
export const readPersistedLegacyRendering = (
    dataView: powerbi.DataView | undefined
): boolean | undefined => {
    const value = dataView?.metadata?.objects?.compatibility?.legacyRendering;
    return typeof value === 'boolean' ? value : undefined;
};

/**
 * "Data bound" per the spec: the update's dataViews carry the `content` role
 * (the same condition that takes the visual off the landing page).
 */
export const dataViewHasContentRole = (
    dataViews: powerbi.DataView[] | undefined
): boolean =>
    dataViews?.[0]?.metadata?.columns?.some((c) => c.roles?.content) ?? false;
