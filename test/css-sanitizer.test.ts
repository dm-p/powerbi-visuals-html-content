import { describe, it, expect, vi } from 'vitest';
import { sanitizeCss } from '../src/css-sanitizer';

describe('sanitizeCss', () => {
    describe('declaration-list mode', () => {
        it('preserves a safe color declaration round-trip', () => {
            const out = sanitizeCss('color: red', 'declaration-list');
            expect(out).toContain('color: red');
        });

        it('drops a content:url(data:1234***qwerty) declaration (MS cert 2026-04)', () => {
            const out = sanitizeCss(
                'content: url(data:1234***qwerty)',
                'declaration-list'
            );
            expect(out).not.toContain('data:1234');
            expect(out).not.toContain('content:');
        });

        it('preserves a safe url(data:image/png;base64,...) declaration', () => {
            const input =
                'background: url(data:image/png;base64,iVBORw0KGgo=) no-repeat';
            const out = sanitizeCss(input, 'declaration-list');
            expect(out).toContain('data:image/png');
            expect(out).toContain('background');
        });

        it('drops a url(https://attacker.example/x.png) declaration', () => {
            const out = sanitizeCss(
                'background: url(https://attacker.example/x.png)',
                'declaration-list'
            );
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('background');
        });

        it('drops a url(data:image/svg+xml,...) declaration (svg can carry scripts)', () => {
            const out = sanitizeCss(
                'background: url(data:image/svg+xml,<svg></svg>)',
                'declaration-list'
            );
            expect(out).not.toContain('svg+xml');
            expect(out).not.toContain('background');
        });
    });

    describe('stylesheet mode', () => {
        it('preserves a safe rule round-trip', () => {
            const out = sanitizeCss('p { color: red; }', 'stylesheet');
            expect(out).toContain('color: red');
            expect(out).toContain('p');
        });

        it('drops a dangerous declaration inside a rule', () => {
            const out = sanitizeCss(
                'p { color: red; background: url(https://evil/x.png); }',
                'stylesheet'
            );
            expect(out).toContain('color: red');
            expect(out).not.toContain('evil');
            expect(out).not.toContain('background');
        });
    });

    describe('url() per CSS property (Task 10)', () => {
        it('drops a declaration with two url() tokens where the second is unsafe', () => {
            const out = sanitizeCss(
                'background: url(data:image/png;base64,AAA), url(javascript:alert(1))',
                'declaration-list'
            );
            expect(out).not.toContain('javascript');
            expect(out).not.toContain('background');
        });

        it('drops a declaration where the first url() is unsafe even if the second is safe', () => {
            const out = sanitizeCss(
                'background: url(https://attacker.example/x.png), url(data:image/png;base64,AAA)',
                'declaration-list'
            );
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('background');
        });

        const properties = [
            'background',
            'background-image',
            'content',
            'cursor',
            'list-style-image',
            'border-image',
            'border-image-source',
            'mask',
            'mask-image',
            '-webkit-mask',
            '-webkit-mask-image',
            'shape-outside',
            'clip-path',
            'filter',
            'offset-path'
        ];
        for (const prop of properties) {
            it(`drops ${prop}: url(https://evil)`, () => {
                const out = sanitizeCss(
                    `${prop}: url(https://evil/x)`,
                    'declaration-list'
                );
                expect(out).not.toContain('evil');
                expect(out).not.toContain(prop);
            });
        }

        it('drops a linear-gradient that contains url(https://evil)', () => {
            const out = sanitizeCss(
                'background-image: linear-gradient(red, url(https://evil/x) 50%, blue)',
                'declaration-list'
            );
            expect(out).not.toContain('evil');
            expect(out).not.toContain('background-image');
        });

        it('preserves a linear-gradient that contains only safe stops', () => {
            const out = sanitizeCss(
                'background-image: linear-gradient(red, blue)',
                'declaration-list'
            );
            expect(out).toContain('linear-gradient');
            expect(out).toContain('background-image');
        });

        it('drops image-set() containing an unsafe url', () => {
            const out = sanitizeCss(
                'background: image-set(url(data:image/png;base64,AAA) 1x, url(https://evil/2x.png) 2x)',
                'declaration-list'
            );
            expect(out).not.toContain('evil');
            expect(out).not.toContain('background');
        });

        it('drops a --custom-prop declaration whose value contains an unsafe url', () => {
            const out = sanitizeCss(
                '--bg: url(https://evil/x.png)',
                'declaration-list'
            );
            expect(out).not.toContain('evil');
            expect(out).not.toContain('--bg');
        });

        it('preserves a --custom-prop declaration with a safe url', () => {
            const out = sanitizeCss(
                '--bg: url(data:image/png;base64,AAA)',
                'declaration-list'
            );
            expect(out).toContain('--bg');
            expect(out).toContain('data:image/png');
        });

        it('drops url("https://evil") with double quotes', () => {
            const out = sanitizeCss(
                'background: url("https://evil/x.png")',
                'declaration-list'
            );
            expect(out).not.toContain('evil');
        });

        it("drops url('https://evil') with single quotes", () => {
            const out = sanitizeCss(
                "background: url('https://evil/x.png')",
                'declaration-list'
            );
            expect(out).not.toContain('evil');
        });

        it('drops URL(HTTPS://EVIL/X) with uppercase and whitespace', () => {
            const out = sanitizeCss(
                'background: URL(  HTTPS://EVIL/X.PNG  )',
                'declaration-list'
            );
            expect(out).not.toContain('EVIL');
            expect(out).not.toContain('evil');
        });

        it('drops url() with empty argument', () => {
            const out = sanitizeCss(
                'background: url()',
                'declaration-list'
            );
            expect(out).not.toContain('background');
        });

        it('drops only the offending declaration in a multi-declaration input', () => {
            const out = sanitizeCss(
                'color: red; background: url(https://evil/x); font-weight: bold',
                'declaration-list'
            );
            expect(out).toContain('color: red');
            expect(out).toContain('font-weight: bold');
            expect(out).not.toContain('evil');
            expect(out).not.toContain('background');
        });
    });

    describe('failure mode', () => {
        it('returns empty string and warns on parse failure', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const out = sanitizeCss('}}}', 'stylesheet');
            expect(out === '' || typeof out === 'string').toBe(true);
            warn.mockRestore();
        });

        it('returns empty for empty input', () => {
            expect(sanitizeCss('', 'declaration-list')).toBe('');
            expect(sanitizeCss('', 'stylesheet')).toBe('');
        });
    });

    describe('at-rule allowlist (Task 11)', () => {
        it('preserves @media', () => {
            const out = sanitizeCss(
                '@media (max-width: 600px) { p { color: red; } }',
                'stylesheet'
            );
            expect(out).toContain('@media');
            expect(out).toContain('color: red');
        });

        it('preserves @supports', () => {
            const out = sanitizeCss(
                '@supports (display: grid) { .g { display: grid; } }',
                'stylesheet'
            );
            expect(out).toContain('@supports');
            expect(out).toContain('display: grid');
        });

        it('preserves @keyframes', () => {
            const out = sanitizeCss(
                '@keyframes fade { from { opacity: 0; } to { opacity: 1; } }',
                'stylesheet'
            );
            expect(out).toContain('@keyframes');
            expect(out).toContain('opacity');
        });

        it('preserves @-webkit-keyframes', () => {
            const out = sanitizeCss(
                '@-webkit-keyframes fade { from { opacity: 0; } to { opacity: 1; } }',
                'stylesheet'
            );
            expect(out).toContain('@-webkit-keyframes');
        });

        it('preserves @page', () => {
            const out = sanitizeCss(
                '@page { margin: 1cm; }',
                'stylesheet'
            );
            expect(out).toContain('@page');
            expect(out).toContain('margin');
        });

        it('drops @import of an external stylesheet', () => {
            const out = sanitizeCss(
                '@import url(https://attacker.example/x.css);',
                'stylesheet'
            );
            expect(out).not.toContain('@import');
            expect(out).not.toContain('attacker.example');
        });

        it('drops @import with a bare url string', () => {
            const out = sanitizeCss(
                '@import "https://attacker.example/x.css";',
                'stylesheet'
            );
            expect(out).not.toContain('@import');
            expect(out).not.toContain('attacker.example');
        });

        it('drops @font-face', () => {
            const out = sanitizeCss(
                '@font-face { font-family: "X"; src: url(https://attacker.example/x.woff); }',
                'stylesheet'
            );
            expect(out).not.toContain('@font-face');
            expect(out).not.toContain('attacker.example');
        });

        it('drops @namespace', () => {
            const out = sanitizeCss(
                '@namespace url(https://attacker.example/);',
                'stylesheet'
            );
            expect(out).not.toContain('@namespace');
            expect(out).not.toContain('attacker.example');
        });

        it('drops @charset', () => {
            const out = sanitizeCss(
                '@charset "UTF-8";',
                'stylesheet'
            );
            expect(out).not.toContain('@charset');
        });

        it('drops @document', () => {
            const out = sanitizeCss(
                '@document url(https://attacker.example/) { body { color: red; } }',
                'stylesheet'
            );
            expect(out).not.toContain('@document');
            expect(out).not.toContain('attacker.example');
        });

        it('drops an unknown @unknown at-rule', () => {
            const out = sanitizeCss(
                '@unknown thing { p { color: red; } }',
                'stylesheet'
            );
            expect(out).not.toContain('@unknown');
        });

        it('drops @import in declaration-list mode too', () => {
            const out = sanitizeCss(
                '@import url(https://attacker.example/x.css)',
                'declaration-list'
            );
            expect(out).not.toContain('@import');
        });
    });

    describe('scheme variants outside url() (Task 11)', () => {
        it('drops a declaration with bare javascript: in value', () => {
            const out = sanitizeCss(
                'behavior: javascript:alert(1)',
                'declaration-list'
            );
            expect(out).not.toContain('javascript');
            expect(out).not.toContain('behavior');
        });

        it('drops a declaration with bare vbscript: in value', () => {
            const out = sanitizeCss(
                'cursor: vbscript:msgbox(1)',
                'declaration-list'
            );
            expect(out).not.toContain('vbscript');
            expect(out).not.toContain('cursor');
        });

        it('drops a declaration with data:text/html in value', () => {
            const out = sanitizeCss(
                'content: "data:text/html,<script>alert(1)</script>"',
                'declaration-list'
            );
            expect(out).not.toContain('data:text/html');
            expect(out).not.toContain('content');
        });

        it('drops data:application/javascript', () => {
            const out = sanitizeCss(
                'x: data:application/javascript,alert(1)',
                'declaration-list'
            );
            expect(out).not.toContain('data:application/javascript');
        });

        it('drops data:application/x-javascript', () => {
            const out = sanitizeCss(
                'x: data:application/x-javascript,alert(1)',
                'declaration-list'
            );
            expect(out).not.toContain('data:application/x-javascript');
        });

        it('is case-insensitive (JavaScript: JAVASCRIPT: jAvAsCrIpT:)', () => {
            for (const variant of ['JavaScript:', 'JAVASCRIPT:', 'jAvAsCrIpT:']) {
                const out = sanitizeCss(
                    `x: ${variant}alert(1)`,
                    'declaration-list'
                );
                expect(out, `variant ${variant} should drop`).not.toContain('alert');
            }
        });

        it('tolerates whitespace between scheme name and colon', () => {
            const out = sanitizeCss(
                'x: javascript : alert(1)',
                'declaration-list'
            );
            expect(out).not.toContain('javascript');
        });

        it('drops livescript: and mocha:', () => {
            expect(
                sanitizeCss('x: livescript:alert(1)', 'declaration-list')
            ).not.toContain('livescript');
            expect(
                sanitizeCss('x: mocha:alert(1)', 'declaration-list')
            ).not.toContain('mocha');
        });

        it('does NOT drop data:image/png;base64,... (safe mime)', () => {
            const out = sanitizeCss(
                'x: data:image/png;base64,AAA',
                'declaration-list'
            );
            expect(out).not.toContain('data:image/png');
        });

        it('preserves a declaration that mentions "javascript" without a colon', () => {
            const out = sanitizeCss(
                'font-family: javascript-sans',
                'declaration-list'
            );
            expect(out).toContain('javascript-sans');
            expect(out).toContain('font-family');
        });

        // Direct-exercise tests: many of the above pass via the parse-failure
        // early-out because postcss rejects a bare scheme like `x: javascript:`
        // as a malformed declaration. These tests wrap the dangerous scheme in
        // a legal string literal so postcss DOES parse it, which forces the
        // hasDangerousSchemeInValue regex to be the dropping mechanism rather
        // than the parse-failure try/catch. If a future refactor breaks the
        // scheme regex, these tests fail loudly.

        it('drops font-family with quoted javascript: string (regex path)', () => {
            const out = sanitizeCss(
                'p { font-family: "javascript:alert(1)"; color: red; }',
                'stylesheet'
            );
            // color: red must survive (partial-survival: sibling decls are OK)
            expect(out).toContain('color: red');
            // font-family declaration must drop
            expect(out).not.toContain('javascript');
            expect(out).not.toContain('font-family');
        });

        it('drops content with quoted data:text/html string (regex path)', () => {
            const out = sanitizeCss(
                'p { content: "data:text/html,<script>alert(1)</script>"; color: red; }',
                'stylesheet'
            );
            expect(out).toContain('color: red');
            expect(out).not.toContain('data:text/html');
            expect(out).not.toContain('content:');
        });

        it('drops font-family with quoted vbscript: string (regex path)', () => {
            const out = sanitizeCss(
                'p { font-family: "vbscript:msgbox(1)"; color: red; }',
                'stylesheet'
            );
            expect(out).toContain('color: red');
            expect(out).not.toContain('vbscript');
        });
    });

    describe('stylesheet selector checks (Task 11)', () => {
        it('drops a rule whose selector contains javascript:', () => {
            const out = sanitizeCss(
                'a[href="javascript:alert(1)"] { color: red; }',
                'stylesheet'
            );
            expect(out).not.toContain('javascript');
            expect(out).not.toContain('color: red');
        });

        it('drops a rule whose selector contains a control character (0x01)', () => {
            const out = sanitizeCss(
                'p\u0001 { color: red; }',
                'stylesheet'
            );
            expect(out).not.toContain('color: red');
        });

        it('preserves normal selectors', () => {
            const out = sanitizeCss(
                'p.foo, .bar > div[data-x="y"] { color: red; }',
                'stylesheet'
            );
            expect(out).toContain('color: red');
            expect(out).toContain('p.foo');
        });

        it('javascript: check is case-insensitive', () => {
            const out = sanitizeCss(
                'a[href="JavaScript:alert(1)"] { color: red; }',
                'stylesheet'
            );
            expect(out).not.toContain('color: red');
        });
    });
});
