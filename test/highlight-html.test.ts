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

    it('colorizes a self-closing tag and keeps the lossless invariant', () => {
        const raw = '<br/><img src="data:x" />';
        const out = highlightHtml(raw);
        expect(out).toContain('<span class="hc-tag">br</span>');
        expect(out).toContain('<span class="hc-tag">img</span>');
        expect(stripSpans(out)).toBe(escapeHtml(raw));
    });

    it('treats a literal "<" in text (not a tag) as plain text', () => {
        const raw = 'if (a < b && c > d) return;';
        const out = highlightHtml(raw);
        expect(out).not.toContain('<span');
        expect(stripSpans(out)).toBe(escapeHtml(raw));
    });

    // Regression guard for the O(n^2) tempered-greedy regex this module used to
    // use: many literal "<word" with no nearby ">" (e.g. unclosed-tag-looking
    // text). getRawHtml emits text nodes unescaped, so this is realistic author
    // content. The linear scanner must finish near-instantly; the previous
    // implementation took several seconds and would exceed the test timeout.
    it('handles pathological unclosed-tag-like text in linear time', () => {
        const limit = VisualConstants.diagnostics.highlightSizeLimit;
        // Stay just under the escaped-length bypass so the scanner actually
        // runs (raw "<undefined " escapes ~1.36x; 12000 reps ≈ 132KB raw).
        const raw = '<undefined '.repeat(12000);
        expect(escapeHtml(raw).length).toBeLessThan(limit);
        const out = highlightHtml(raw);
        expect(stripSpans(out)).toBe(escapeHtml(raw));
    });
});
