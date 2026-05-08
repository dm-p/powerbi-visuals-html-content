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

        // Issue #143 follow-up: reporters on 1.6.1.0 said CSS variables
        // were dropped through the <style>-in-data path. Confirm the
        // pipeline preserves them all the way from raw HTML input
        // through preprocessStyleTags + sanitizeCss + DOMPurify +
        // uponSanitizeElement backstop to the final output.
        it('preserves CSS variables (:root + var()) through <style>-in-data', () => {
            const out = getSanitizedHtmlForTesting(
                '<style id="visualUserStylesheet" type="text/css">' +
                ':root { --bg: #fff; --color: #111; }' +
                '.card { background: var(--bg); color: var(--color); }' +
                '</style>' +
                '<div class="card">x</div>',
                'html'
            );
            expect(out).toContain('--bg');
            expect(out).toContain('--color');
            expect(out).toContain('var(--bg)');
            expect(out).toContain('var(--color)');
        });

        it('preserves clamp() and rgba() through <style>-in-data', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>' +
                '.card { font-size: clamp(12px, 3vw, 16px); ' +
                'box-shadow: 0 2px 6px rgba(0,0,0,0.2); }' +
                '</style>' +
                '<div class="card">x</div>',
                'html'
            );
            expect(out).toContain('clamp(');
            expect(out).toContain('rgba(');
        });

        it('preserves @media containing CSS variables through <style>-in-data', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>' +
                ':root { --pad: 16px; }' +
                '@media (max-width: 600px) { ' +
                '.card { padding: var(--pad); font-size: clamp(12px, 3vw, 16px) !important; } ' +
                '}' +
                '</style>' +
                '<div class="card">x</div>',
                'html'
            );
            expect(out).toContain('@media');
            expect(out).toContain('--pad');
            expect(out).toContain('var(--pad)');
            expect(out).toContain('clamp(');
            expect(out).toContain('!important');
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

        // image/svg+xml data URIs are legitimately emitted by DAX
        // measures (Power BI SVG-as-IMG pattern) and other tooling in
        // both `;utf8,` and bare-comma form. SVG is text by spec, so
        // the base64 requirement that applies to raster image MIMEs is
        // bypassed for image/svg+xml. Browsers sandbox SVG loaded via
        // <img> — embedded scripts and external resource references
        // do not execute in image-loading context (issue #143).
        it('preserves data:image/svg+xml;utf8 in <img src>', () => {
            const svg =
                "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><circle cx='5' cy='5' r='4' fill='red'/></svg>";
            const out = getSanitizedHtmlForTesting(
                `<img src="data:image/svg+xml;utf8,${svg}" alt="x">`,
                'html'
            );
            expect(out).toContain('data:image/svg+xml');
            expect(out).toContain("viewBox='0 0 10 10'");
        });

        it('preserves data:image/svg+xml without charset (bare comma) in <img src>', () => {
            const svg =
                "<svg xmlns='http://www.w3.org/2000/svg'><rect width='10' height='10'/></svg>";
            const out = getSanitizedHtmlForTesting(
                `<img src="data:image/svg+xml,${svg}" alt="x">`,
                'html'
            );
            expect(out).toContain('data:image/svg+xml');
            expect(out).toContain("rect width='10'");
        });

        it('preserves data:image/svg+xml;base64 in <img src>', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">',
                'html'
            );
            expect(out).toContain('data:image/svg+xml;base64');
        });

        it('still drops data:image/png without base64 (smuggled non-binary)', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:image/png,<script>alert(1)</script>" alt="x">',
                'html'
            );
            expect(out).not.toContain('script');
            expect(out).not.toContain('alert(1)');
        });

        it('still drops data:text/html in <img src> (script-bearing MIME)', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" alt="x">',
                'html'
            );
            expect(out).not.toContain('text/html');
        });

        // Defense-in-depth: even when the browser sandbox of img-loaded
        // SVG is the load-bearing security boundary, the sanitizer
        // rejects payloads carrying script / event handlers / external
        // href so a future sandbox-weak surface (older WebView2, mobile,
        // export pipeline) still drops them at this layer.
        it('drops data:image/svg+xml with embedded <script>', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>\">",
                'html'
            );
            expect(out).not.toContain('alert');
            expect(out).not.toContain('script');
        });

        it('drops data:image/svg+xml with on* event handler', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>\">",
                'html'
            );
            expect(out).not.toContain('alert');
            expect(out).not.toContain('onload');
        });

        it('drops data:image/svg+xml with <foreignObject>', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><foreignObject><iframe src='https://attacker.example'/></foreignObject></svg>\">",
                'html'
            );
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('foreignObject');
        });

        it('drops data:image/svg+xml with external xlink:href on inner element', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image xlink:href='https://attacker.example/track.png'/></svg>\">",
                'html'
            );
            expect(out).not.toContain('attacker.example');
        });

        it('drops base64-encoded svg+xml carrying <script>', () => {
            // base64 of "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
            const b64 =
                'PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';
            const out = getSanitizedHtmlForTesting(
                `<img src="data:image/svg+xml;base64,${b64}">`,
                'html'
            );
            expect(out).not.toContain('alert');
            expect(out).not.toContain('script');
        });

        it('preserves data:image/svg+xml carrying inner href="#fragment" (safe)', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><use href='#icon'/></svg>\">",
                'html'
            );
            expect(out).toContain('data:image/svg+xml');
            expect(out).toContain("href='#icon'");
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
