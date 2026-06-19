import { describe, it, expect, beforeEach } from 'vitest';
import {
    setArmed,
    recordEvent,
    recordTooltipEvent,
    snapshot,
    clear,
    resetForTests
} from '../src/diagnostics/event-recorder';
import { VisualConstants } from '../src/visual-constants';

beforeEach(() => resetForTests());

describe('event recorder arming', () => {
    it('is a no-op when disarmed', () => {
        recordEvent('update', 'x');
        expect(snapshot()).toEqual([]);
    });
    it('records when armed', () => {
        setArmed(true);
        recordEvent('update', 'type=Data');
        const s = snapshot();
        expect(s).toHaveLength(1);
        expect(s[0]).toMatchObject({ type: 'update', summary: 'type=Data' });
        expect(typeof s[0].ts).toBe('number');
    });
    it('disarming stops recording', () => {
        setArmed(true);
        recordEvent('drill', 'a');
        setArmed(false);
        recordEvent('drill', 'b');
        expect(snapshot()).toHaveLength(1);
    });
    it('recordTooltipEvent is a no-op when disarmed and does not poison the dedup key', () => {
        // Disarmed: nothing recorded, and lastTooltipKey must NOT be set.
        recordTooltipEvent('show', 'standard', 'A');
        expect(snapshot()).toEqual([]);
        // After arming, the SAME show must still record — proving the dedup key
        // was not written during the disarmed call.
        setArmed(true);
        recordTooltipEvent('show', 'standard', 'A');
        expect(snapshot()).toHaveLength(1);
    });
});

describe('ring buffer + clear', () => {
    beforeEach(() => setArmed(true));
    it('caps at eventBufferCap, evicting oldest', () => {
        const cap = VisualConstants.diagnostics.eventBufferCap;
        for (let i = 0; i < cap + 5; i++) recordEvent('update', `u${i}`);
        const s = snapshot();
        expect(s).toHaveLength(cap);
        expect(s[0].summary).toBe('u5');
    });
    it('clear empties the buffer and returns a copy from snapshot', () => {
        recordEvent('update', 'a');
        const s = snapshot();
        clear();
        expect(snapshot()).toEqual([]);
        expect(s).toHaveLength(1); // snapshot was a copy, unaffected by clear
    });
});

describe('tooltip de-duplication (Decision 9/10)', () => {
    beforeEach(() => setArmed(true));
    const sums = () => snapshot().map((e) => e.summary + '|' + (e.context ?? ''));

    it('collapses consecutive identical shows', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordTooltipEvent('show', 'standard', 'A');
        expect(snapshot()).toHaveLength(1);
    });
    it('re-enables an identical show after an intervening hide', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordTooltipEvent('hide', 'standard', '');
        recordTooltipEvent('show', 'standard', 'A');
        expect(snapshot()).toHaveLength(3);
    });
    it('records a show over different data', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordTooltipEvent('show', 'standard', 'B');
        expect(snapshot()).toHaveLength(2);
    });
    it('does NOT re-enable across an intervening non-tooltip event', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordEvent('update', 'type=Resize');
        recordTooltipEvent('show', 'standard', 'A');
        // update recorded; the second identical show suppressed → 2 total
        expect(snapshot()).toHaveLength(2);
        expect(sums()).toEqual(['show · standard|A', 'type=Resize|']);
    });
    it('does NOT dedup standard vs manual with the same context', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordTooltipEvent('show', 'manual', 'A');
        expect(snapshot()).toHaveLength(2);
    });
    it('clear resets the dedup key so the next show logs', () => {
        recordTooltipEvent('show', 'standard', 'A');
        clear();
        recordTooltipEvent('show', 'standard', 'A');
        expect(snapshot()).toHaveLength(1);
    });
});
