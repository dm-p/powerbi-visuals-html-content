import { describe, it, expect } from 'vitest';
import {
    getSanitizedHtmlForTesting,
    getSanitizedCss
} from '../src/sanitize-pipeline';

/**
 * End-to-end smoke tests for src/sanitize-pipeline.ts. These exercise the
 * full sanitize-html + sanitizeCss + preprocessStyleTags + data URI
 * attribute handling pipeline. They are intentionally small and
 * representative — the full payload corpus lives in the Playwright
 * integration harness. The css-sanitizer unit suite covers sanitizeCss
 * in isolation; this file covers the wiring.
 */
describe('sanitize-pipeline end-to-end', () => {
    describe('inline style attribute', () => {
        it('preserves safe color declaration', () => {
            const out = getSanitizedHtmlForTesting(
                '<p style="color: red">x</p>',
                'html'
            );
            expect(out).toContain('color');
            expect(out).toContain('red');
            expect(out).toContain('x');
        });

        it('drops MS-cert content:url payload but preserves text', () => {
            const out = getSanitizedHtmlForTesting(
                '<div style="content:url(data:1234***qwerty)">Hello</div>',
                'html'
            );
            expect(out).not.toContain('content:url');
            expect(out).not.toContain('data:1234');
            expect(out).toContain('Hello');
        });

        it('partial survival when one declaration is unsafe', () => {
            const out = getSanitizedHtmlForTesting(
                '<p style="color: red; background: url(https://evil/x)">x</p>',
                'html'
            );
            expect(out).toContain('color');
            expect(out).toContain('red');
            expect(out).not.toContain('evil');
            expect(out).not.toContain('background');
        });
    });

    describe('<style> tag content', () => {
        it('preserves safe rule', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>p { color: red; }</style><p>x</p>',
                'html'
            );
            expect(out).toContain('<style>');
            expect(out).toContain('color');
            expect(out).toContain('red');
        });

        it('drops @import', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>@import url(https://evil);</style><p>x</p>',
                'html'
            );
            expect(out).not.toContain('@import');
            expect(out).not.toContain('evil');
            expect(out).toContain('x');
        });

        it('partial survival inside a rule', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>p { color: red; font-weight: bold; background: url(https://evil/x); }</style>',
                'html'
            );
            expect(out).toContain('color');
            expect(out).toContain('font-weight');
            expect(out).not.toContain('evil');
            expect(out).not.toContain('background');
        });

        // The <style> body goes through preprocessStyleTags (regex
        // extraction → sanitizeCss → reinsertion) before DOMPurify sees
        // it. css-sanitizer.test.ts covers selector behavior in isolation;
        // these smoke tests verify the pipeline preserves modern selectors
        // through the full wiring.
        it('preserves :has() through <style>', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>.row:has(.active) .panel { display: block; }</style>',
                'html'
            );
            expect(out).toContain(':has(');
            expect(out).toContain('.active');
        });

        it('preserves :has() chained with :hover through <style>', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>.row:hover:has(.active) .label { font-weight: bold; }</style>',
                'html'
            );
            expect(out).toContain(':has(');
            expect(out).toContain(':hover');
        });
    });

    describe('attribute sanitization', () => {
        it('preserves safe image data URI in src', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">',
                'html'
            );
            expect(out).toContain('data:image/png');
        });

        it('drops unsafe data URI in src', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:text/html,<script>alert(1)</script>" alt="x">',
                'html'
            );
            expect(out).not.toContain('text/html');
            expect(out).not.toContain('alert(1)');
            expect(out).not.toContain('<script');
        });

        it('drops event handler attributes', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:image/png;base64,AAA" onclick="alert(1)">',
                'html'
            );
            expect(out).not.toContain('onclick');
            expect(out).not.toContain('alert(1)');
        });

        it('drops javascript: href', () => {
            const out = getSanitizedHtmlForTesting(
                '<a href="javascript:alert(1)">x</a>',
                'html'
            );
            expect(out).not.toContain('javascript:');
            expect(out).not.toContain('alert(1)');
        });
    });

    describe('getSanitizedCss direct', () => {
        it('preserves safe rule', () => {
            const out = getSanitizedCss('p { color: red; }');
            expect(out).toContain('color');
            expect(out).toContain('red');
        });

        it('drops dangerous declaration', () => {
            const out = getSanitizedCss(
                'p { background: url(https://evil); }'
            );
            expect(out).not.toContain('evil');
        });
    });

    describe('edge cases', () => {
        it('empty input returns empty', () => {
            expect(getSanitizedHtmlForTesting('', 'html')).toBe('');
        });

        it('plain text passes through', () => {
            const out = getSanitizedHtmlForTesting('<p>Hello</p>', 'html');
            expect(out).toContain('Hello');
        });
    });
});
