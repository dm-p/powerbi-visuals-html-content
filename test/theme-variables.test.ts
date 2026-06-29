import { describe, it, expect } from 'vitest';
import {
    isValidColorValue,
    buildThemeVariablesCss
} from '../src/theme-variables';

// Minimal palette stand-in: the builder only reads `.colors`, the named
// members, and `.value` on each — a plain literal cast suffices (no host mock).
const palette = (overrides: Record<string, unknown>): any => ({ ...overrides });

describe('isValidColorValue', () => {
    it('accepts hex (3/4/6/8) and rgb/rgba', () => {
        for (const v of [
            '#fff',
            '#ffff',
            '#ffffff',
            '#ffffffff',
            'rgb(1, 2, 3)',
            'rgba(1,2,3,.5)'
        ]) {
            expect(isValidColorValue(v)).toBe(true);
        }
    });

    it('rejects empty, undefined, named colors, and injection attempts', () => {
        for (const v of [
            '',
            undefined,
            'red',
            'transparent',
            'red; } body { display: none }'
        ]) {
            expect(isValidColorValue(v as any)).toBe(false);
        }
    });
});

describe('buildThemeVariablesCss', () => {
    it('emits 1-indexed numbered colors from colors[]', () => {
        const css = buildThemeVariablesCss(
            palette({
                colors: [{ value: '#111111' }, { value: '#222222' }]
            })
        );
        expect(css).toContain('--pbi-theme-color-1: #111111;');
        expect(css).toContain('--pbi-theme-color-2: #222222;');
        expect(css).not.toContain('--pbi-theme-color-0');
        expect(css.startsWith(':root {')).toBe(true);
    });

    it('emits curated named colors: sentiment named after JSON schema, plus divergent', () => {
        const css = buildThemeVariablesCss(
            palette({
                foreground: { value: '#000000' },
                background: { value: '#ffffff' },
                foregroundSelected: { value: '#0078d4' },
                hyperlink: { value: '#0563c1' },
                // runtime members are positive/negative; vars are good/bad
                positive: { value: '#107c10' },
                negative: { value: '#d64550' },
                neutral: { value: '#d9b300' },
                minimum: { value: '#deefff' },
                center: { value: '#d9b300' }
            })
        );
        expect(css).toContain('--pbi-theme-fg: #000000;');
        expect(css).toContain('--pbi-theme-bg: #ffffff;');
        expect(css).toContain('--pbi-theme-fg-selected: #0078d4;');
        expect(css).toContain('--pbi-theme-hyperlink: #0563c1;');
        expect(css).toContain('--pbi-theme-good: #107c10;');
        expect(css).toContain('--pbi-theme-bad: #d64550;');
        expect(css).toContain('--pbi-theme-neutral: #d9b300;');
        expect(css).toContain('--pbi-theme-min: #deefff;');
        expect(css).toContain('--pbi-theme-center: #d9b300;');
        // sentiment vars mirror the JSON theme keys, not the runtime members
        expect(css).not.toContain('--pbi-theme-positive');
        expect(css).not.toContain('--pbi-theme-negative');
    });

    it('reads the maximium typo, then the corrected maximum, for --pbi-theme-max', () => {
        expect(
            buildThemeVariablesCss(palette({ maximium: { value: '#118dff' } }))
        ).toContain('--pbi-theme-max: #118dff;');
        expect(
            buildThemeVariablesCss(palette({ maximum: { value: '#222222' } }))
        ).toContain('--pbi-theme-max: #222222;');
    });

    it('skips missing members and invalid values', () => {
        const css = buildThemeVariablesCss(
            palette({
                foreground: { value: '#000000' },
                background: { value: 'red; }evil' }, // invalid → skipped
                colors: [{ value: 'not-a-color' }] // invalid → skipped
            })
        );
        expect(css).toContain('--pbi-theme-fg: #000000;');
        expect(css).not.toContain('--pbi-theme-bg');
        expect(css).not.toContain('--pbi-theme-color-1');
    });

    it('handles a missing colors[] array (named only)', () => {
        const css = buildThemeVariablesCss(
            palette({ foreground: { value: '#000000' } })
        );
        expect(css).toContain('--pbi-theme-fg: #000000;');
        expect(css).not.toContain('--pbi-theme-color');
    });

    it('returns empty string when nothing valid is present', () => {
        expect(buildThemeVariablesCss(palette({}))).toBe('');
    });

    it('does not translate values in high contrast (pass-through)', () => {
        const css = buildThemeVariablesCss(
            palette({
                isHighContrast: true,
                foreground: { value: '#ffffff' },
                colors: [{ value: '#ff0000' }]
            })
        );
        // numbered color keeps its true value — no collapse to foreground
        expect(css).toContain('--pbi-theme-color-1: #ff0000;');
        expect(css).toContain('--pbi-theme-fg: #ffffff;');
    });
});
