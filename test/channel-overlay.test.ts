import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolveEditionConfig } from '../config/editions.mjs';
import base from '../pbiviz.json';

describe('resolveEditionConfig', () => {
    it('composes an edition with no channel exactly as before', () => {
        const r = resolveEditionConfig(base, 'standard');
        expect(r.visual.guid).toBe(
            'htmlContent443BE3AD55E043BF878BED274D3A6855'
        );
        expect(r.visual.displayName).toBe('HTML Content');
        expect(r.assets.icon).toBe('assets/palette_icon_standard.png');
        expect(r.capabilities).toBe('capabilities.webaccess.json');
        expect(r.sanitize).toBe(false);
        expect(r.edition).toBe('flagship');
    });

    it('certified with no channel is the pbiviz.json base', () => {
        const r = resolveEditionConfig(base, 'certified');
        expect(r.visual).toEqual(base.visual);
        expect(r.assets).toEqual(base.assets);
        expect(r.capabilities).toBe('capabilities.json');
        expect(r.sanitize).toBe(true);
        expect(r.edition).toBe('secure');
    });

    it('applies the beta channel overlay to standard', () => {
        const r = resolveEditionConfig(base, 'standard', 'beta');
        expect(r.visual.guid).toBe(
            'BETAhtmlContent443BE3AD55E043BF878BED274D3A6855'
        );
        expect(r.visual.displayName).toBe('HTML Content (Beta)');
        expect(r.assets.icon).toBe('assets/palette_icon_standard_beta.png');
        // channel never touches the internal version
        expect(r.visual.version).toBe(base.visual.version);
    });

    it('applies the alpha channel overlay to certified', () => {
        const r = resolveEditionConfig(base, 'certified', 'alpha');
        expect(r.visual.guid).toBe(
            'ALPHAhtmlContent443BE3AD55E043BF878BED274D3A6865'
        );
        expect(r.visual.displayName).toBe('HTML Content Secure (Alpha)');
        expect(r.assets.icon).toBe('assets/palette_icon_secure_alpha.png');
        expect(r.capabilities).toBe('capabilities.json');
    });

    it('every channel icon it can emit exists on disk', () => {
        for (const edition of ['standard', 'certified']) {
            for (const channel of ['alpha', 'beta']) {
                const r = resolveEditionConfig(base, edition, channel);
                expect(existsSync(r.assets.icon), r.assets.icon).toBe(true);
            }
        }
    });

    it('rejects channel builds for standalone', () => {
        expect(() => resolveEditionConfig(base, 'standalone', 'beta')).toThrow(
            /does not support/
        );
    });

    it('rejects unknown channels and editions', () => {
        expect(() => resolveEditionConfig(base, 'standard', 'canary')).toThrow(
            /Unknown channel/
        );
        expect(() => resolveEditionConfig(base, 'nope')).toThrow(
            /Unknown edition/
        );
        expect(() => resolveEditionConfig(base, 'standard', '')).toThrow(
            /Unknown channel/
        );

        // Pins the Object.hasOwn guard: prototype-chain keys must not
        // resolve as editions.
        for (const key of ['constructor', '__proto__', 'toString']) {
            expect(() => resolveEditionConfig(base, key)).toThrow(
                /Unknown edition/
            );
        }
    });

    it('never mutates the base config', () => {
        const snapshot = JSON.parse(JSON.stringify(base));
        resolveEditionConfig(
            base,
            'standard',
            'beta',
            '2.0.0.20260813#b044cfdc'
        );
        expect(base).toEqual(snapshot);
    });

    it('applies a version override in channel builds', () => {
        const r = resolveEditionConfig(
            base,
            'standard',
            'beta',
            '2.0.0.20260813#b044cfdc'
        );
        expect(r.visual.version).toBe('2.0.0.20260813#b044cfdc');
        // identity overlay is unaffected by the override
        expect(r.visual.guid).toBe(
            'BETAhtmlContent443BE3AD55E043BF878BED274D3A6855'
        );
    });

    it('leaves the version untouched when no override is given', () => {
        const r = resolveEditionConfig(base, 'certified', 'alpha');
        expect(r.visual.version).toBe(base.visual.version);
    });

    it('rejects a version override without a channel', () => {
        expect(() =>
            resolveEditionConfig(
                base,
                'standard',
                undefined,
                '2.0.0.20260813#b044cfdc'
            )
        ).toThrow(/requires a channel/);
    });
});
