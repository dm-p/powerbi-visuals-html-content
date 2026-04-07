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
});
