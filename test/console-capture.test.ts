import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    install,
    snapshot,
    clear,
    resetForTests
} from '../src/diagnostics/console-capture';
import { VisualConstants } from '../src/visual-constants';

describe('console-capture', () => {
    beforeEach(() => resetForTests());

    it('tees through to the original console', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        install();
        console.log('hello');
        expect(spy).toHaveBeenCalledWith('hello');
        spy.mockRestore();
    });

    it('captures level + text', () => {
        install();
        console.warn('careful', 42);
        const buf = snapshot();
        const last = buf[buf.length - 1];
        expect(last.level).toBe('warn');
        expect(last.text).toContain('careful');
        expect(last.text).toContain('42');
    });

    it('caps per-line length', () => {
        install();
        console.log(
            'x'.repeat(VisualConstants.diagnostics.consoleLineCap + 500)
        );
        const last = snapshot().slice(-1)[0];
        expect(last.text.length).toBe(
            VisualConstants.diagnostics.consoleLineCap
        );
    });

    it('rings the buffer at the count cap', () => {
        install();
        const cap = VisualConstants.diagnostics.consoleBufferCap;
        for (let i = 0; i < cap + 10; i++) console.log('m' + i);
        const buf = snapshot();
        expect(buf.length).toBe(cap);
        expect(buf[buf.length - 1].text).toContain('m' + (cap + 9));
    });

    it('install is idempotent', () => {
        install();
        install();
        console.log('once');
        expect(snapshot().filter((e) => e.text === 'once').length).toBe(1);
    });

    it('stringifies null and undefined by name', () => {
        install();
        console.log(undefined, null);
        expect(snapshot().slice(-1)[0].text).toBe('undefined null');
    });

    it('clear empties the buffer but keeps capturing', () => {
        install();
        console.log('before');
        expect(snapshot().length).toBeGreaterThan(0);
        clear();
        expect(snapshot()).toEqual([]);
        console.log('after');
        expect(snapshot().map((e) => e.text)).toEqual(['after']);
    });
});
