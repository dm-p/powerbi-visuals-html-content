import { describe, it, expect, vi, beforeEach } from 'vitest';
import LandingPageHandler from '../src/landing-page-handler';
import { select } from 'd3-selection';
import { JSDOM } from 'jsdom';

// The generated mark module imports an .svg asset, which the test runner
// cannot resolve as a module. Stub it to a data URI so the handler can be
// imported under test.
vi.mock('../src/landing-mark.generated', () => ({
    MARK_URL: 'data:image/svg+xml;base64,STUB'
}));

// Mock the resolveScrollableContent function which uses OverlayScrollbars
vi.mock('../src/domain-utils', async importOriginal => {
    const original = await importOriginal<
        typeof import('../src/domain-utils')
    >();
    return {
        ...original,
        resolveScrollableContent: vi.fn()
    };
});

describe('LandingPageHandler', () => {
    let handler: LandingPageHandler;
    let mockElement: any;
    let mockLocalisationManager: any;
    let mockHost: any;

    beforeEach(() => {
        const dom = new JSDOM(
            '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
        );
        mockElement = select(dom.window.document).select('#container');

        mockLocalisationManager = {
            getDisplayName: vi.fn((key: string) => `Localized: ${key}`)
        };

        mockHost = {
            launchUrl: vi.fn()
        };

        handler = new LandingPageHandler(mockElement, mockLocalisationManager);
    });

    describe('constructor', () => {
        it('should initialize with landing page disabled', () => {
            expect(handler.landingPageEnabled).toBe(false);
        });

        it('should initialize with landing page not removed', () => {
            expect(handler.landingPageRemoved).toBe(false);
        });
    });

    describe('handleLandingPage', () => {
        it('should enable landing page when view model is not valid', () => {
            handler.handleLandingPage(false, mockHost);
            expect(handler.landingPageEnabled).toBe(true);
        });

        it('should not re-render if landing page is already enabled', () => {
            handler.handleLandingPage(false, mockHost);
            const firstRenderChildren = mockElement.node().children.length;

            // Call again - should not add more children
            handler.handleLandingPage(false, mockHost);
            expect(mockElement.node().children.length).toBe(
                firstRenderChildren
            );
        });

        it('should clear landing page when view model becomes valid', () => {
            handler.handleLandingPage(false, mockHost);
            expect(handler.landingPageEnabled).toBe(true);

            handler.handleLandingPage(true, mockHost);
            expect(handler.landingPageEnabled).toBe(false);
        });
    });

    describe('clear', () => {
        it('should remove all children from element', () => {
            handler.handleLandingPage(false, mockHost);
            expect(mockElement.node().children.length).toBeGreaterThan(0);

            handler.clear();
            expect(mockElement.node().children.length).toBe(0);
        });

        it('should set landingPageRemoved to true after clearing enabled page', () => {
            handler.handleLandingPage(false, mockHost);
            handler.clear();
            expect(handler.landingPageRemoved).toBe(true);
        });

        it('should set landingPageEnabled to false', () => {
            handler.handleLandingPage(false, mockHost);
            handler.clear();
            expect(handler.landingPageEnabled).toBe(false);
        });

        it('should not set landingPageRemoved if page was never enabled', () => {
            handler.clear();
            expect(handler.landingPageRemoved).toBe(false);
        });
    });

    describe('render', () => {
        it('renders the splash container with the class prefix', () => {
            handler.handleLandingPage(false, mockHost);
            const container = mockElement.select('.html-display-landing-page');
            expect(container.empty()).toBe(false);
            expect(container.classed('hc-landing')).toBe(true);
        });

        it('localizes the headline via the localisation manager', () => {
            handler.handleLandingPage(false, mockHost);
            expect(mockLocalisationManager.getDisplayName).toHaveBeenCalledWith(
                'Landing_Headline'
            );
        });

        it('launches the docs URL when the Docs button is clicked', () => {
            handler.handleLandingPage(false, mockHost);
            const docs = mockElement
                .node()
                .querySelector('.hc-landing-docs') as HTMLElement;
            docs.click();
            expect(mockHost.launchUrl).toHaveBeenCalled();
        });

        it('renders no W3.CSS classes', () => {
            handler.handleLandingPage(false, mockHost);
            expect(mockElement.node().innerHTML).not.toMatch(/\bw3-/);
        });
    });
});
