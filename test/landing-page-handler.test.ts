import { describe, it, expect, vi, beforeEach } from 'vitest';
import LandingPageHandler from '../src/landing-page-handler';
import { select } from 'd3-selection';
import { JSDOM } from 'jsdom';

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
        it('should create landing page container with proper classes', () => {
            handler.handleLandingPage(false, mockHost);

            const container = mockElement.select('.html-display-landing-page');
            expect(container.empty()).toBe(false);
        });

        it('should call localisationManager for text content', () => {
            handler.handleLandingPage(false, mockHost);

            // Should have called getDisplayName for the overview texts
            expect(mockLocalisationManager.getDisplayName).toHaveBeenCalled();
        });

        it('should create a help button', () => {
            handler.handleLandingPage(false, mockHost);

            const button = mockElement.select('button');
            expect(button.empty()).toBe(false);
            expect(button.text()).toBe('?');
        });
    });
});
