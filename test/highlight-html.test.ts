import { describe, it, expect } from 'vitest';
import { escapeHtml, highlightHtml } from '../src/diagnostics/highlight-html';
import { VisualConstants } from '../src/visual-constants';

const stripSpans = (s: string) => s.replace(/<\/?span[^>]*>/g, '');

describe('highlight-html', () => {
    it('escapes the raw source', () => {
        expect(escapeHtml('<a>&"x"')).toBe('&lt;a&gt;&amp;&quot;x&quot;');
    });

    it('highlighting never alters the (escaped) source', () => {
        const raw = '<div class="x">3 < 4 & ok</div>';
        expect(stripSpans(highlightHtml(raw))).toBe(escapeHtml(raw));
    });

    it('wraps tags in spans for typical markup', () => {
        const out = highlightHtml('<div class="x">hi</div>');
        expect(out).toContain('<span');
        expect(out).toContain('hi');
    });

    it('bypasses highlighting above the size limit (plain escaped text)', () => {
        const big = '<b>'.repeat(
            VisualConstants.diagnostics.highlightSizeLimit
        );
        const out = highlightHtml(big);
        expect(out).not.toContain('<span');
        expect(out).toBe(escapeHtml(big));
    });
});
