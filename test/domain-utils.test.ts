import { describe, it, expect, vi } from 'vitest';
import {
    shouldUseStylesheet,
    shouldDimPoint,
    bindVisualDataToDom,
    domSerialize,
    getRawHtml
} from '../src/domain-utils';
import { VisualConstants } from '../src/visual-constants';
import { select } from 'd3-selection';
import { JSDOM } from 'jsdom';

describe('Domain Utils - Exported Functions', () => {
    describe('shouldUseStylesheet', () => {
        it('should return true when stylesheet is provided', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: 'body { color: red; }' }
                }
            } as any;

            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(true);
        });

        it('should return false when stylesheet is empty', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: '' }
                }
            } as any;

            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(false);
        });

        it('should return false when stylesheet is null', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: null }
                }
            } as any;

            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(false);
        });

        it('should return false when stylesheet is undefined', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: undefined }
                }
            } as any;

            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(false);
        });

        it('should return true for whitespace-only stylesheet', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: '   ' }
                }
            } as any;

            // Whitespace is truthy, so this returns true
            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(true);
        });
    });

    describe('shouldDimPoint', () => {
        it('should return true when has selection and point is not selected', () => {
            const result = shouldDimPoint(true, false);
            expect(result).toBe(true);
        });

        it('should return false when has selection and point is selected', () => {
            const result = shouldDimPoint(true, true);
            expect(result).toBe(false);
        });

        it('should return false when no selection', () => {
            const result = shouldDimPoint(false, false);
            expect(result).toBe(false);
        });

        it('should return false when no selection even if point selected', () => {
            const result = shouldDimPoint(false, true);
            expect(result).toBe(false);
        });
    });

    describe('bindVisualDataToDom', () => {
        it('should create elements for each data entry', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test 1</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                },
                {
                    content: '<p>Test 2</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                }
            ] as any[];

            const result = bindVisualDataToDom(container, data, false);

            // Should create entries for each data item
            expect(result.size()).toBe(2);
        });

        it('should apply entry class to all elements', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                }
            ] as any[];

            bindVisualDataToDom(container, data, false);

            const entries = container.selectAll(
                `.${VisualConstants.dom.entryClassSelector}`
            );
            expect(entries.size()).toBe(1);
        });

        it('should apply unselected class when hasSelection is true and item is not selected', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                }
            ] as any[];

            bindVisualDataToDom(container, data, true);

            const unselected = container.selectAll(
                `.${VisualConstants.dom.unselectedClassSelector}`
            );
            expect(unselected.size()).toBe(1);
        });

        it('should not apply unselected class when hasSelection is false', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                }
            ] as any[];

            bindVisualDataToDom(container, data, false);

            const unselected = container.selectAll(
                `.${VisualConstants.dom.unselectedClassSelector}`
            );
            expect(unselected.size()).toBe(0);
        });

        it('should not apply unselected class when item is selected', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test</p>',
                    identity: {},
                    selected: true,
                    tooltips: []
                }
            ] as any[];

            bindVisualDataToDom(container, data, true);

            const unselected = container.selectAll(
                `.${VisualConstants.dom.unselectedClassSelector}`
            );
            expect(unselected.size()).toBe(0);
        });

        it('should handle empty data array', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const result = bindVisualDataToDom(container, [], false);

            expect(result.size()).toBe(0);
        });
    });

    describe('domSerialize', () => {
        // Parse an HTML fragment and return the first element child of body.
        const parseFirst = (html: string): Element => {
            const dom = new JSDOM(
                `<!DOCTYPE html><html><body>${html}</body></html>`
            );
            const el = dom.window.document.body.firstElementChild;
            if (!el) {
                throw new Error('parseFirst: no element produced from ' + html);
            }
            return el;
        };

        describe('attribute serialization', () => {
            it('emits a single attribute with literal value', () => {
                const node = parseFirst('<p title="hello">x</p>');
                expect(domSerialize(node)).toBe('<p title="hello">x</p>');
            });

            it('preserves multiple attributes in source order', () => {
                const node = parseFirst(
                    '<a href="/" title="home" id="link">x</a>'
                );
                expect(domSerialize(node)).toBe(
                    '<a href="/" title="home" id="link">x</a>'
                );
            });

            it('emits literal & in attribute values (regression for issue #76)', () => {
                const node = parseFirst(
                    '<iframe src="https://example.com/?a=1&b=2"></iframe>'
                );
                const out = domSerialize(node);
                expect(out).toContain('src="https://example.com/?a=1&b=2"');
                expect(out).not.toContain('&amp;');
            });

            it('emits literal < in attribute values', () => {
                // jsdom parses "3 < 4" into the title attribute; outerHTML
                // would encode it as "3 &lt; 4", but our walker emits the
                // literal characters as they appear in the DOM.
                const node = parseFirst('<p title="3 < 4">x</p>');
                const out = domSerialize(node);
                expect(out).toContain('title="3 < 4"');
                expect(out).not.toContain('&lt;');
            });

            it('emits literal > and \' in attribute values', () => {
                const node = parseFirst(
                    `<p title="a>b" data-quote="it's">x</p>`
                );
                const out = domSerialize(node);
                expect(out).toContain('title="a>b"');
                expect(out).toContain(`data-quote="it's"`);
                expect(out).not.toContain('&gt;');
                expect(out).not.toContain('&#39;');
                expect(out).not.toContain('&apos;');
            });

            it('emits element with no attributes without trailing space', () => {
                const node = parseFirst('<span>x</span>');
                expect(domSerialize(node)).toBe('<span>x</span>');
            });

            it('preserves namespaced attribute names (xlink:href)', () => {
                const dom = new JSDOM(
                    '<!DOCTYPE html><html><body></body></html>'
                );
                const svg = dom.window.document.createElementNS(
                    'http://www.w3.org/2000/svg',
                    'svg'
                );
                const use = dom.window.document.createElementNS(
                    'http://www.w3.org/2000/svg',
                    'use'
                );
                use.setAttribute('xlink:href', '#a');
                svg.appendChild(use);
                const out = domSerialize(svg);
                expect(out).toContain('xlink:href="#a"');
            });
        });

        describe('text-node serialization', () => {
            it('emits text content literally', () => {
                const node = parseFirst('<p>hello world</p>');
                expect(domSerialize(node)).toBe('<p>hello world</p>');
            });

            it('emits literal & < > in text content', () => {
                // jsdom decodes "&amp;" → "&", "&lt;" → "<", "&gt;" → ">"
                // at parse time; the walker emits the resulting literal
                // characters rather than re-encoding them.
                const node = parseFirst('<p>&amp; &lt; &gt;</p>');
                expect(domSerialize(node)).toBe('<p>& < ></p>');
            });
        });

        describe('void elements', () => {
            it('emits <br> without closing tag', () => {
                const node = parseFirst('<br>');
                expect(domSerialize(node)).toBe('<br>');
            });

            it('emits <img> with attrs and no closing tag', () => {
                const node = parseFirst('<img src="x.png" alt="x">');
                expect(domSerialize(node)).toBe(
                    '<img src="x.png" alt="x">'
                );
            });

            it('emits <hr> without closing tag', () => {
                const node = parseFirst('<hr>');
                expect(domSerialize(node)).toBe('<hr>');
            });
        });

        describe('nesting and structure', () => {
            it('serializes nested elements in source order', () => {
                const node = parseFirst('<div><p>x</p><p>y</p></div>');
                expect(domSerialize(node)).toBe(
                    '<div><p>x</p><p>y</p></div>'
                );
            });

            it('emits empty element with open and close tags', () => {
                const node = parseFirst('<div></div>');
                expect(domSerialize(node)).toBe('<div></div>');
            });

            it('lowercases tag names', () => {
                // The HTML parser uppercases tagName for HTML elements
                // regardless of source case; the walker lowercases on
                // emit to match dev-tools display.
                const node = parseFirst('<DIV>x</DIV>');
                expect(domSerialize(node)).toBe('<div>x</div>');
            });
        });

        describe('non-element node types', () => {
            it('emits comment nodes as <!--text-->', () => {
                const dom = new JSDOM(
                    '<!DOCTYPE html><html><body><!-- hi --></body></html>'
                );
                const comment = dom.window.document.body.firstChild;
                expect(comment).not.toBeNull();
                expect(domSerialize(comment as Node)).toBe('<!-- hi -->');
            });

            it('serializes a DocumentFragment by concatenating children', () => {
                const dom = new JSDOM(
                    '<!DOCTYPE html><html><body></body></html>'
                );
                const fragment = dom.window.document.createDocumentFragment();
                const p = dom.window.document.createElement('p');
                p.textContent = 'x';
                const span = dom.window.document.createElement('span');
                span.textContent = 'y';
                fragment.appendChild(p);
                fragment.appendChild(span);
                expect(domSerialize(fragment)).toBe('<p>x</p><span>y</span>');
            });

            it('returns empty string for unsupported node types', () => {
                const dom = new JSDOM(
                    '<!DOCTYPE html><html><body></body></html>'
                );
                const pi = dom.window.document.createProcessingInstruction(
                    'xml-stylesheet',
                    'href="x.css"'
                );
                expect(domSerialize(pi as unknown as Node)).toBe('');
            });
        });
    });

    describe('getRawHtml', () => {
        // Build minimal StylesheetSettings; pass non-empty css when the
        // stylesheet container should be included in the output.
        const buildStylesheetSettings = (css = '') =>
            ({
                stylesheetCardMain: {
                    stylesheet: { value: css }
                }
            } as any);

        // Build a JSDOM with a stylesheet container (initially empty) and
        // a populated content container, return d3 selections for both.
        const buildContainers = (contentHtml: string) => {
            const dom = new JSDOM(
                `<!DOCTYPE html><html><body>` +
                    `<style id="ss"></style>` +
                    `<div id="content">${contentHtml}</div>` +
                    `</body></html>`
            );
            const styleSheetContainer = select(dom.window.document).select(
                '#ss'
            );
            const container = select(dom.window.document).select('#content');
            return { styleSheetContainer, container, dom };
        };

        it('emits literal & in iframe src (regression for issue #76)', () => {
            const { styleSheetContainer, container } = buildContainers(
                '<iframe src="https://example.com/?a=1&b=2"></iframe>'
            );
            const out = getRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings()
            );
            expect(out).toContain('src="https://example.com/?a=1&b=2"');
            expect(out).not.toContain('&amp;');
        });

        it('emits literal < in attribute values', () => {
            const { styleSheetContainer, container } = buildContainers(
                '<p title="3 < 4">x</p>'
            );
            const out = getRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings()
            );
            expect(out).toContain('title="3 < 4"');
            expect(out).not.toContain('&lt;');
        });

        it('reflects sanitizer-removed tags as absences in the output', () => {
            // Simulates the post-sanitization DOM: <script> has been
            // stripped and only <p>hi</p> survives. The view must show
            // what is in the DOM (post-sanitize), not the user's input.
            const { styleSheetContainer, container } = buildContainers(
                '<p>hi</p>'
            );
            const out = getRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings()
            );
            expect(out).toContain('<p>hi</p>');
            expect(out).not.toContain('<script>');
        });

        it('reflects sanitizer-rewritten style attribute values', () => {
            // Simulates the post-sanitization DOM where position:fixed was
            // dropped from a style attribute, leaving color:red.
            const { styleSheetContainer, container } = buildContainers(
                '<div style="color: red">x</div>'
            );
            const out = getRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings()
            );
            expect(out).toContain('style="color: red"');
            expect(out).not.toContain('position: fixed');
        });

        it('emits a user-supplied stylesheet body without entity encoding', () => {
            const css =
                'body { background: url(https://example.com/?a=1&b=2); }';
            const { styleSheetContainer, container } =
                buildContainers('<p>x</p>');
            // Populate the live <style> DOM as resolveStyling would,
            // post-sanitization.
            styleSheetContainer.text(css);
            const out = getRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings(css)
            );
            expect(out).toContain('a=1&b=2');
            expect(out).not.toContain('&amp;');
        });

        it('handles an empty content container without throwing', () => {
            const { styleSheetContainer, container } = buildContainers('');
            const out = getRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings()
            );
            expect(typeof out).toBe('string');
            expect(out).toContain('<div id="content"></div>');
        });
    });
});
