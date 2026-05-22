import { describe, it, expect, vi } from 'vitest';
import {
    shouldUseStylesheet,
    shouldDimPoint,
    bindVisualDataToDom,
    domSerialize,
    getRawHtml,
    resolveHyperlinkHandling,
    resolveHtmlGroupElement
} from '../src/domain-utils';
import type { StylesheetSettings } from '../src/visual-settings';
import { VisualConstants } from '../src/visual-constants';
import { select } from 'd3-selection';
import { JSDOM } from 'jsdom';

// Mock the `pretty` package so a sub-set of tests can swap in a throwing
// implementation to exercise getRawHtml's try/catch fallback. Default
// behaviour is pass-through, so existing tests that rely on real pretty
// output continue to work. Hoisted by vitest via vi.mock semantics; the
// default export is a `vi.fn` so individual tests can switch
// implementations via `vi.mocked(pretty).mockImplementation(...)`.
vi.mock('pretty', () => ({
    default: vi.fn((input: string) => input)
}));
import pretty from 'pretty';

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

    // resolveHtmlGroupElement is the visual's data → DOM bridge for
    // rendered HTML mode. It binds each IHtmlEntry's `content` through
    // getParsedHtmlAsDom and appends the sanitized fragment. The
    // `allowHyperlinks` parameter is the toggle for the format-pane
    // `hyperlinks` setting and must be honored end-to-end through this
    // path — the unit tests in test/sanitize-pipeline.test.ts cover the
    // sanitizer directly; these cover the function that wires the
    // toggle through.
    describe('resolveHtmlGroupElement', () => {
        const buildDataElements = (
            content: string
        ): { container: any; entries: any } => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');
            const data = [
                {
                    content,
                    identity: {},
                    selected: false,
                    tooltips: []
                }
            ] as any[];
            const entries = bindVisualDataToDom(container, data, false);
            return { container, entries };
        };

        it('strips href from <a> when allowHyperlinks is false', () => {
            const { container, entries } = buildDataElements(
                '<a href="https://example.com">link</a>'
            );
            resolveHtmlGroupElement(entries, 'html', false);
            const html = container.node()!.innerHTML;
            expect(html).not.toContain('href=');
            expect(html).not.toContain('example.com');
            expect(html).toContain('link');
        });

        it('preserves http(s) href when allowHyperlinks is true', () => {
            const { container, entries } = buildDataElements(
                '<a href="https://example.com">link</a>'
            );
            resolveHtmlGroupElement(entries, 'html', true);
            const html = container.node()!.innerHTML;
            expect(html).toContain('href="https://example.com"');
            expect(html).toContain('link');
        });

        it('defaults to fail-closed (strips href) when the toggle arg is omitted', () => {
            // Defense for the contract drift case: caller forgets the 3rd
            // arg, default value at the function boundary takes over and
            // matches the sanitizer's fail-closed default.
            const { container, entries } = buildDataElements(
                '<a href="https://example.com">link</a>'
            );
            (resolveHtmlGroupElement as any)(entries, 'html');
            const html = container.node()!.innerHTML;
            expect(html).not.toContain('href=');
            expect(html).toContain('link');
        });

        it('still drops javascript: href even with toggle on', () => {
            // The toggle controls attribute survival when populated; it
            // does NOT relax the scheme allowlist. Dangerous schemes
            // remain rejected regardless of toggle state.
            const { container, entries } = buildDataElements(
                '<a href="javascript:alert(1)">x</a>'
            );
            resolveHtmlGroupElement(entries, 'html', true);
            const html = container.node()!.innerHTML;
            expect(html).not.toContain('javascript:');
            expect(html).not.toContain('alert(1)');
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

            it('escapes literal " in attribute values to &quot;', () => {
                // Attribute values are always double-quote delimited, so a
                // literal " would close the attribute early and produce
                // malformed output that trips js-beautify. We escape " →
                // &quot; specifically; & and < deliberately stay literal
                // per the dev-tools-style contract.
                const dom = new JSDOM(
                    '<!DOCTYPE html><html><body><p></p></body></html>'
                );
                const p = dom.window.document.body
                    .firstElementChild as Element;
                p.setAttribute('data-json', '{"k":"v"}');
                const out = domSerialize(p);
                expect(out).toContain(
                    'data-json="{&quot;k&quot;:&quot;v&quot;}"'
                );
                expect(out).not.toContain('{"k":"v"}');
            });

            it('preserves literal & and < in attribute values even when " is escaped', () => {
                // Regression seal: the " escape must not bleed into a
                // general entity-encoding pass that would re-introduce
                // the #76 bug for &.
                const dom = new JSDOM(
                    '<!DOCTYPE html><html><body><p></p></body></html>'
                );
                const p = dom.window.document.body
                    .firstElementChild as Element;
                p.setAttribute('data-mix', 'a & b < c "quoted"');
                const out = domSerialize(p);
                expect(out).toContain('a & b < c &quot;quoted&quot;');
                expect(out).not.toContain('&amp;');
                expect(out).not.toContain('&lt;');
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

            it('preserves SVG element case (e.g. linearGradient)', () => {
                // SVG tag names are case-sensitive. The HTML parser
                // preserves the source case for SVG-namespaced elements
                // (unlike HTML elements which it uppercases). The walker
                // must emit them verbatim so users can mentally diff
                // the dev-tools view against valid SVG source.
                const dom = new JSDOM(
                    '<!DOCTYPE html><html><body></body></html>'
                );
                const svg = dom.window.document.createElementNS(
                    'http://www.w3.org/2000/svg',
                    'svg'
                );
                const grad = dom.window.document.createElementNS(
                    'http://www.w3.org/2000/svg',
                    'linearGradient'
                );
                grad.setAttribute('id', 'g1');
                svg.appendChild(grad);
                const out = domSerialize(svg);
                expect(out).toContain('<linearGradient id="g1">');
                expect(out).toContain('</linearGradient>');
                expect(out).not.toContain('lineargradient');
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
        // stylesheet container should be included in the output. Uses a
        // Pick to keep the structural surface narrow to what getRawHtml
        // actually reads (`stylesheetCardMain.stylesheet.value`), and
        // casts via `unknown` so the test helper doesn't have to
        // re-implement the full FormattingSettingsCard hierarchy.
        type MinimalStylesheetSettings = Pick<
            StylesheetSettings,
            'stylesheetCardMain'
        >;
        const buildStylesheetSettings = (css = ''): StylesheetSettings => {
            const minimal: MinimalStylesheetSettings = {
                stylesheetCardMain: {
                    stylesheet: { value: css }
                } as StylesheetSettings['stylesheetCardMain']
            };
            return minimal as unknown as StylesheetSettings;
        };

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

        it('reproduces issue #76 verbatim — iframe with & in src serialized correctly even though sanitizer strips it today', () => {
            // Issue #76 originally reported this exact payload:
            //   <iframe src=https://www.google.com/search?q=url+ampersand&num=5
            //           style='position: fixed; width: 100%; height: 100%'>
            //   </iframe>
            //
            // The current sanitizer strips <iframe> entirely (verified
            // separately), so this payload never reaches the dev-tools-
            // style serializer in production today — the bug is doubly-
            // protected. This test bypasses the sanitizer and constructs
            // the iframe directly to confirm the serializer would still
            // emit the literal "&" in the URL if a future sanitizer rule
            // change ever allowed iframes through. Defends the fix
            // against regression on a path the sanitizer happens to
            // also defend.
            const { styleSheetContainer, container, dom } =
                buildContainers('');
            const iframe = dom.window.document.createElement('iframe');
            iframe.setAttribute(
                'src',
                'https://www.google.com/search?q=url+ampersand&num=5'
            );
            iframe.setAttribute(
                'style',
                'position: fixed; width: 100%; height: 100%'
            );
            (container.node() as Element).appendChild(iframe);
            const out = getRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings()
            );
            expect(out).toContain(
                'src="https://www.google.com/search?q=url+ampersand&num=5"'
            );
            expect(out).not.toContain('&amp;');
        });

        it('falls back to unindented walker output when pretty throws', () => {
            // Defense-in-depth: if js-beautify (via `pretty`) ever throws
            // on the walker's dev-tools-style HTML (which is technically
            // invalid when attribute values contain literal `&`), the
            // debug toggle must stay functional. Swap pretty's
            // implementation to a thrower for this test, then restore
            // the passthrough so subsequent tests are unaffected.
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            vi.mocked(pretty).mockImplementationOnce(() => {
                throw new Error('pretty boom');
            });
            try {
                const { styleSheetContainer, container } = buildContainers(
                    '<p title="3 < 4">x</p>'
                );
                const out = getRawHtml(
                    styleSheetContainer,
                    container,
                    buildStylesheetSettings()
                );
                // Fallback returns the raw walker output, which still
                // contains the literal-character attribute value.
                expect(out).toContain('title="3 < 4"');
                expect(warnSpy).toHaveBeenCalled();
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('does not produce a leading space when no stylesheet is included (fallback path)', () => {
            // Regression: when ssFragment is '', the template literal
            // `${ssFragment} ${content}` would emit a stray leading space.
            // pretty() trims it, but the catch fallback returns the raw
            // string verbatim, surfacing the artefact in the debug textarea.
            // Conditional separator in getRawHtml prevents the leading space.
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            vi.mocked(pretty).mockImplementationOnce(() => {
                throw new Error('pretty boom');
            });
            try {
                const { styleSheetContainer, container } =
                    buildContainers('<p>x</p>');
                const out = getRawHtml(
                    styleSheetContainer,
                    container,
                    buildStylesheetSettings()
                );
                expect(out.startsWith(' ')).toBe(false);
                expect(out).toContain('<p>x</p>');
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('preserves the separator space when a stylesheet IS included', () => {
            // Sanity check: the conditional separator must still emit the
            // gap between stylesheet and content fragments when both are
            // present.
            const css = 'body { color: red; }';
            const { styleSheetContainer, container } =
                buildContainers('<p>x</p>');
            styleSheetContainer.text(css);
            const out = getRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings(css)
            );
            expect(out).toContain(
                '<style id="ss">body { color: red; }</style>'
            );
            expect(out).toContain('<div id="content">');
        });
    });

    // Pairs with the format-pane `hyperlinks` toggle. The sanitizer
    // already restricts <a href> / <a xlink:href> to http/https and
    // drops the attribute entirely when the toggle is off, so most of
    // this is defense-in-depth — but the click handler is the last
    // line before host.launchUrl, and must independently reject any
    // non-http(s) URL that somehow reached the DOM, fall back to
    // xlink:href for legacy SVG <a>, and be a strict no-op when the
    // toggle is off.
    describe('resolveHyperlinkHandling', () => {
        // Helper: build a JSDOM container, wire a mock host with a
        // vi.fn() launchUrl, attach `resolveHyperlinkHandling`, and
        // return primitives the assertions can interrogate.
        const buildHarness = (
            innerHtml: string,
            allowDelegation: boolean
        ) => {
            const dom = new JSDOM(
                `<!DOCTYPE html><html><body><div id="container">${innerHtml}</div></body></html>`
            );
            const window = dom.window;
            const document = window.document;
            const container = select(document).select<HTMLDivElement>(
                '#container'
            );
            const launchUrl = vi.fn();
            const host = { launchUrl } as any;
            resolveHyperlinkHandling(host, container, allowDelegation);
            const fireClick = (selector: string) => {
                const el = document.querySelector(selector);
                if (!el) {
                    throw new Error(`fireClick: no element matched ${selector}`);
                }
                const ev = new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true
                });
                el.dispatchEvent(ev);
                return ev;
            };
            return { fireClick, launchUrl };
        };

        describe('delegation OFF (allowDelegation=false)', () => {
            it('preventDefault on click and does NOT call launchUrl', () => {
                const { fireClick, launchUrl } = buildHarness(
                    '<a href="https://example.com">x</a>',
                    false
                );
                const ev = fireClick('a');
                expect(ev.defaultPrevented).toBe(true);
                expect(launchUrl).not.toHaveBeenCalled();
            });
        });

        describe('delegation ON (allowDelegation=true)', () => {
            it('calls launchUrl with the href value for https://', () => {
                const { fireClick, launchUrl } = buildHarness(
                    '<a href="https://example.com">x</a>',
                    true
                );
                fireClick('a');
                expect(launchUrl).toHaveBeenCalledTimes(1);
                expect(launchUrl).toHaveBeenCalledWith('https://example.com');
            });

            it('calls launchUrl for http:// scheme', () => {
                const { fireClick, launchUrl } = buildHarness(
                    '<a href="http://example.com">x</a>',
                    true
                );
                fireClick('a');
                expect(launchUrl).toHaveBeenCalledWith('http://example.com');
            });

            it('rejects javascript: scheme (defense-in-depth)', () => {
                // Construct the link via innerHTML directly so the
                // sanitizer is bypassed — this scenario models a
                // sanitizer regression. The click handler must still
                // refuse to call launchUrl.
                const { fireClick, launchUrl } = buildHarness(
                    '<a href="javascript:alert(1)">x</a>',
                    true
                );
                const ev = fireClick('a');
                expect(ev.defaultPrevented).toBe(true);
                expect(launchUrl).not.toHaveBeenCalled();
            });

            it('rejects data: scheme', () => {
                const { fireClick, launchUrl } = buildHarness(
                    '<a href="data:text/html,<script>1</script>">x</a>',
                    true
                );
                fireClick('a');
                expect(launchUrl).not.toHaveBeenCalled();
            });

            it('rejects mailto: scheme (launchUrl only accepts http(s))', () => {
                const { fireClick, launchUrl } = buildHarness(
                    '<a href="mailto:test@example.com">x</a>',
                    true
                );
                fireClick('a');
                expect(launchUrl).not.toHaveBeenCalled();
            });

            it('rejects empty / missing href silently', () => {
                const { fireClick, launchUrl } = buildHarness(
                    '<a>x</a>',
                    true
                );
                const ev = fireClick('a');
                expect(ev.defaultPrevented).toBe(true);
                expect(launchUrl).not.toHaveBeenCalled();
            });

            it('rejects fragment-only href (#anchor)', () => {
                // Fragment-only refs reach the click handler if the
                // user authored them on an HTML <a>. launchUrl does
                // not handle them; silent no-op is correct.
                const { fireClick, launchUrl } = buildHarness(
                    '<a href="#section">x</a>',
                    true
                );
                fireClick('a');
                expect(launchUrl).not.toHaveBeenCalled();
            });

            it('trims surrounding whitespace before scheme check', () => {
                const { fireClick, launchUrl } = buildHarness(
                    '<a href="  https://example.com  ">x</a>',
                    true
                );
                fireClick('a');
                expect(launchUrl).toHaveBeenCalledWith('https://example.com');
            });

            it('falls back to xlink:href on SVG <a> without unprefixed href', () => {
                // SVG 1.1 form: legacy authored content uses xlink:href
                // without the SVG2 unprefixed href. The handler must
                // still launch it.
                const { fireClick, launchUrl } = buildHarness(
                    '<svg><a xlink:href="https://example.com"><text>x</text></a></svg>',
                    true
                );
                fireClick('a');
                expect(launchUrl).toHaveBeenCalledWith('https://example.com');
            });

            it('prefers href over xlink:href when both present', () => {
                // SVG2 unprefixed `href` takes precedence in renderers
                // when both are declared. The handler mirrors that.
                const { fireClick, launchUrl } = buildHarness(
                    '<svg><a href="https://primary.example" xlink:href="https://fallback.example"><text>x</text></a></svg>',
                    true
                );
                fireClick('a');
                expect(launchUrl).toHaveBeenCalledWith('https://primary.example');
            });

            it('blocks JavaScript: with mixed case (defense-in-depth)', () => {
                const { fireClick, launchUrl } = buildHarness(
                    '<a href="JavaScript:alert(1)">x</a>',
                    true
                );
                fireClick('a');
                expect(launchUrl).not.toHaveBeenCalled();
            });
        });
    });
});
