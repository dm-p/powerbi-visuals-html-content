import { describe, it, expect } from 'vitest';
import { VisualConstants } from '../src/visual-constants';

describe('VisualConstants edition + resolved config', () => {
    it('exposes the design edition for the certified test build', () => {
        expect(VisualConstants.edition).toBe('secure');
    });

    it('resolves the base visual config fields used at runtime', () => {
        expect(VisualConstants.visual.version).toBe('2.0.0.0');
        expect(VisualConstants.visual.supportUrl).toMatch(/^https:\/\//);
        expect(VisualConstants.visual.gitHubUrl).toContain('github.com');
    });
});
