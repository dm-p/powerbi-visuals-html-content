import { describe, it, expect } from 'vitest';
import { resolveInteractivity } from '../src/interactivity';

// Build <root><mid [attr]><leaf></leaf></mid></root> and return leaf.
function tree(attr?: string): Element {
    const root = document.createElement('div');
    const mid = document.createElement('div');
    if (attr !== undefined) mid.setAttribute('data-hc-suppress', attr);
    const leaf = document.createElement('span');
    mid.appendChild(leaf);
    root.appendChild(mid);
    return leaf;
}

describe('resolveInteractivity', () => {
    it('allows everything when no ancestor suppresses', () => {
        const leaf = tree();
        expect(resolveInteractivity(leaf, 'filter')).toBe(true);
        expect(resolveInteractivity(leaf, 'tooltip')).toBe(true);
        expect(resolveInteractivity(leaf, 'context-menu')).toBe(true);
    });

    it('suppresses only the named token', () => {
        const leaf = tree('filter');
        expect(resolveInteractivity(leaf, 'filter')).toBe(false);
        expect(resolveInteractivity(leaf, 'tooltip')).toBe(true);
    });

    it('"all" suppresses every token', () => {
        const leaf = tree('all');
        expect(resolveInteractivity(leaf, 'filter')).toBe(false);
        expect(resolveInteractivity(leaf, 'tooltip')).toBe(false);
        expect(resolveInteractivity(leaf, 'context-menu')).toBe(false);
    });

    it('reads multiple space-separated tokens', () => {
        const leaf = tree('filter tooltip');
        expect(resolveInteractivity(leaf, 'filter')).toBe(false);
        expect(resolveInteractivity(leaf, 'tooltip')).toBe(false);
        expect(resolveInteractivity(leaf, 'context-menu')).toBe(true);
    });

    it('inherits suppression from an ancestor (descendants included)', () => {
        const leaf = tree('all'); // attr on mid, query the leaf below it
        expect(resolveInteractivity(leaf, 'filter')).toBe(false);
    });

    it('ignores unknown tokens', () => {
        const leaf = tree('foo bar');
        expect(resolveInteractivity(leaf, 'filter')).toBe(true);
    });

    it('treats a null node as allowed', () => {
        expect(resolveInteractivity(null, 'filter')).toBe(true);
    });
});
