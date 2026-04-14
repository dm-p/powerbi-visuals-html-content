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

        it('drops a url(data:image/png,...) without base64 encoding (P0 review fix)', () => {
            const out = sanitizeCss(
                'background: url(data:image/png,<svg/onload=alert(1)>)',
                'declaration-list'
            );
            expect(out).not.toContain('data:image/png');
            expect(out).not.toContain('alert');
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

describe('denied CSS functions (Task 12)', () => {
    it('drops declaration with expression()', () => {
        const out = sanitizeCss(
            'width: expression(alert(1))',
            'declaration-list'
        );
        expect(out).not.toContain('expression');
        expect(out).not.toContain('width');
    });

    it('drops declaration with expression() inside a stylesheet rule', () => {
        const out = sanitizeCss(
            'p { color: red; width: expression(alert(1)); }',
            'stylesheet'
        );
        expect(out).toContain('color: red');
        expect(out).not.toContain('expression');
        expect(out).not.toContain('width');
    });

    it('drops declaration with uppercase EXPRESSION()', () => {
        const out = sanitizeCss(
            'width: EXPRESSION(alert(1))',
            'declaration-list'
        );
        expect(out).not.toContain('EXPRESSION');
        expect(out).not.toContain('expression');
    });

    it('drops declaration with -moz-binding() function', () => {
        const out = sanitizeCss(
            'x: -moz-binding(foo)',
            'declaration-list'
        );
        expect(out).not.toContain('-moz-binding');
    });

    it('drops declaration with attr() function', () => {
        const out = sanitizeCss(
            'content: attr(data-x)',
            'declaration-list'
        );
        expect(out).not.toContain('attr');
        expect(out).not.toContain('content');
    });

    it('preserves declaration with safe calc() function', () => {
        const out = sanitizeCss(
            'width: calc(100% - 20px)',
            'declaration-list'
        );
        expect(out).toContain('calc');
        expect(out).toContain('width');
    });

    it('preserves declaration with rgb() and hsl()', () => {
        const out = sanitizeCss(
            'color: rgb(10, 20, 30)',
            'declaration-list'
        );
        expect(out).toContain('rgb');

        const out2 = sanitizeCss(
            'background-color: hsl(120, 50%, 50%)',
            'declaration-list'
        );
        expect(out2).toContain('hsl');
    });

    it('preserves declaration with var()', () => {
        const out = sanitizeCss(
            'color: var(--primary, black)',
            'declaration-list'
        );
        expect(out).toContain('var');
    });

    it('drops declaration where expression() is nested inside calc()', () => {
        const out = sanitizeCss(
            'width: calc(100% - expression(alert(1)))',
            'declaration-list'
        );
        expect(out).not.toContain('expression');
        expect(out).not.toContain('width');
    });
});

describe('property-name denylist (Task 12)', () => {
    it('drops behavior property regardless of value', () => {
        const out = sanitizeCss(
            'behavior: normal',
            'declaration-list'
        );
        expect(out).not.toContain('behavior');
    });

    it('drops -moz-binding property regardless of value', () => {
        const out = sanitizeCss(
            '-moz-binding: inherit',
            'declaration-list'
        );
        expect(out).not.toContain('-moz-binding');
    });

    it('drops filter property containing progid:', () => {
        const out = sanitizeCss(
            "filter: progid:DXImageTransform.Microsoft.Alpha(opacity=50)",
            'declaration-list'
        );
        expect(out).not.toContain('progid');
        expect(out).not.toContain('filter');
    });

    it('preserves filter property with standard CSS filter functions', () => {
        const out = sanitizeCss(
            'filter: blur(5px) grayscale(50%)',
            'declaration-list'
        );
        expect(out).toContain('filter');
        expect(out).toContain('blur');
        expect(out).toContain('grayscale');
    });

    it('case-insensitive property name check', () => {
        const out = sanitizeCss(
            'BEHAVIOR: normal',
            'declaration-list'
        );
        expect(out).not.toContain('BEHAVIOR');
        expect(out).not.toContain('behavior');
    });
});

describe('partial survival — siblings untouched (Task 12)', () => {
    it('drops one bad declaration leaving others intact (declaration-list)', () => {
        const out = sanitizeCss(
            'color: red; width: expression(alert(1)); font-weight: bold',
            'declaration-list'
        );
        expect(out).toContain('color: red');
        expect(out).toContain('font-weight: bold');
        expect(out).not.toContain('expression');
        expect(out).not.toContain('width');
    });

    it('drops one bad declaration inside a rule, rest of rule survives', () => {
        const out = sanitizeCss(
            'p { color: red; background: url(https://evil/x); font-weight: bold; }',
            'stylesheet'
        );
        expect(out).toContain('p');
        expect(out).toContain('color: red');
        expect(out).toContain('font-weight: bold');
        expect(out).not.toContain('evil');
        expect(out).not.toContain('background');
    });

    it('drops bad declarations across multiple rules', () => {
        const out = sanitizeCss(
            '.a { color: red; } .b { behavior: normal; } .c { font-size: 12px; }',
            'stylesheet'
        );
        expect(out).toContain('.a');
        expect(out).toContain('color: red');
        expect(out).toContain('.c');
        expect(out).toContain('font-size');
        expect(out).not.toContain('behavior');
    });

    it('drops @import nested inside @media', () => {
        const out = sanitizeCss(
            '@media screen { @import url(https://attacker.example/x.css); p { color: red; } }',
            'stylesheet'
        );
        expect(out).not.toContain('@import');
        expect(out).not.toContain('attacker.example');
        expect(out).toContain('@media');
        expect(out).toContain('color: red');
    });

    // Regression: Task 14 integration harness surfaced a bug where adjacent
    // declarations in declaration-list mode were joined without their
    // separator ';' because Declaration.toString() does not include the
    // trailing semicolon. sanitize-html's own style re-parser then choked on
    // the malformed output ("font-size: 14pxcolor: blue"). The fix is to
    // serialize the synthetic container rule and strip the wrapper braces
    // so postcss's stringify inserts separators correctly.
    it('preserves separator semicolons between adjacent safe declarations (declaration-list)', () => {
        const out = sanitizeCss(
            'color: red; font-weight: bold',
            'declaration-list'
        );
        expect(out).toContain('color: red');
        expect(out).toContain('font-weight: bold');
        // Parseable as a declaration list — no touching tokens across the
        // boundary between declarations.
        expect(out).not.toMatch(/redfont-weight/);
        expect(out).not.toMatch(/boldcolor/);
    });

    it('preserves separators across three safe declarations (declaration-list)', () => {
        const out = sanitizeCss(
            'color: red; font-size: 14px; padding: 4px',
            'declaration-list'
        );
        expect(out).toContain('color: red');
        expect(out).toContain('font-size: 14px');
        expect(out).toContain('padding: 4px');
        expect(out).not.toMatch(/redfont/);
        expect(out).not.toMatch(/14pxpadding/);
    });

    it('preserves separators when a middle declaration is dropped', () => {
        const out = sanitizeCss(
            'color: red; background: url(https://evil/x); font-weight: bold',
            'declaration-list'
        );
        expect(out).toContain('color: red');
        expect(out).toContain('font-weight: bold');
        // Neither the dropped declaration nor a merge of the survivors
        expect(out).not.toContain('evil');
        expect(out).not.toContain('background');
        expect(out).not.toMatch(/redfont-weight/);
    });
});

describe('defense-in-depth regex final pass (Task 13)', () => {
    it('drops a rule whose comment contains @import', () => {
        const out = sanitizeCss(
            'p { color: red; /* @import url(https://evil) */ }',
            'stylesheet'
        );
        expect(out).toBe('');
    });

    it('drops a rule whose comment contains javascript:', () => {
        const out = sanitizeCss(
            'p { color: red; /* javascript:alert(1) */ }',
            'stylesheet'
        );
        expect(out).toBe('');
    });

    it('drops a rule whose comment contains expression(', () => {
        const out = sanitizeCss(
            'p { color: red; /* expression(alert(1)) */ }',
            'stylesheet'
        );
        expect(out).toBe('');
    });

    it('drops a rule whose comment contains vbscript:', () => {
        const out = sanitizeCss(
            'p { color: red; /* vbscript:msgbox(1) */ }',
            'stylesheet'
        );
        expect(out).toBe('');
    });

    it('drops a rule whose comment contains -moz-binding', () => {
        const out = sanitizeCss(
            'p { color: red; /* -moz-binding: url(foo) */ }',
            'stylesheet'
        );
        expect(out).toBe('');
    });

    it('defense-in-depth also applies to declaration-list mode', () => {
        const out = sanitizeCss(
            'color: red /* javascript:alert(1) */',
            'declaration-list'
        );
        expect(out).toBe('');
    });

    it('emits a console.warn when the defense-in-depth pass fires', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sanitizeCss('p { /* @import */ color: red; }', 'stylesheet');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('preserves a rule with a benign comment', () => {
        const out = sanitizeCss(
            'p { color: red; /* just a normal comment */ }',
            'stylesheet'
        );
        expect(out).toContain('color: red');
    });
});

describe('parse failure (Task 13)', () => {
    it('returns empty string and warns when postcss.parse throws', async () => {
        const postcssModule = await import('postcss');
        const parseSpy = vi
            .spyOn(postcssModule.default, 'parse')
            .mockImplementation(() => {
                throw new Error('synthetic parse failure');
            });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            const out = sanitizeCss('p { color: red; }', 'stylesheet');

            expect(out).toBe('');
            expect(warn).toHaveBeenCalled();
            const warnMsg = (warn.mock.calls[0] || []).join(' ');
            expect(warnMsg).toContain('parse failure');
            expect(warnMsg).toContain('synthetic parse failure');
        } finally {
            // Restore in finally so a failed assertion doesn't leak the mock
            // into subsequent tests — even if this block is reordered later.
            parseSpy.mockRestore();
            warn.mockRestore();
        }
    });

    it('returns empty for empty input without calling parse', () => {
        expect(sanitizeCss('', 'stylesheet')).toBe('');
        expect(sanitizeCss('', 'declaration-list')).toBe('');
    });
});
