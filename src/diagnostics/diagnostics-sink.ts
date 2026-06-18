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

let armed = false;
let entries: SanitizerEntry[] = [];
let overflow = 0;

export const isArmed = (): boolean => armed;

export const beginCapture = (): void => {
    armed = true;
    entries = [];
    overflow = 0;
};

export const recordRemoval = (e: SanitizerEntry): void => {
    if (!armed) return;
    if (entries.length >= VisualConstants.diagnostics.sanitizerEntryCap) {
        overflow++;
        return;
    }
    entries.push(e);
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
