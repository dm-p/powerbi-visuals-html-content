import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import * as pass from '../src/sanitize/backend.passthrough';

describe('passthrough sanitizer backend', () => {
    it('reports disabled', () => {
        expect(pass.enabled).toBe(false);
    });

    it('sanitizeHtmlString returns input unchanged', () => {
        const dirty = '<img src=x onerror=alert(1)><script>boom()</script>';
        expect(pass.sanitizeHtmlString(dirty)).toBe(dirty);
    });

    it('preprocessHtmlString returns input unchanged', () => {
        const input = '<style>a{color:red}</style>';
        expect(pass.preprocessHtmlString(input)).toBe(input);
    });

    it('sanitizeCssString returns input unchanged', () => {
        const css = 'a{background:url(javascript:alert(1))}';
        expect(pass.sanitizeCssString(css)).toBe(css);
    });

    it('sanitizeFragmentInPlace leaves the fragment untouched', () => {
        const dom = new JSDOM('<!DOCTYPE html><body></body>');
        const range = dom.window.document.createRange();
        range.selectNodeContents(dom.window.document.body);
        const frag = range.createContextualFragment(
            '<div onclick="x()">hi</div>'
        );
        const before = frag.childNodes.length;
        pass.sanitizeFragmentInPlace(frag as unknown as DocumentFragment);
        expect(frag.childNodes.length).toBe(before);
        const div = frag.firstChild as HTMLElement;
        expect(div.getAttribute('onclick')).toBe('x()');
    });
});
