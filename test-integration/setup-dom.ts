/**
 * JSDOM setup for the Playwright spec. Playwright tests run in Node, so
 * any source module that touches `document`, `window`, or DOM APIs needs
 * a JSDOM-backed global environment to import cleanly.
 *
 * This file is imported as a side-effect at the top of csp-regression.spec.ts
 * BEFORE any source-tree imports, so that sanitize-pipeline.ts and its
 * transitive dependencies see a populated globalThis.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/'
});

const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.Range = dom.window.Range;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLDivElement = dom.window.HTMLDivElement;
g.DocumentFragment = dom.window.DocumentFragment;
g.DOMParser = dom.window.DOMParser;
try {
    g.navigator = dom.window.navigator;
} catch {
    Object.defineProperty(globalThis, 'navigator', {
        value: dom.window.navigator,
        configurable: true
    });
}
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb as any, 0) as any;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
