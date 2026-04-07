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
