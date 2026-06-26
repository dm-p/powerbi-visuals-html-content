import { describe, it, expect, vi } from 'vitest';
import { resolveHover } from '../src/interactivity';

function makeHost() {
    return { tooltipService: { show: vi.fn(), hide: vi.fn() } } as any;
}

// Mock d3 selection that captures bound handlers and stubs selectAll.
function makeDataElements() {
    const handlers: Record<string, (e: any, d: any) => void> = {};
    const manual = { on: vi.fn().mockReturnThis() };
    const sel: any = {
        on: vi.fn((evt: string, cb: any) => {
            handlers[evt] = cb;
            return sel;
        }),
        selectAll: vi.fn(() => manual)
    };
    return { sel, handlers };
}

describe('contextual tooltip suppression', () => {
    it('hides instead of showing over a data-hc-suppress=tooltip subtree', () => {
        const { sel, handlers } = makeDataElements();
        const host = makeHost();
        resolveHover(sel, host, false);

        const row = document.createElement('div');
        const modal = document.createElement('div');
        modal.setAttribute('data-hc-suppress', 'tooltip');
        const inner = document.createElement('span');
        modal.appendChild(inner);
        row.appendChild(modal);

        handlers['mouseover mousemove'](
            { target: inner, currentTarget: row, clientX: 0, clientY: 0 },
            { tooltips: [{ displayName: 'x', value: 'y' }], identity: {} }
        );

        expect(host.tooltipService.hide).toHaveBeenCalled();
        expect(host.tooltipService.show).not.toHaveBeenCalled();
    });

    it('still shows the tooltip outside any suppressed subtree', () => {
        const { sel, handlers } = makeDataElements();
        const host = makeHost();
        resolveHover(sel, host, false);

        const row = document.createElement('div');
        const inner = document.createElement('span');
        row.appendChild(inner);

        handlers['mouseover mousemove'](
            { target: inner, currentTarget: row, clientX: 0, clientY: 0 },
            { tooltips: [{ displayName: 'x', value: 'y' }], identity: {} }
        );

        expect(host.tooltipService.show).toHaveBeenCalled();
    });
});
