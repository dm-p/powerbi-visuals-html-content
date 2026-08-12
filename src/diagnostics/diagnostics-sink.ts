/**
 * Passive sanitizer-removal sink. `recordRemoval` is a no-op unless armed, so
 * the sanitizer's behaviour is byte-identical when diagnostics is off and no
 * sanitize/CSS signature has to change. Capped at capture time so a huge
 * multi-row render can't grow the buffer unbounded.
 *
 * Imports nothing from the pipeline — one-way dependency, no cycles.
 */
import { SanitizerEntry, SanitizerCapture } from './types';
import { VisualConstants } from '../visual-constants';

/** Whether a capture window is open; while false recordRemoval is a no-op. */
let armed = false;
/** Removals collected during the current window, up to the entry cap. */
let entries: SanitizerEntry[] = [];
/** Count of removals dropped after the entry cap was reached this window. */
let overflow = 0;

/** Whether a capture window is currently open. */
export const isArmed = (): boolean => armed;

/**
 * Open a fresh capture window, discarding any prior entries and overflow
 * count.
 */
export const beginCapture = (): void => {
    armed = true;
    entries = [];
    overflow = 0;
};

/**
 * Record one sanitizer removal. A no-op unless armed, so the sanitizer's
 * behaviour is unchanged when diagnostics is off. Past the entry cap the entry
 * is dropped and only the overflow count grows.
 */
export const recordRemoval = (e: SanitizerEntry): void => {
    if (!armed) return;
    // Self-guard: recordRemoval is called from inside frozen security
    // boundaries — the DOMPurify hooks AND the postcss walk callbacks in
    // css-sanitizer. A throw there could abort a render or drop all sanitized
    // output, so observation must never throw into them. Best-effort only.
    try {
        if (entries.length >= VisualConstants.diagnostics.sanitizerEntryCap) {
            overflow++;
            return;
        }
        entries.push(e);
    } catch {
        /* diagnostics must never break sanitization */
    }
};

/**
 * Disarm and return the collected capture (a copy). Internal state is cleared
 * so a second endCapture() before the next beginCapture() yields an empty
 * capture rather than stale data.
 */
export const endCapture = (): SanitizerCapture => {
    armed = false;
    const result: SanitizerCapture = { entries: entries.slice(), overflow };
    entries = [];
    overflow = 0;
    return result;
};
