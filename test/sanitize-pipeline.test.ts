import { describe, it, expect } from 'vitest';
import {
    getSanitizedHtmlForTesting,
    getSanitizedCss
} from '../src/sanitize-pipeline';

/**
 * End-to-end smoke tests for src/sanitize-pipeline.ts. These exercise the
 * full sanitize-html + sanitizeCss + preprocessStyleTags + data URI
 * attribute handling pipeline. They are intentionally small and
 * representative — the full payload corpus lives in the Playwright
 * integration harness. The css-sanitizer unit suite covers sanitizeCss
 * in isolation; this file covers the wiring.
 */
describe('sanitize-pipeline end-to-end', () => {
    describe('inline style attribute', () => {
        it('preserves safe color declaration', () => {
            const out = getSanitizedHtmlForTesting(
                '<p style="color: red">x</p>',
                'html'
            );
            expect(out).toContain('color');
            expect(out).toContain('red');
            expect(out).toContain('x');
        });

        it('drops MS-cert content:url payload but preserves text', () => {
            const out = getSanitizedHtmlForTesting(
                '<div style="content:url(data:1234***qwerty)">Hello</div>',
                'html'
            );
            expect(out).not.toContain('content:url');
            expect(out).not.toContain('data:1234');
            expect(out).toContain('Hello');
        });

        it('partial survival when one declaration is unsafe', () => {
            const out = getSanitizedHtmlForTesting(
                '<p style="color: red; background: url(https://evil/x)">x</p>',
                'html'
            );
            expect(out).toContain('color');
            expect(out).toContain('red');
            expect(out).not.toContain('evil');
            expect(out).not.toContain('background');
        });
    });

    describe('<style> tag content', () => {
        it('preserves safe rule', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>p { color: red; }</style><p>x</p>',
                'html'
            );
            expect(out).toContain('<style>');
            expect(out).toContain('color');
            expect(out).toContain('red');
        });

        it('drops @import', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>@import url(https://evil);</style><p>x</p>',
                'html'
            );
            expect(out).not.toContain('@import');
            expect(out).not.toContain('evil');
            expect(out).toContain('x');
        });

        it('partial survival inside a rule', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>p { color: red; font-weight: bold; background: url(https://evil/x); }</style>',
                'html'
            );
            expect(out).toContain('color');
            expect(out).toContain('font-weight');
            expect(out).not.toContain('evil');
            expect(out).not.toContain('background');
        });

        // The <style> body goes through preprocessStyleTags (regex
        // extraction → sanitizeCss → reinsertion) before DOMPurify sees
        // it. css-sanitizer.test.ts covers selector behavior in isolation;
        // these smoke tests verify the pipeline preserves modern selectors
        // through the full wiring.
        it('preserves :has() through <style>', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>.row:has(.active) .panel { display: block; }</style>',
                'html'
            );
            expect(out).toContain(':has(');
            expect(out).toContain('.active');
        });

        it('preserves :has() chained with :hover through <style>', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>.row:hover:has(.active) .label { font-weight: bold; }</style>',
                'html'
            );
            expect(out).toContain(':has(');
            expect(out).toContain(':hover');
        });

        // Issue #143 follow-up: reporters on 1.6.1.0 said CSS variables
        // were dropped through the <style>-in-data path. Confirm the
        // pipeline preserves them all the way from raw HTML input
        // through preprocessStyleTags + sanitizeCss + DOMPurify +
        // uponSanitizeElement backstop to the final output.
        it('preserves CSS variables (:root + var()) through <style>-in-data', () => {
            const out = getSanitizedHtmlForTesting(
                '<style id="visualUserStylesheet" type="text/css">' +
                ':root { --bg: #fff; --color: #111; }' +
                '.card { background: var(--bg); color: var(--color); }' +
                '</style>' +
                '<div class="card">x</div>',
                'html'
            );
            expect(out).toContain('--bg');
            expect(out).toContain('--color');
            expect(out).toContain('var(--bg)');
            expect(out).toContain('var(--color)');
        });

        it('preserves clamp() and rgba() through <style>-in-data', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>' +
                '.card { font-size: clamp(12px, 3vw, 16px); ' +
                'box-shadow: 0 2px 6px rgba(0,0,0,0.2); }' +
                '</style>' +
                '<div class="card">x</div>',
                'html'
            );
            expect(out).toContain('clamp(');
            expect(out).toContain('rgba(');
        });

        it('preserves @media containing CSS variables through <style>-in-data', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>' +
                ':root { --pad: 16px; }' +
                '@media (max-width: 600px) { ' +
                '.card { padding: var(--pad); font-size: clamp(12px, 3vw, 16px) !important; } ' +
                '}' +
                '</style>' +
                '<div class="card">x</div>',
                'html'
            );
            expect(out).toContain('@media');
            expect(out).toContain('--pad');
            expect(out).toContain('var(--pad)');
            expect(out).toContain('clamp(');
            expect(out).toContain('!important');
        });

        // Pins the uponSanitizeElement nodeType !== 1 (ELEMENT_NODE)
        // early-out. DOMPurify 3.x types the hook as
        // `(currentNode: Node, ...)`, and the hook body widens to Node
        // then narrows to Element before touching `.attributes`. Without
        // the narrowing a non-element node visit (e.g. the text node
        // inside a sanitized <style>) would throw on `.attributes` and
        // the surrounding try/catch would silently drop the element.
        // This test exercises that path so a future edit removing the
        // narrowing fails CI rather than slipping through under the
        // fail-closed envelope.
        it('handles non-element nodes inside <style> without throwing (nodeType narrowing)', () => {
            const out = getSanitizedHtmlForTesting(
                '<style>/* leading comment */ body { color: red; } /* trailing */</style>' +
                    '<p>x</p>',
                'html'
            );
            // The <style> tag and its bound declaration survive the
            // backstop. The <p> wrapper also survives, proving the
            // element hook didn't abort the sanitize pass.
            expect(out).toContain('color');
            expect(out).toContain('red');
            expect(out).toContain('<p>x</p>');
        });
    });

    describe('attribute sanitization', () => {
        it('preserves safe image data URI in src', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">',
                'html'
            );
            expect(out).toContain('data:image/png');
        });

        it('drops unsafe data URI in src', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:text/html,<script>alert(1)</script>" alt="x">',
                'html'
            );
            expect(out).not.toContain('text/html');
            expect(out).not.toContain('alert(1)');
            expect(out).not.toContain('<script');
        });

        it('drops event handler attributes', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:image/png;base64,AAA" onclick="alert(1)">',
                'html'
            );
            expect(out).not.toContain('onclick');
            expect(out).not.toContain('alert(1)');
        });

        // image/svg+xml data URIs are legitimately emitted by DAX
        // measures (Power BI SVG-as-IMG pattern) and other tooling in
        // both `;utf8,` and bare-comma form. SVG is text by spec, so
        // the base64 requirement that applies to raster image MIMEs is
        // bypassed for image/svg+xml. Browsers sandbox SVG loaded via
        // <img> — embedded scripts and external resource references
        // do not execute in image-loading context (issue #143).
        it('preserves data:image/svg+xml;utf8 in <img src>', () => {
            const svg =
                "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><circle cx='5' cy='5' r='4' fill='red'/></svg>";
            const out = getSanitizedHtmlForTesting(
                `<img src="data:image/svg+xml;utf8,${svg}" alt="x">`,
                'html'
            );
            expect(out).toContain('data:image/svg+xml');
            expect(out).toContain("viewBox='0 0 10 10'");
        });

        it('preserves data:image/svg+xml without charset (bare comma) in <img src>', () => {
            const svg =
                "<svg xmlns='http://www.w3.org/2000/svg'><rect width='10' height='10'/></svg>";
            const out = getSanitizedHtmlForTesting(
                `<img src="data:image/svg+xml,${svg}" alt="x">`,
                'html'
            );
            expect(out).toContain('data:image/svg+xml');
            expect(out).toContain("rect width='10'");
        });

        it('preserves data:image/svg+xml;base64 in <img src>', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">',
                'html'
            );
            expect(out).toContain('data:image/svg+xml;base64');
        });

        it('still drops data:image/png without base64 (smuggled non-binary)', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:image/png,<script>alert(1)</script>" alt="x">',
                'html'
            );
            expect(out).not.toContain('script');
            expect(out).not.toContain('alert(1)');
        });

        it('still drops data:text/html in <img src> (script-bearing MIME)', () => {
            const out = getSanitizedHtmlForTesting(
                '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" alt="x">',
                'html'
            );
            expect(out).not.toContain('text/html');
        });

        // Defense-in-depth: even when the browser sandbox of img-loaded
        // SVG is the load-bearing security boundary, the sanitizer
        // rejects payloads carrying script / event handlers / external
        // href so a future sandbox-weak surface (older WebView2, mobile,
        // export pipeline) still drops them at this layer.
        it('drops data:image/svg+xml with embedded <script>', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>\">",
                'html'
            );
            expect(out).not.toContain('alert');
            expect(out).not.toContain('script');
        });

        it('drops data:image/svg+xml with on* event handler', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>\">",
                'html'
            );
            expect(out).not.toContain('alert');
            expect(out).not.toContain('onload');
        });

        it('drops data:image/svg+xml with <foreignObject>', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><foreignObject><iframe src='https://attacker.example'/></foreignObject></svg>\">",
                'html'
            );
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('foreignObject');
        });

        it('drops data:image/svg+xml with external xlink:href on inner element', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image xlink:href='https://attacker.example/track.png'/></svg>\">",
                'html'
            );
            expect(out).not.toContain('attacker.example');
        });

        it('drops base64-encoded svg+xml carrying <script>', () => {
            // base64 of "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
            const b64 =
                'PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';
            const out = getSanitizedHtmlForTesting(
                `<img src="data:image/svg+xml;base64,${b64}">`,
                'html'
            );
            expect(out).not.toContain('alert');
            expect(out).not.toContain('script');
        });

        it('preserves data:image/svg+xml carrying inner href="#fragment" (safe)', () => {
            const out = getSanitizedHtmlForTesting(
                "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><use href='#icon'/></svg>\">",
                'html'
            );
            expect(out).toContain('data:image/svg+xml');
            expect(out).toContain("href='#icon'");
        });

        it('drops javascript: href', () => {
            const out = getSanitizedHtmlForTesting(
                '<a href="javascript:alert(1)">x</a>',
                'html'
            );
            expect(out).not.toContain('javascript:');
            expect(out).not.toContain('alert(1)');
        });
    });

    describe('getSanitizedCss direct', () => {
        it('preserves safe rule', () => {
            const out = getSanitizedCss('p { color: red; }');
            expect(out).toContain('color');
            expect(out).toContain('red');
        });

        it('drops dangerous declaration', () => {
            const out = getSanitizedCss(
                'p { background: url(https://evil); }'
            );
            expect(out).not.toContain('evil');
        });
    });

    describe('edge cases', () => {
        it('empty input returns empty', () => {
            expect(getSanitizedHtmlForTesting('', 'html')).toBe('');
        });

        it('plain text passes through', () => {
            const out = getSanitizedHtmlForTesting('<p>Hello</p>', 'html');
            expect(out).toContain('Hello');
        });
    });

    // Pairs with the format-pane `hyperlinks` toggle. When OFF
    // (production default), the sanitizer must not emit any href
    // attribute on <a> — the click handler already suppresses
    // navigation via preventDefault, but leaving href in the DOM
    // exposes a URL surface the MS AppSource scanner flags.
    describe('allowHyperlinks toggle', () => {
        describe('toggle OFF (default — fail-closed)', () => {
            it('strips href from HTML <a>', () => {
                const out = getSanitizedHtmlForTesting(
                    '<a href="https://example.com">link</a>',
                    'html'
                );
                expect(out).not.toContain('href=');
                expect(out).not.toContain('example.com');
                // The element itself survives so styling and text are
                // preserved — only the URL surface is removed.
                expect(out).toContain('link');
            });

            it('strips href from HTML <a> even with safe http scheme', () => {
                const out = getSanitizedHtmlForTesting(
                    '<a href="http://example.com">x</a>',
                    'html'
                );
                expect(out).not.toContain('href=');
            });

            it('strips xlink:href from SVG <a>', () => {
                const out = getSanitizedHtmlForTesting(
                    '<svg><a xlink:href="https://example.com"><text>x</text></a></svg>',
                    'html'
                );
                expect(out).not.toContain('xlink:href');
                expect(out).not.toContain('example.com');
            });

            it('strips href from SVG <a> (SVG2 unprefixed form)', () => {
                const out = getSanitizedHtmlForTesting(
                    '<svg><a href="https://example.com"><text>x</text></a></svg>',
                    'html'
                );
                expect(out).not.toContain('href=');
            });

            it('explicit { allowHyperlinks: false } matches default', () => {
                const out = getSanitizedHtmlForTesting(
                    '<a href="https://example.com">x</a>',
                    'html',
                    { allowHyperlinks: false }
                );
                expect(out).not.toContain('href=');
            });

            it('does NOT affect href on non-<a> SVG elements (paint-server, marker, animation, image)', () => {
                // These tags use href/xlink:href for SVG-internal
                // references (paint servers, markers, animation targets,
                // sandboxed images). They are governed by per-tag
                // allowedSchemesByTag — fragment-only or data: only —
                // and the user-facing hyperlinks toggle must not affect
                // them. Verify the toggle is scoped to <a>.
                const out = getSanitizedHtmlForTesting(
                    '<svg>' +
                        '<defs><pattern href="#g1"/><lineargradient href="#g2"/></defs>' +
                        '<image href="data:image/png;base64,iVBORw0KGgo="/>' +
                        '</svg>',
                    'html'
                );
                // Fragment refs survive on paint servers
                expect(out).toContain('#g1');
                expect(out).toContain('#g2');
                // data: URI survives on <image>
                expect(out).toContain('data:image/png');
            });
        });

        describe('toggle ON', () => {
            it('preserves http(s) href on HTML <a>', () => {
                const out = getSanitizedHtmlForTesting(
                    '<a href="https://example.com">x</a>',
                    'html',
                    { allowHyperlinks: true }
                );
                expect(out).toContain('href');
                expect(out).toContain('example.com');
            });

            it('preserves http(s) href on SVG <a>', () => {
                const out = getSanitizedHtmlForTesting(
                    '<svg><a href="https://example.com"><text>x</text></a></svg>',
                    'html',
                    { allowHyperlinks: true }
                );
                expect(out).toContain('example.com');
            });

            it('still drops javascript: href even with toggle ON', () => {
                // Toggle controls whether the attribute exists in the
                // DOM at all when populated — it does NOT relax the
                // scheme allowlist. Dangerous schemes remain rejected.
                const out = getSanitizedHtmlForTesting(
                    '<a href="javascript:alert(1)">x</a>',
                    'html',
                    { allowHyperlinks: true }
                );
                expect(out).not.toContain('javascript:');
                expect(out).not.toContain('alert(1)');
            });
        });
    });

    // Defense-in-depth coverage for the cert-scanner finding: prove
    // `href` is removed from every non-`<a>` element irrespective of
    // the format-pane `hyperlinks` toggle. The MS scanner appears to
    // flag any surviving `href` attribute on any element. Even if a
    // browser would treat `<div href="...">` as inert, the attribute
    // is still present in the serialized DOM and can trip static
    // analysis. The HTML per-tag allowlist and SVG default-deny gates
    // already enforce this — these tests pin the behavior so a future
    // allowlist edit can't silently re-introduce it.
    describe('href on non-<a> elements is always stripped (regardless of toggle)', () => {
        // Each fixture pairs an input with the element-content
        // substring expected to survive sanitization. The element
        // itself must remain — only the href attribute is dropped.
        const htmlFixtures: ReadonlyArray<readonly [string, string, string]> =
            [
                [
                    'div',
                    '<div href="https://evil.example">marker-div</div>',
                    'marker-div'
                ],
                [
                    'span',
                    '<span href="https://evil.example">marker-span</span>',
                    'marker-span'
                ],
                [
                    'p',
                    '<p href="https://evil.example">marker-p</p>',
                    'marker-p'
                ],
                [
                    'h1',
                    '<h1 href="https://evil.example">marker-h1</h1>',
                    'marker-h1'
                ],
                [
                    'li',
                    '<ul><li href="https://evil.example">marker-li</li></ul>',
                    'marker-li'
                ],
                [
                    'td',
                    '<table><tbody><tr><td href="https://evil.example">marker-td</td></tr></tbody></table>',
                    'marker-td'
                ],
                [
                    'code',
                    '<code href="https://evil.example">marker-code</code>',
                    'marker-code'
                ],
                [
                    'blockquote',
                    '<blockquote href="https://evil.example">marker-bq</blockquote>',
                    'marker-bq'
                ],
                [
                    'strong',
                    '<strong href="https://evil.example">marker-strong</strong>',
                    'marker-strong'
                ],
                [
                    'em',
                    '<em href="https://evil.example">marker-em</em>',
                    'marker-em'
                ],
                [
                    'img (no inner text — assert attribute removal only)',
                    '<img src="data:image/png;base64,iVBORw0KGgo=" href="https://evil.example" alt="marker-img">',
                    'marker-img'
                ]
            ] as const;

        const svgFixtures: ReadonlyArray<
            readonly [string, string, string | null]
        > = [
            [
                'circle',
                '<svg><circle cx="5" cy="5" r="5" href="https://evil.example"/></svg>',
                null
            ],
            [
                'rect',
                '<svg><rect width="10" height="10" href="https://evil.example"/></svg>',
                null
            ],
            [
                'path',
                '<svg><path d="M0,0L10,10" href="https://evil.example"/></svg>',
                null
            ],
            [
                'text',
                '<svg><text x="5" y="5" href="https://evil.example">marker-svg-text</text></svg>',
                'marker-svg-text'
            ],
            [
                'tspan',
                '<svg><text><tspan href="https://evil.example">marker-tspan</tspan></text></svg>',
                'marker-tspan'
            ],
            [
                'g',
                '<svg><g href="https://evil.example"><circle cx="5" cy="5" r="5"/></g></svg>',
                null
            ],
            [
                'ellipse',
                '<svg><ellipse cx="5" cy="5" rx="3" ry="2" href="https://evil.example"/></svg>',
                null
            ],
            [
                'line',
                '<svg><line x1="0" y1="0" x2="10" y2="10" href="https://evil.example"/></svg>',
                null
            ],
            [
                'polygon',
                '<svg><polygon points="0,0 5,5 0,5" href="https://evil.example"/></svg>',
                null
            ]
        ] as const;

        describe.each(htmlFixtures)(
            'HTML <%s> + href',
            (_tag, input, marker) => {
                it.each([
                    ['allowHyperlinks: false (default)', false],
                    ['allowHyperlinks: true', true]
                ])('drops href with %s', (_label, allow) => {
                    const out = getSanitizedHtmlForTesting(input, 'html', {
                        allowHyperlinks: allow as boolean
                    });
                    // `href=` rather than substring `href` — the MS cert
                    // scanner greps for attribute syntax, and the `=` rules
                    // out `hreflang` collisions if a future fixture mixes
                    // a sibling <a> with hreflang into the same payload.
                    expect(out).not.toContain('href=');
                    expect(out).not.toContain('evil.example');
                    expect(out).toContain(marker);
                });
            }
        );

        describe.each(svgFixtures)(
            'SVG <%s> + href',
            (_tag, input, marker) => {
                it.each([
                    ['allowHyperlinks: false (default)', false],
                    ['allowHyperlinks: true', true]
                ])('drops href with %s', (_label, allow) => {
                    const out = getSanitizedHtmlForTesting(input, 'html', {
                        allowHyperlinks: allow as boolean
                    });
                    // `href=` rather than substring `href` — the MS cert
                    // scanner greps for attribute syntax, and the `=` rules
                    // out `hreflang` collisions if a future fixture mixes
                    // a sibling <a> with hreflang into the same payload.
                    expect(out).not.toContain('href=');
                    expect(out).not.toContain('evil.example');
                    if (marker !== null) {
                        expect(out).toContain(marker);
                    }
                });
            }
        );

        // xlink:href on non-<a> SVG elements: same gate, separate
        // attribute. The SVG default-deny path covers both `href` and
        // `xlink:href` when there's no allowedSchemesByTag entry; pin
        // it for the legacy form too.
        describe.each([
            [
                'circle',
                '<svg><circle cx="5" cy="5" r="5" xlink:href="https://evil.example"/></svg>'
            ],
            [
                'rect',
                '<svg><rect width="10" height="10" xlink:href="https://evil.example"/></svg>'
            ],
            [
                'path',
                '<svg><path d="M0,0L10,10" xlink:href="https://evil.example"/></svg>'
            ],
            [
                'text',
                '<svg><text x="5" y="5" xlink:href="https://evil.example">marker</text></svg>'
            ],
            [
                'g',
                '<svg><g xlink:href="https://evil.example"><circle cx="5" cy="5" r="5"/></g></svg>'
            ]
        ])('SVG <%s> + xlink:href', (_tag, input) => {
            it.each([
                ['allowHyperlinks: false (default)', false],
                ['allowHyperlinks: true', true]
            ])('drops xlink:href with %s', (_label, allow) => {
                const out = getSanitizedHtmlForTesting(input, 'html', {
                    allowHyperlinks: allow as boolean
                });
                expect(out).not.toContain('xlink:href');
                expect(out).not.toContain('evil.example');
            });
        });

        // Explicit dataset-style assertion: the rendered DOM must
        // contain no `href=` substring at all when the input had href
        // only on non-<a> elements. This mirrors what a literal scan
        // (e.g., the MS cert tool's pattern matcher) would do.
        it('aggregated: no surviving href= in DOM when input scatters href across non-<a> elements', () => {
            const input = [
                '<div href="https://e1.example">a</div>',
                '<span href="https://e2.example">b</span>',
                '<p href="https://e3.example">c</p>',
                '<table><tbody><tr><td href="https://e4.example">d</td></tr></tbody></table>',
                '<svg><circle cx="5" cy="5" r="5" href="https://e5.example"/>',
                '<rect width="5" height="5" xlink:href="https://e6.example"/>',
                '<text x="5" y="5" href="https://e7.example">e</text></svg>'
            ].join('');
            const outOff = getSanitizedHtmlForTesting(input, 'html', {
                allowHyperlinks: false
            });
            const outOn = getSanitizedHtmlForTesting(input, 'html', {
                allowHyperlinks: true
            });
            for (const out of [outOff, outOn]) {
                expect(out).not.toContain('href=');
                for (let i = 1; i <= 7; i++) {
                    expect(out).not.toContain(`e${i}.example`);
                }
            }
        });
    });
});
