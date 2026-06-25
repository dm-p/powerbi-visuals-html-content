import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSplash, LandingLabels, LandingUrls } from '../src/landing/splash';

const labels: LandingLabels = {
    headline: 'Ready when you are.',
    body: 'Drop a measure or field that returns HTML into the Values well.',
    quickStart: 'Quick start',
    whatsNew: "What's new",
    sandboxNote: 'Some browser features are limited inside the sandbox.',
    sandboxNoteLink: 'see the docs',
    valuesLabel: 'Values',
    valuesField: 'Report HTML',
    valuesHint: 'drop a field here',
    compactBody: 'Add a field with HTML to the Values well to render it here.',
    openDocs: 'Open the docs'
};
const urls: LandingUrls = {
    docs: 'https://docs.example',
    quickStart: 'https://quickstart.example',
    changelog: 'https://changelog.example',
    github: 'https://gh.example',
    sponsor: 'https://sponsor.example',
    coffee: 'https://coffee.example'
};

describe('buildSplash', () => {
    let doc: Document;
    beforeEach(() => {
        doc = new JSDOM('<!DOCTYPE html><body></body>').window.document;
    });

    it('renders the Secure name + suffix and the edition mark image', () => {
        const el = buildSplash(doc, {
            edition: 'secure',
            version: '2.0.0.0',
            markUrl: 'data:image/svg+xml;base64,SECURE',
            labels,
            urls,
            onLaunch: vi.fn()
        });
        expect(el.querySelector('.hc-landing-name')?.textContent).toContain(
            'HTML Content'
        );
        expect(el.querySelector('.hc-landing-suffix')?.textContent).toBe('Secure');
        const img = el.querySelector('img.hc-landing-mark') as HTMLImageElement;
        expect(img.getAttribute('src')).toBe('data:image/svg+xml;base64,SECURE');
        expect(el.querySelector('.hc-landing-headline')?.textContent).toBe(
            'Ready when you are.'
        );
    });

    it('flagship has an empty suffix', () => {
        const el = buildSplash(doc, {
            edition: 'flagship',
            version: '2.0.0.0',
            markUrl: 'x',
            labels,
            urls,
            onLaunch: vi.fn()
        });
        expect(el.querySelector('.hc-landing-suffix')?.textContent).toBe('');
    });

    it('delegates link clicks to onLaunch instead of navigating', () => {
        const onLaunch = vi.fn();
        const el = buildSplash(doc, {
            edition: 'standalone',
            version: '2.0.0.0',
            markUrl: 'x',
            labels,
            urls,
            onLaunch
        });
        (el.querySelector('.hc-landing-link--brand') as HTMLElement).click();
        expect(onLaunch).toHaveBeenCalledWith(urls.quickStart);
        (el.querySelector('[data-link="github"]') as HTMLElement).click();
        expect(onLaunch).toHaveBeenCalledWith(urls.github);
        (el.querySelector('[data-link="sponsor"]') as HTMLElement).click();
        expect(onLaunch).toHaveBeenCalledWith(urls.sponsor);
        (el.querySelector('[data-link="coffee"]') as HTMLElement).click();
        expect(onLaunch).toHaveBeenCalledWith(urls.coffee);
    });

    it('inline link icons are SVG-namespaced (cert-safe)', () => {
        const el = buildSplash(doc, {
            edition: 'secure',
            version: '2.0.0.0',
            markUrl: 'x',
            labels,
            urls,
            onLaunch: vi.fn()
        });
        el.querySelectorAll('.hc-landing-iconlink svg').forEach((s) =>
            expect(s.namespaceURI).toBe('http://www.w3.org/2000/svg')
        );
    });
});
