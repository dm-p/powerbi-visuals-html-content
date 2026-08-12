import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    shouldUseStylesheet,
    shouldDimPoint,
    bindVisualDataToDom,
    domSerialize,
    getRawHtml,
    resolveHtmlGroupElement,
    reconcileVisualDataToDom,
    stampRenderedContent,
    resolveTemplateContainer,
    renderTemplatedEntries,
    reconcileTemplatedEntries,
    resolveForRawHtml,
    getDiagnosticsRawHtml
} from '../src/domain-utils';
import { resolveHover, resolveHyperlinkHandling } from '../src/interactivity';
import {
    setArmed,
    snapshot as evtSnapshot,
    resetForTests as resetEvents
} from '../src/diagnostics/event-recorder';
import type {
    StylesheetSettings,
    VisualFormattingSettingsModel
} from '../src/visual-settings';
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

            it("emits literal > and ' in attribute values", () => {
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
                const p = dom.window.document.body.firstElementChild as Element;
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
                const p = dom.window.document.body.firstElementChild as Element;
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
                expect(domSerialize(node)).toBe('<img src="x.png" alt="x">');
            });

            it('emits <hr> without closing tag', () => {
                const node = parseFirst('<hr>');
                expect(domSerialize(node)).toBe('<hr>');
            });
        });

        describe('nesting and structure', () => {
            it('serializes nested elements in source order', () => {
                const node = parseFirst('<div><p>x</p><p>y</p></div>');
                expect(domSerialize(node)).toBe('<div><p>x</p><p>y</p></div>');
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

        it('getDiagnosticsRawHtml reads the raw-view <pre> textContent (no recursion when Show Raw HTML is on)', () => {
            const { styleSheetContainer, container, dom } = buildContainers('');
            const pre = dom.window.document.createElement('pre');
            pre.id = VisualConstants.dom.rawOutputIdSelector;
            pre.textContent = '<div>actual raw</div>';
            (container.node() as Element).appendChild(pre);
            const out = getDiagnosticsRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings()
            );
            // Returns the pre's text verbatim — NOT a re-serialization that would
            // wrap it in <pre id="rawHtmlOutput">...</pre>.
            expect(out).toBe('<div>actual raw</div>');
            expect(out).not.toContain('rawHtmlOutput');
        });

        it('getDiagnosticsRawHtml serializes live content when no raw-view <pre> exists', () => {
            const { styleSheetContainer, container } =
                buildContainers('<p>live</p>');
            const out = getDiagnosticsRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings()
            );
            expect(out).toContain('<p>');
            expect(out).toContain('live');
        });

        it('bounds output at the raw-HTML cap and skips pretty() for over-cap content', () => {
            // Authors push multi-MB content; getRawHtml must cap BEFORE the
            // super-linear pretty() runs, not leave the cap to a downstream
            // consumer. Build content that serializes well past the cap.
            const cap = VisualConstants.diagnostics.rawHtmlCapBytes;
            const { styleSheetContainer, container } = buildContainers(
                'x'.repeat(cap + 50_000)
            );
            const out = getRawHtml(
                styleSheetContainer,
                container,
                buildStylesheetSettings()
            );
            expect(out.length).toBeLessThanOrEqual(cap);
            // Not mangled: still begins with the serialized content element.
            expect(out.startsWith('<div id="content">')).toBe(true);
        });

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
            const { styleSheetContainer, container } =
                buildContainers('<p>hi</p>');
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
            const { styleSheetContainer, container, dom } = buildContainers('');
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

    const entry = (key: string, content: string): any => ({
        content,
        // getKey is the only identity method the keyed join uses; equals is
        // unused filler to loosely match the ISelectionId shape.
        identity: { getKey: () => key, equals: () => false },
        selected: false,
        tooltips: []
    });

    describe('reconcileVisualDataToDom', () => {
        const setup = () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><body><div id="container"></div></body>'
            );
            const container = select(dom.window.document).select('#container');
            return container;
        };

        // Model a full caller cycle: reconcile, then stamp what it rendered.
        // The production caller stamps `toRender` after resolveHtmlGroupElement,
        // so a baseline bind must stamp for the next reconcile to diff against.
        const reconcileAndStamp = (
            container: ReturnType<typeof setup>,
            data: ReturnType<typeof entry>[]
        ) => {
            const result = reconcileVisualDataToDom(container, data, false);
            stampRenderedContent(result.toRender);
            return result;
        };

        it('retains the same DOM node for an unchanged entry across updates', () => {
            const container = setup();
            reconcileAndStamp(container, [entry('a', '<p>1</p>')]);
            const firstNode = container.select('.htmlViewerEntry').node();
            // second update, same key + same content
            const { toRender } = reconcileVisualDataToDom(
                container,
                [entry('a', '<p>1</p>')],
                false
            );
            const secondNode = container.select('.htmlViewerEntry').node();
            expect(secondNode).toBe(firstNode); // same element reference = iframe survives
            expect(toRender.size()).toBe(0); // nothing to re-render
        });

        it('marks a changed entry for re-render but keeps its node', () => {
            const container = setup();
            reconcileAndStamp(container, [entry('a', '<p>1</p>')]);
            const firstNode = container.select('.htmlViewerEntry').node();
            const { toRender } = reconcileVisualDataToDom(
                container,
                [entry('a', '<p>2</p>')],
                false
            );
            expect(container.select('.htmlViewerEntry').node()).toBe(firstNode);
            expect(toRender.size()).toBe(1);
        });

        it('enters new entries and exits removed ones by identity key', () => {
            const container = setup();
            reconcileAndStamp(container, [entry('a', 'A'), entry('b', 'B')]);
            const { merged, toRender } = reconcileVisualDataToDom(
                container,
                [entry('a', 'A'), entry('c', 'C')],
                false
            );
            expect(merged.size()).toBe(2); // a retained, c entered, b exited
            expect(toRender.size()).toBe(1); // only c needs render (a unchanged)
        });

        it('toRender includes all entries on first bind (no stash yet)', () => {
            const container = setup();
            const { toRender } = reconcileVisualDataToDom(
                container,
                [entry('a', 'A'), entry('b', 'B')],
                false
            );
            expect(toRender.size()).toBe(2);
        });

        it('reorders retained nodes to match new data order (merged.order)', () => {
            const container = setup();
            reconcileAndStamp(container, [entry('a', 'A'), entry('b', 'B')]);
            const aNode = container.selectAll('.htmlViewerEntry').nodes()[0];
            reconcileVisualDataToDom(
                container,
                [entry('b', 'B'), entry('a', 'A')],
                false
            );
            const nodes = container.selectAll('.htmlViewerEntry').nodes();
            // DOM order now b, a; and the 'a' node is the same element (retained)
            expect(nodes.length).toBe(2);
            expect(nodes[1]).toBe(aNode);
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
        const buildHarness = (innerHtml: string, allowDelegation: boolean) => {
            const dom = new JSDOM(
                `<!DOCTYPE html><html><body><div id="container">${innerHtml}</div></body></html>`
            );
            const window = dom.window;
            const document = window.document;
            const container =
                select(document).select<HTMLDivElement>('#container');
            const launchUrl = vi.fn();
            const host = { launchUrl } as any;
            resolveHyperlinkHandling(host, container, allowDelegation);
            const fireClick = (selector: string) => {
                const el = document.querySelector(selector);
                if (!el) {
                    throw new Error(
                        `fireClick: no element matched ${selector}`
                    );
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
                const { fireClick, launchUrl } = buildHarness('<a>x</a>', true);
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
                expect(launchUrl).toHaveBeenCalledWith(
                    'https://primary.example'
                );
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

    // resolveTemplateContainer (Unit 5) resolves the BODY template into a
    // live "join container" where rows will later be inserted. The default
    // body (just `{{content}}`) must be byte-identical to today's behavior
    // (rows go straight into #htmlContent). A custom body is parsed,
    // sanitized while DETACHED, then appended to the live root — with a
    // persistent invisible anchor comment marking the slot. The security
    // boundary is the load-bearing concern: author/CF HTML must NEVER reach
    // the live DOM unsanitized.
    describe('resolveTemplateContainer', () => {
        const makeRoot = () => document.createElement('div');

        it('default body returns the root container with no wrapper', () => {
            const root = makeRoot();
            const tc = resolveTemplateContainer(root, '{{content}}', {});
            expect(tc.container).toBe(root);
            expect(tc.anchor).toBeNull();
            expect(root.children.length).toBe(0);
        });

        it('default body tolerates surrounding whitespace', () => {
            const tc = resolveTemplateContainer(
                makeRoot(),
                '  {{ content }}  ',
                {}
            );
            expect(tc.anchor).toBeNull();
        });

        it('default body clears any pre-existing children of the root', () => {
            // Mirrors today's selectAll('*').remove(): the root is cleared
            // before rows are (re)inserted.
            const root = makeRoot();
            root.appendChild(document.createElement('span'));
            root.appendChild(document.createElement('p'));
            const tc = resolveTemplateContainer(root, '{{content}}', {});
            expect(tc.container).toBe(root);
            expect(root.children.length).toBe(0);
        });

        it('custom table body returns the <tbody> slot parent as the container', () => {
            const root = makeRoot();
            const tc = resolveTemplateContainer(
                root,
                '<table><tbody>{{content}}</tbody></table>',
                {}
            );
            expect(tc.container.tagName).toBe('TBODY');
            expect(root.querySelector('table tbody')).toBe(tc.container);
            expect(tc.anchor && tc.container.contains(tc.anchor)).toBe(true);
        });

        it('preserves static siblings and anchors the slot between them', () => {
            const root = makeRoot();
            const tc = resolveTemplateContainer(
                root,
                '<section><h1>H</h1>{{content}}<footer>F</footer></section>',
                {}
            );
            expect(tc.container.tagName).toBe('SECTION');
            expect(tc.anchor!.previousSibling?.nodeName).toBe('H1');
            expect(tc.anchor!.nextSibling?.nodeName).toBe('FOOTER');
        });

        it('anchors after bare text preceding the slot ("Caption: {{content}}")', () => {
            // previousSibling (not previousElementSibling) keeps the slot's
            // position when only a text node precedes it — rows render AFTER
            // "Caption: ", not before it.
            const root = makeRoot();
            const tc = resolveTemplateContainer(
                root,
                '<div>Caption: {{content}}</div>',
                {}
            );
            expect(tc.anchor!.previousSibling?.nodeType).toBe(Node.TEXT_NODE);
            expect(tc.anchor!.previousSibling?.textContent).toBe('Caption: ');
        });

        it('anchor is a Comment node carrying the slot marker', () => {
            const root = makeRoot();
            const tc = resolveTemplateContainer(
                root,
                '<div>{{content}}</div>',
                {}
            );
            expect(tc.anchor).not.toBeNull();
            expect(tc.anchor!.nodeType).toBe(Node.COMMENT_NODE);
            expect(tc.anchor!.nodeValue).toBe(
                VisualConstants.dom.contentSlotMarker
            );
        });

        it('slot as sole child: anchor is the only child of the container', () => {
            // The common case (e.g. <tbody>{{content}}</tbody>): prevNode is
            // null, so the anchor is prepended and is the only child — Unit
            // 6 inserts rows before it, preserving order.
            const root = makeRoot();
            const tc = resolveTemplateContainer(
                root,
                '<div>{{content}}</div>',
                {}
            );
            expect(tc.container.childNodes.length).toBe(1);
            expect(tc.container.firstChild).toBe(tc.anchor);
        });

        it('sanitizes the body template (no event handlers / forbidden tags survive)', () => {
            const root = makeRoot();
            resolveTemplateContainer(
                root,
                '<div onclick="x()">{{content}}</div><script>bad()</script>',
                {}
            );
            // The sanitizer's element hook DROPS any element carrying an on*
            // handler outright (stronger than merely stripping the attr), so
            // assert the security property directly: no surviving onclick
            // handler and no <script>, regardless of whether the host <div>
            // was kept (attr stripped) or removed entirely. `?? false`
            // coerces the dropped-div case (querySelector → null) so the
            // assertion reads "no surviving onclick" either way.
            expect(
                root.querySelector('div')?.hasAttribute('onclick') ?? false
            ).toBe(false);
            expect(root.innerHTML).not.toContain('onclick');
            expect(root.querySelector('script')).toBeNull();
        });

        // SAFETY INVARIANT: author/CF HTML must be sanitized while DETACHED
        // and only the sanitized result appended to the live root. If an
        // <img src=x onerror=...> were ever appended to the live DOM before
        // sanitization, the onerror handler could fire once connected. Here
        // we assert the ordering constraint directly: by spying on
        // root.appendChild and asserting that ANY node passed to it is
        // ALREADY free of on* attributes at the moment of the call. This
        // test FAILS if resolveTemplateContainer were changed to append
        // unsanitized content first and sanitize afterwards, because the
        // spy would observe a fragment still carrying the onerror attribute.
        // Guards the "sanitize-before-append" ordering invariant.
        it('SAFETY: dangerous onerror img in the body never reaches the live root', () => {
            const root = makeRoot();
            // Attach root to document.body so it is connected; the spy
            // observes real live-DOM appends rather than detached-tree ops.
            document.body.appendChild(root);
            let appendWitnessedOnAttr = false;
            const realAppendChild = root.appendChild.bind(root);
            const appendSpy = vi
                .spyOn(root, 'appendChild')
                .mockImplementation((node: Node) => {
                    // Walk the node tree looking for any element with an on* attribute.
                    // If any on* attribute is present here, the node was appended
                    // BEFORE sanitization — the invariant is violated.
                    const walker = document.createTreeWalker(
                        node,
                        NodeFilter.SHOW_ELEMENT
                    );
                    let current: Node | null = node;
                    while (current) {
                        const el = current as Element;
                        if (el.attributes) {
                            for (let i = 0; i < el.attributes.length; i++) {
                                if (/^on[a-z]+$/i.test(el.attributes[i].name)) {
                                    appendWitnessedOnAttr = true;
                                }
                            }
                        }
                        current = walker.nextNode();
                    }
                    return realAppendChild(node);
                });
            try {
                // The whole element carrying an on* handler is dropped by the
                // element hook; assert nothing dangerous landed in the live DOM.
                resolveTemplateContainer(
                    root,
                    '<div><img src=x onerror="globalThis.__pwned=1">{{content}}</div>',
                    {}
                );
                // Core ordering assertion: the spy must NOT have seen an on*
                // attribute at append time. If content were appended before
                // sanitization, this would fail.
                expect(appendWitnessedOnAttr).toBe(false);
                const img = root.querySelector('img');
                // Either the img was dropped entirely, or (defensively) it
                // carries no onerror attribute. Both are acceptable; what is
                // NOT acceptable is a surviving onerror handler.
                expect(img?.hasAttribute('onerror') ?? false).toBe(false);
                expect(root.innerHTML).not.toContain('onerror');
                expect(root.innerHTML).not.toContain('__pwned');
            } finally {
                appendSpy.mockRestore();
                root.remove();
            }
        });

        it('honors allowHyperlinks=false by stripping href from <a> in the body', () => {
            const root = makeRoot();
            resolveTemplateContainer(
                root,
                '<a href="https://example.com">{{content}}</a>',
                { allowHyperlinks: false }
            );
            const a = root.querySelector('a');
            expect(a).not.toBeNull();
            expect(a?.hasAttribute('href')).toBe(false);
        });

        it('honors allowHyperlinks=true by preserving http(s) href in the body', () => {
            const root = makeRoot();
            resolveTemplateContainer(
                root,
                '<a href="https://example.com">{{content}}</a>',
                { allowHyperlinks: true }
            );
            const a = root.querySelector('a');
            expect(a?.getAttribute('href')).toBe('https://example.com');
        });

        it('fails safe to the root container when the slot is dropped by the parser', () => {
            // A token inside a context where the parser drops the comment
            // (e.g. a position the HTML tree builder discards) leaves no
            // locatable marker. The function must still sanitize the body,
            // append it, and return the root as the container so rows render.
            // <colgroup> only permits <col>; a comment between cols is moved,
            // but to deterministically exercise the no-marker branch we use a
            // template whose substituted marker the tree builder discards:
            // a comment as the sole content of <select>-like contexts is not
            // applicable here, so we assert the contract via a forbidden host.
            const root = makeRoot();
            // <script> is force-removed; its comment child never survives as
            // a top-level locatable marker in the fragment. The slot cannot
            // be found, so the function falls back to root + null anchor.
            const tc = resolveTemplateContainer(
                root,
                '<script>{{content}}</script>',
                {}
            );
            expect(tc.container).toBe(root);
            expect(tc.anchor).toBeNull();
            expect(root.querySelector('script')).toBeNull();
        });

        // Fix 1 pin: if the slot's parent element carries an on* handler, the
        // sanitizer's element hook drops the entire element. The captured
        // `container` (marker.parentNode) becomes detached after sanitization.
        // The containment guard must detect this and fall back to the root.
        it('(e) dropped slot parent falls back to root when sanitizer removes the container element', () => {
            const root = makeRoot();
            // <div onclick="x()"> carries an on* handler — sanitizer drops it
            // entirely, so the captured container becomes detached.
            const tc = resolveTemplateContainer(
                root,
                '<div onclick="x()">{{content}}</div>',
                {}
            );
            expect(tc.container).toBe(root);
            expect(tc.anchor).toBeNull();
            // No <div onclick> must survive in the live root.
            expect(
                root.querySelector('div')?.hasAttribute('onclick') ?? false
            ).toBe(false);
            expect(root.innerHTML).not.toContain('onclick');
        });

        // When the body contains multiple {{content}} tokens, only the first
        // slot is used. Exactly one anchor comment must exist; no leftover
        // marker comments from the second token should survive.
        it('multiple {{content}} tokens: only the first slot is used, exactly one anchor survives', () => {
            const root = makeRoot();
            const tc = resolveTemplateContainer(
                root,
                '<div>{{content}}</div><div>{{content}}</div>',
                {}
            );
            // Anchor must exist (first slot was found).
            expect(tc.anchor).not.toBeNull();
            // Exactly one anchor comment carrying the slot marker in the live DOM.
            const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_COMMENT
            );
            const comments: string[] = [];
            let node = walker.nextNode();
            while (node) {
                comments.push(node.nodeValue ?? '');
                node = walker.nextNode();
            }
            const slotMarker = VisualConstants.dom.contentSlotMarker;
            expect(comments.filter((v) => v === slotMarker).length).toBe(1);
        });

        // When the body has no {{content}} token at all, the function takes the
        // default body fast-path (the `replace(CONTENT_TOKEN, '').trim() === ''`
        // check will NOT match), goes through the custom body path, finds no
        // marker, sanitizes and appends, and falls back to root + null anchor.
        it('no {{content}} token: fails safe — body sanitized and appended, container is root', () => {
            const root = makeRoot();
            const tc = resolveTemplateContainer(
                root,
                '<div>static content</div>',
                {}
            );
            expect(tc.container).toBe(root);
            expect(tc.anchor).toBeNull();
            // The static body is still sanitized and appended.
            expect(root.querySelector('div')).not.toBeNull();
            expect(root.innerHTML).toContain('static content');
        });

        // A <table> element is a valid slot host for the content anchor; comment
        // nodes are legal as direct children of <table> and are NOT foster-
        // parented (unlike bare text or block elements). The anchor must end up
        // inside the <table>, not outside it.
        it('<table> as the direct slot host: container is the <table>, anchor is inside it', () => {
            const root = makeRoot();
            const tc = resolveTemplateContainer(
                root,
                '<table>{{content}}</table>',
                {}
            );
            const table = root.querySelector('table');
            expect(table).not.toBeNull();
            expect(tc.container).toBe(table);
            expect(tc.anchor).not.toBeNull();
            expect(table!.contains(tc.anchor)).toBe(true);
        });
    });

    // Unit 6 — the CORE render unit. The templated row renderer plus the
    // generalized identity-keyed reconcile. Default templates must reproduce
    // today's DOM byte-for-byte (the `.htmlViewerEntry > div > content`
    // two-div structure); custom templates render structural HTML at the row
    // grain (a `<tr>` template yields a real table row, no wrapper div); and
    // the reconcile preserves unchanged-key rows so their exact DOM node (and
    // any inline iframe) survives across updates. These functions are tested
    // directly in jsdom — Unit 7 wires them into the visual.
    describe('renderTemplatedEntries / reconcileTemplatedEntries', () => {
        const entry = (
            key: string,
            content: string,
            rowTemplate = '<div><div>{{row}}</div></div>'
        ) =>
            ({
                identity: { getKey: () => key },
                content,
                rowTemplate,
                selected: false,
                tooltips: []
            }) as any;
        const OPTS = {
            format: 'html',
            allowHyperlinks: false,
            hasSelection: false
        } as const;

        it('default template reproduces the two-div .htmlViewerEntry > div structure', () => {
            const tc = {
                container: document.createElement('div'),
                anchor: null
            };
            renderTemplatedEntries(tc as any, [entry('a', 'X')], OPTS as any);
            const outer = tc.container.querySelector('.htmlViewerEntry')!;
            expect(outer.tagName).toBe('DIV');
            expect(outer.firstElementChild?.tagName).toBe('DIV');
            expect(outer.textContent).toContain('X');
        });

        it('warns once when the row template has no {{row}} token (content would be dropped)', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                // Unique tokenless template so the once-per-template guard fires
                // here regardless of other tests sharing the module-level set.
                const tokenless = '<tr><td>no-row-token-here</td></tr>';
                renderTemplatedEntries(
                    {
                        container: document.createElement('tbody'),
                        anchor: null
                    } as any,
                    [
                        entry('a', '<td>x</td>', tokenless),
                        entry('b', '<td>y</td>', tokenless)
                    ],
                    OPTS as any
                );
                // Once total, not once per row.
                expect(spy).toHaveBeenCalledTimes(1);
                expect(spy.mock.calls[0][0]).toContain('{{row}}');
            } finally {
                spy.mockRestore();
            }
        });

        it('a <tr> row template yields a real table row (no auto-close, no wrapper div)', () => {
            const tbody = document.createElement('tbody');
            renderTemplatedEntries(
                { container: tbody, anchor: null } as any,
                [entry('a', '<td>c</td>', '<tr>{{row}}</tr>')],
                OPTS as any
            );
            const tr = tbody.querySelector('tr')!;
            expect(tr.classList.contains('htmlViewerEntry')).toBe(true);
            expect(tr.querySelector('td')?.textContent).toBe('c');
            expect(tbody.querySelector(':scope > div')).toBeNull();
        });

        it('reconcile retains the same node for an unchanged row (iframe survives)', () => {
            const tc = {
                container: document.createElement('div'),
                anchor: null
            };
            reconcileTemplatedEntries(
                tc as any,
                [entry('a', 'A'), entry('b', 'B')],
                OPTS as any
            );
            const aNode = tc.container.querySelector('.htmlViewerEntry');
            reconcileTemplatedEntries(
                tc as any,
                [entry('a', 'A'), entry('b', 'B2')],
                OPTS as any
            );
            expect(tc.container.querySelectorAll('.htmlViewerEntry')[0]).toBe(
                aNode
            ); // a retained (same node)
            expect(tc.container.textContent).toContain('B2'); // b re-rendered
        });

        it('reconcile re-renders a changed row and exits a removed row', () => {
            const tc = {
                container: document.createElement('div'),
                anchor: null
            };
            reconcileTemplatedEntries(
                tc as any,
                [entry('a', 'A'), entry('b', 'B')],
                OPTS as any
            );
            reconcileTemplatedEntries(
                tc as any,
                [entry('a', 'A2')],
                OPTS as any
            );
            expect(
                tc.container.querySelectorAll('.htmlViewerEntry').length
            ).toBe(1);
            expect(tc.container.textContent).toContain('A2');
        });

        it('reconcile inserts rows before the anchor (static siblings preserved)', () => {
            const container = document.createElement('section');
            const footer = document.createElement('footer');
            container.appendChild(footer);
            const anchor = document.createComment('HC:CONTENT');
            container.insertBefore(anchor, footer);
            reconcileTemplatedEntries(
                { container, anchor } as any,
                [entry('a', 'A')],
                OPTS as any
            );
            const row = container.querySelector('.htmlViewerEntry')!;
            expect(row.nextSibling).toBe(anchor); // row before anchor
            expect(anchor.nextSibling).toBe(footer); // anchor before footer
        });

        it('a multi-root row template degrades to a single .htmlViewerEntry wrapper', () => {
            const tc = {
                container: document.createElement('div'),
                anchor: null
            };
            renderTemplatedEntries(
                tc as any,
                [entry('a', 'x', '<span>{{row}}</span><span>!</span>')],
                OPTS as any
            );
            expect(
                tc.container.querySelectorAll(':scope > .htmlViewerEntry')
                    .length
            ).toBe(1);
        });

        it('markdown content is converted but the template stays HTML', () => {
            const tc = {
                container: document.createElement('div'),
                anchor: null
            };
            renderTemplatedEntries(
                tc as any,
                [entry('a', '**bold**', '<div>{{row}}</div>')],
                {
                    format: 'markdown',
                    allowHyperlinks: false,
                    hasSelection: false
                } as any
            );
            expect(
                tc.container.querySelector('.htmlViewerEntry strong')
                    ?.textContent
            ).toBe('bold');
        });

        it('selector-CF: per-row template variation re-renders on template change', () => {
            const tc = {
                container: document.createElement('div'),
                anchor: null
            };
            reconcileTemplatedEntries(
                tc as any,
                [entry('a', 'A', '<div>{{row}}</div>')],
                OPTS as any
            );
            const before = tc.container.querySelector('.htmlViewerEntry');
            reconcileTemplatedEntries(
                tc as any,
                [entry('a', 'A', '<p>{{row}}</p>')],
                OPTS as any
            ); // same content, new template
            const after = tc.container.querySelector('.htmlViewerEntry');
            expect(after).not.toBe(before); // re-rendered because rowRenderKey changed
            expect(after?.tagName).toBe('P');
        });

        // Fix 1: dim class must be refreshed on retained rows when only selection changes
        it('reconcile refreshes the dim class on a retained row when selection changes', () => {
            const tc = {
                container: document.createElement('div'),
                anchor: null
            };
            const A1 = {
                identity: { getKey: () => 'a' },
                content: 'A',
                rowTemplate: '<div>{{row}}</div>',
                selected: true,
                tooltips: []
            } as any;
            const B1 = {
                identity: { getKey: () => 'b' },
                content: 'B',
                rowTemplate: '<div>{{row}}</div>',
                selected: false,
                tooltips: []
            } as any;
            const OPTS_SEL = {
                format: 'html',
                allowHyperlinks: false,
                hasSelection: true
            } as any;
            reconcileTemplatedEntries(tc as any, [A1, B1], OPTS_SEL);
            const aNode = tc.container.querySelectorAll('.htmlViewerEntry')[0];
            // Initial state: a is selected (not dimmed), b is not selected (dimmed)
            expect(aNode.classList.contains('unselected')).toBe(false);
            expect(
                tc.container
                    .querySelectorAll('.htmlViewerEntry')[1]
                    .classList.contains('unselected')
            ).toBe(true);
            // Selection flips, content identical -> rows retained
            const A2 = { ...A1, selected: false };
            const B2 = { ...B1, selected: true };
            reconcileTemplatedEntries(tc as any, [A2, B2], OPTS_SEL);
            expect(tc.container.querySelectorAll('.htmlViewerEntry')[0]).toBe(
                aNode
            ); // retained (same node)
            // a is now not selected -> should be dimmed
            expect(aNode.classList.contains('unselected')).toBe(true);
            // b is now selected -> should not be dimmed
            expect(
                tc.container
                    .querySelectorAll('.htmlViewerEntry')[1]
                    .classList.contains('unselected')
            ).toBe(false);
        });

        // Fix 2: pin current reorder behavior (node identity retained, final order matches data)
        it('reconcile retains node identity and reorders rows (order() repositions retained nodes)', () => {
            const tc = {
                container: document.createElement('div'),
                anchor: null
            };
            const mk = (k: string) =>
                ({
                    identity: { getKey: () => k },
                    content: k.toUpperCase(),
                    rowTemplate: '<div>{{row}}</div>',
                    selected: false,
                    tooltips: []
                }) as any;
            reconcileTemplatedEntries(
                tc as any,
                [mk('a'), mk('b'), mk('c')],
                OPTS as any
            );
            const before = Array.from(
                tc.container.querySelectorAll('.htmlViewerEntry')
            );
            // Same keys+content, reordered
            reconcileTemplatedEntries(
                tc as any,
                [mk('c'), mk('a'), mk('b')],
                OPTS as any
            );
            const after = Array.from(
                tc.container.querySelectorAll('.htmlViewerEntry')
            );
            // Same node objects, just repositioned (retained identity)
            expect(after[0]).toBe(before[2]); // c
            expect(after[1]).toBe(before[0]); // a
            expect(after[2]).toBe(before[1]); // b
            expect(after.map((n) => n.textContent)).toEqual(['C', 'A', 'B']);
        });

        // Fix 3a: mixed enter/retain/change/exit pass
        it('mixed pass [a,b,c,d] → [a,b′,e,c]: correct node identity, order, toRender', () => {
            const tc = {
                container: document.createElement('div'),
                anchor: null
            };
            reconcileTemplatedEntries(
                tc as any,
                [
                    entry('a', 'A'),
                    entry('b', 'B'),
                    entry('c', 'C'),
                    entry('d', 'D')
                ],
                OPTS as any
            );
            const nodesBefore = Array.from(
                tc.container.querySelectorAll('.htmlViewerEntry')
            );
            const [aNode, , cNode] = nodesBefore; // b and d will change/exit
            const { toRender } = reconcileTemplatedEntries(
                tc as any,
                [
                    entry('a', 'A'), // retained, unchanged
                    entry('b', 'B2'), // retained, changed -> fresh
                    entry('e', 'E'), // entered -> fresh
                    entry('c', 'C') // retained, unchanged
                ],
                OPTS as any
            );
            const nodesAfter = Array.from(
                tc.container.querySelectorAll('.htmlViewerEntry')
            );
            // a and c are the same node refs (retained, unchanged)
            expect(nodesAfter[0]).toBe(aNode);
            expect(nodesAfter[3]).toBe(cNode);
            // b′ and e are fresh nodes (not the originals)
            expect(nodesAfter[1]).not.toBe(nodesBefore[1]);
            expect(nodesAfter[2]).not.toBe(nodesBefore[0]);
            // d is gone
            expect(
                tc.container.querySelectorAll('.htmlViewerEntry').length
            ).toBe(4);
            // Final text order
            expect(nodesAfter.map((n) => n.textContent)).toEqual([
                'A',
                'B2',
                'E',
                'C'
            ]);
            // toRender contains exactly b′ and e (size 2)
            expect(toRender.size()).toBe(2);
            const toRenderTexts = toRender
                .nodes()
                .map((n) => (n as Element).textContent);
            expect(toRenderTexts.sort()).toEqual(['B2', 'E'].sort());
        });

        // Fix 3b: all-exit with anchor — container footer and anchor are preserved
        it('all-exit with anchor: zero rows, footer and anchor preserved, no crash', () => {
            const container = document.createElement('section');
            const footer = document.createElement('footer');
            container.appendChild(footer);
            const anchor = document.createComment('HC:CONTENT');
            container.insertBefore(anchor, footer);
            const tc = { container, anchor };
            reconcileTemplatedEntries(
                tc as any,
                [entry('a', 'A'), entry('b', 'B')],
                OPTS as any
            );
            // Now exit all rows
            reconcileTemplatedEntries(tc as any, [], OPTS as any);
            expect(container.querySelectorAll('.htmlViewerEntry').length).toBe(
                0
            );
            // footer and anchor still present
            expect(container.contains(footer)).toBe(true);
            expect(container.contains(anchor)).toBe(true);
        });
    });
});

describe('resolveForRawHtml — colorized in-canvas raw view (DRY)', () => {
    const settingsStub = (css = ''): VisualFormattingSettingsModel =>
        ({
            contentFormatting: {
                contentFormattingCardBehavior: { showRawHtml: { value: true } }
            },
            stylesheet: { stylesheetCardMain: { stylesheet: { value: css } } }
        }) as unknown as VisualFormattingSettingsModel;

    it('renders a colorized <pre> (not a <textarea>) via the shared highlighter', () => {
        // Use the global jsdom document so buildHighlightedFragment's nodes and
        // the container share one document.
        const content = document.createElement('div');
        const p = document.createElement('p');
        p.textContent = 'hi';
        content.appendChild(p);
        const styleEl = document.createElement('style');

        resolveForRawHtml(select(styleEl), select(content), settingsStub());

        const pre = content.querySelector('#rawHtmlOutput') as HTMLElement;
        expect(pre).not.toBeNull();
        expect(pre.tagName).toBe('PRE');
        expect(content.querySelector('textarea')).toBeNull();
        // Colorized via the same buildHighlightedFragment the dialog uses...
        expect(pre.querySelectorAll('.hc-tag').length).toBeGreaterThan(0);
        // ...and shows the serialized raw markup (lossless text).
        expect(pre.textContent).toContain('hi');
        expect(pre.textContent).toContain('<p>');
    });
});

describe('tooltip host-event instrumentation', () => {
    // Self-contained container builder (the getRawHtml describe's helper is
    // scoped to that block and not visible here).
    const buildContainers = (contentHtml: string) => {
        const dom = new JSDOM(
            `<!DOCTYPE html><html><body>` +
                `<div id="content">${contentHtml}</div>` +
                `</body></html>`
        );
        const container = select(dom.window.document).select('#content');
        return { container, dom };
    };

    beforeEach(() => resetEvents());

    it('records a contextual tooltip show with source and context', () => {
        setArmed(true);
        const { container, dom } = buildContainers('');
        const node = container.node() as Element;
        const row = dom.window.document.createElement('div');
        node.appendChild(row);
        const sel = select(row).datum({
            tooltips: [{ displayName: 'Region', value: 'East' }],
            identity: {}
        } as any) as any;
        const host: any = {
            tooltipService: { show: () => {}, hide: () => {} }
        };
        resolveHover(sel, host, true);
        sel.dispatch('mouseover');
        const s = evtSnapshot();
        expect(
            s.some(
                (e) =>
                    e.type === 'tooltip' &&
                    e.summary === 'show · contextual' &&
                    // show context is coord-prefixed: '@ (x,y) Region="East"'
                    e.context?.endsWith('Region="East"')
            )
        ).toBe(true);
    });

    it('records a contextual tooltip hide on mouseout', () => {
        setArmed(true);
        const { container, dom } = buildContainers('');
        const node = container.node() as Element;
        const row = dom.window.document.createElement('div');
        node.appendChild(row);
        const sel = select(row).datum({
            tooltips: [{ displayName: 'Region', value: 'East' }],
            identity: {}
        } as any) as any;
        const host: any = {
            tooltipService: { show: () => {}, hide: () => {} }
        };
        resolveHover(sel, host, true);
        sel.dispatch('mouseout');
        expect(
            evtSnapshot().some(
                (e) => e.type === 'tooltip' && e.summary === 'hide · contextual'
            )
        ).toBe(true);
    });

    it('records a manual-path tooltip show on mouseover', () => {
        setArmed(true);
        const { container, dom } = buildContainers('');
        const node = container.node() as Element;
        // dataElements is the #content selection; bindManualTooltips wires
        // descendants matching `.tooltipEnabled`. The HTML data API camel-cases
        // data-tooltip-title0 -> dataset.tooltipTitle0 (and -value0), which
        // bindManualTooltips strips back to a single key "0", resolving one
        // { displayName: 'Manual', value: 'X' } dataItem -> context 'Manual="X"'.
        const manual = dom.window.document.createElement('div');
        manual.classList.add('tooltipEnabled');
        manual.setAttribute('data-tooltip-title0', 'Manual');
        manual.setAttribute('data-tooltip-value0', 'X');
        node.appendChild(manual);
        const host: any = {
            tooltipService: { show: () => {}, hide: () => {} }
        };
        resolveHover(container as any, host, false);
        select(manual).dispatch('mouseover');
        expect(
            evtSnapshot().some(
                (e) =>
                    e.type === 'tooltip' &&
                    e.summary === 'show · manual' &&
                    // show context is coord-prefixed: '@ (x,y) Manual="X"'
                    e.context?.endsWith('Manual="X"')
            )
        ).toBe(true);
    });
});
