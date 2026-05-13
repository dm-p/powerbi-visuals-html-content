/**
 * JSDOM globalThis bootstrap shared by the script generators
 * (generate-uat-corpus, generate-sanitization-docs).
 *
 * Side-effect import: importing this module populates the globals the
 * sanitize-pipeline and its transitive deps require (window, document,
 * Range, Node, Element, etc.) before any consumer reaches `import` of
 * sanitize-pipeline. The order matters — keep this import first in
 * any file that needs it.
 *
 * No exports. The module's value is its side effect.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
    '<!doctype html><html><head></head><body></body></html>',
    {
        pretendToBeVisual: true,
        url: 'http://localhost/'
    }
);
const g = globalThis as unknown as {
    window: typeof dom.window;
    document: typeof dom.window.document;
    Range: typeof dom.window.Range;
    Node: typeof dom.window.Node;
    Element: typeof dom.window.Element;
    HTMLElement: typeof dom.window.HTMLElement;
    HTMLDivElement: typeof dom.window.HTMLDivElement;
    DocumentFragment: typeof dom.window.DocumentFragment;
    DOMParser: typeof dom.window.DOMParser;
    navigator: typeof dom.window.navigator;
    getComputedStyle: typeof dom.window.getComputedStyle;
};
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
