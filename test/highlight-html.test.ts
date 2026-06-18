import { describe, it, expect } from 'vitest';
import { buildHighlightedFragment } from '../src/diagnostics/highlight-html';
import { VisualConstants } from '../src/visual-constants';

const text = (raw: string): string =>
    buildHighlightedFragment(raw).textContent ?? '';

const render = (raw: string): HTMLDivElement => {
    const host = document.createElement('div');
    host.appendChild(buildHighlightedFragment(raw));
    return host;
};

describe('buildHighlightedFragment', () => {
    it('is lossless: textContent equals the raw source (incl. < > & ")', () => {
        const raw = '<div class="x">3 < 4 & "ok"</div>';
        expect(text(raw)).toBe(raw);
    });

    it('builds DOM nodes, never uses innerHTML (no escaping artifacts)', () => {
        // A literal & in text stays a single & in textContent (no &amp;).
        expect(text('a & b')).toBe('a & b');
    });

    it('colorizes tag name, attribute, and string', () => {
        const host = render('<div class="x">hi</div>');
        expect(host.querySelector('.hc-tag')?.textContent).toBe('div');
        expect(host.querySelector('.hc-attr')?.textContent).toBe('class');
        expect(host.querySelector('.hc-str')?.textContent).toBe('"x"');
        expect(host.textContent).toBe('<div class="x">hi</div>');
    });

    it('colorizes single-quoted attribute values too', () => {
        const raw = "<a href='/x'>k</a>";
        const host = render(raw);
        expect(host.querySelector('.hc-attr')?.textContent).toBe('href');
        expect(host.querySelector('.hc-str')?.textContent).toBe("'/x'");
        expect(host.textContent).toBe(raw);
    });

    it('colorizes a self-closing tag, lossless', () => {
        const raw = '<br/><img src="data:x" />';
        const host = render(raw);
        const tags = Array.from(host.querySelectorAll('.hc-tag')).map(
            (n) => n.textContent
        );
        expect(tags).toEqual(['br', 'img']);
        expect(host.textContent).toBe(raw);
    });

    it('treats a literal "<" in text (not a tag) as plain text', () => {
        const raw = 'if (a < b && c > d) return;';
        const host = render(raw);
        expect(host.querySelector('.hc-tag')).toBeNull();
        expect(host.textContent).toBe(raw);
    });

    it('bypasses colorization above the size limit (single text node)', () => {
        const big = '<b>'.repeat(
            VisualConstants.diagnostics.highlightSizeLimit
        );
        const host = render(big);
        expect(host.querySelector('span')).toBeNull();
        expect(host.childNodes.length).toBe(1);
        expect(host.childNodes[0].nodeType).toBe(3 /* TEXT_NODE */);
        expect(host.textContent).toBe(big);
    });

    // Regression guard for the O(n^2) tempered-greedy regex this module used to
    // use: many literal "<word" with no nearby ">" (realistic author content,
    // since getRawHtml emits text nodes unescaped). The linear scanner must
    // finish near-instantly; the old regex took seconds and would time out.
    it('handles pathological unclosed-tag-like text in linear time', () => {
        const raw = '<undefined '.repeat(15000); // ~165KB, under the bypass
        expect(raw.length).toBeLessThan(
            VisualConstants.diagnostics.highlightSizeLimit
        );
        expect(text(raw)).toBe(raw);
    });
});
