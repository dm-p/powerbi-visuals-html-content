import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { LandingPageHandler } from '../src/landing';
import { select } from 'd3-selection';
import { JSDOM } from 'jsdom';

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

        it('renders no W3.CSS classes', () => {
            handler.handleLandingPage(false, mockHost);
            expect(mockElement.node().innerHTML).not.toMatch(/\bw3-/);
        });

        // Relies on the pretest-generated CHANNEL=undefined (production)
        // selection — spuriously fails under a raw `npx vitest run` while a
        // channel selection (alpha/beta) is active.
        it('renders no channel badge on a production build', () => {
            handler.handleLandingPage(false, mockHost);
            expect(
                mockElement.node().querySelector('.hc-landing-channel-badge')
            ).toBeNull();
        });
    });

    describe('channel badge key mapping', () => {
        // CHANNEL is compiled in via the generated module, so each mapping case
        // forces it with a module mock rather than relying on build state.
        for (const [channel, key] of [
            ['alpha', 'Landing_ChannelBadge_Alpha'],
            ['beta', 'Landing_ChannelBadge_Beta']
        ] as const) {
            it(`resolves ${key} and renders its text for ${channel} builds`, async () => {
                vi.resetModules();
                vi.doMock('../src/visual-config.generated', async () => ({
                    ...(await vi.importActual<Record<string, unknown>>(
                        '../src/visual-config.generated'
                    )),
                    CHANNEL: channel
                }));

                const { default: MockedHandler } =
                    await import('../src/landing/handler');

                const dom = new JSDOM(
                    '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
                );
                const element = select(dom.window.document).select(
                    '#container'
                );
                const localisationManager = {
                    getDisplayName: vi.fn(
                        (localizationKey: string) =>
                            `Localized: ${localizationKey}`
                    )
                };
                const host = { launchUrl: vi.fn() };

                const mockedHandler = new MockedHandler(
                    element,
                    localisationManager
                );
                mockedHandler.handleLandingPage(false, host);

                expect(localisationManager.getDisplayName).toHaveBeenCalledWith(
                    key
                );
                const badge = element
                    .node()
                    .querySelector('.hc-landing-channel-badge');
                expect(badge).not.toBeNull();
                expect(badge.textContent).toBe(`Localized: ${key}`);

                vi.doUnmock('../src/visual-config.generated');
            });
        }

        it('both badge keys exist in the en-US resources', () => {
            const resources = JSON.parse(
                readFileSync('stringResources/en-US/resources.resjson', 'utf8')
            );
            expect(resources.Landing_ChannelBadge_Alpha).toMatch(/ALPHA BUILD/);
            expect(resources.Landing_ChannelBadge_Beta).toMatch(/BETA BUILD/);
        });
    });
});
