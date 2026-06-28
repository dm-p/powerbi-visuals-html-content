import { describe, it, expect, vi } from 'vitest';
import { resolveHover } from '../src/interactivity';
import { VisualConstants } from '../src/visual-constants';

function makeHost() {
    return { tooltipService: { show: vi.fn(), hide: vi.fn() } } as any;
}

// Mock d3 selection that captures handlers bound on the row selection AND on the
// `.selectAll(...)` result (where bindManualTooltips binds its handler).
function makeDataElements() {
    const handlers: Record<string, (e: any, d: any) => void> = {};
    const manualHandlers: Record<string, (e: any) => void> = {};
    const manual: any = {
        on: vi.fn((evt: string, cb: any) => {
            manualHandlers[evt] = cb;
            return manual;
        })
    };
    const sel: any = {
        on: vi.fn((evt: string, cb: any) => {
            handlers[evt] = cb;
            return sel;
        }),
        selectAll: vi.fn(() => manual)
    };
    return { sel, handlers, manualHandlers };
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
        // Simulate a prior non-suppressed mousemove having marked the row hovered.
        row.classList.add(VisualConstants.dom.hoverClassSelector);

        handlers['mouseover mousemove'](
            { target: inner, currentTarget: row, clientX: 0, clientY: 0 },
            { tooltips: [{ displayName: 'x', value: 'y' }], identity: {} }
        );

        expect(host.tooltipService.hide).toHaveBeenCalled();
        expect(host.tooltipService.show).not.toHaveBeenCalled();
        // Hover state cleared immediately on entering the suppressed subtree.
        expect(
            row.classList.contains(VisualConstants.dom.hoverClassSelector)
        ).toBe(false);
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

    it('manual tooltips also hide over a suppressed subtree', () => {
        const { sel, manualHandlers } = makeDataElements();
        const host = makeHost();
        resolveHover(sel, host, false);

        const modal = document.createElement('div');
        modal.setAttribute('data-hc-suppress', 'all');
        const inner = document.createElement('span');
        modal.appendChild(inner);

        // bindManualTooltips' handler takes only the event; currentTarget.dataset
        // is never read because the suppression guard returns first.
        manualHandlers['mouseover mousemove']({ target: inner, currentTarget: inner });

        expect(host.tooltipService.hide).toHaveBeenCalled();
        expect(host.tooltipService.show).not.toHaveBeenCalled();
    });
});
