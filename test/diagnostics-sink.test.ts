import { describe, it, expect, beforeEach } from 'vitest';
import {
    beginCapture,
    recordRemoval,
    endCapture,
    isArmed
} from '../src/diagnostics/diagnostics-sink';
import { VisualConstants } from '../src/visual-constants';

const entry = (i: number) =>
    ({ kind: 'attr', subject: `a${i}`, rule: 'r' }) as const;

describe('diagnostics-sink', () => {
    beforeEach(() => endCapture()); // ensure disarmed between tests

    it('is a no-op until armed', () => {
        expect(isArmed()).toBe(false);
        recordRemoval(entry(0));
        beginCapture();
        const cap = endCapture();
        expect(cap.entries).toEqual([]);
        expect(cap.overflow).toBe(0);
    });

    it('collects while armed and disarms on endCapture', () => {
        beginCapture();
        expect(isArmed()).toBe(true);
        recordRemoval(entry(1));
        recordRemoval(entry(2));
        const cap = endCapture();
        expect(isArmed()).toBe(false);
        expect(cap.entries.map((e) => e.subject)).toEqual(['a1', 'a2']);
    });

    it('caps at the entry limit and counts overflow', () => {
        const cap = VisualConstants.diagnostics.sanitizerEntryCap;
        beginCapture();
        for (let i = 0; i < cap + 5; i++) recordRemoval(entry(i));
        const out = endCapture();
        expect(out.entries.length).toBe(cap);
        expect(out.overflow).toBe(5);
    });

    it('beginCapture resets prior state', () => {
        beginCapture();
        recordRemoval(entry(1));
        beginCapture();
        expect(endCapture().entries).toEqual([]);
    });

    it('clears state on endCapture so a second call yields an empty capture', () => {
        beginCapture();
        recordRemoval(entry(1));
        const first = endCapture();
        expect(first.entries.map((e) => e.subject)).toEqual(['a1']);
        const second = endCapture();
        expect(second.entries).toEqual([]);
        expect(second.overflow).toBe(0);
    });
});
