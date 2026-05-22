/**
 * Malicious payload corpus for the CSP regression harness and unit tests.
 *
 * This is the single source of truth for sanitization tests and the
 * "Worked examples" section of docs/sanitization-rules.md.
 *
 * HOW TO ADD A NEW PAYLOAD:
 * 1. Add an entry below with a stable `id`, plain-language `description`,
 *    the raw `input`, and the substring assertions in `expectedSanitized`.
 * 2. Set `category` to the PayloadCategory this fits under. The doc
 *    generator (scripts/generate-sanitization-docs.ts) groups entries by
 *    this field; comment headers are NOT used for grouping.
 * 3. Set `cspCategory` to the CSP directive most likely to fail if the
 *    sanitizer leaves a vulnerability (e.g. 'img-src' for image src
 *    payloads, 'style-src' for CSS payloads). Use 'none' for clean
 *    baseline payloads.
 * 4. Set `source` to the provenance: cert report, OWASP, GitHub issue,
 *    "baseline" for clean payloads, or "systematic coverage" for entries
 *    added to round out a category.
 * 5. Run `npm run test:integration` and `npm run docs:generate`.
 *
 * ID NAMING CONVENTION:
 *   <category-prefix>-<short-slug>
 *
 *   Examples:
 *     ms-cert-2026-04-content-url-data   (provenance-prefixed: MS cert report)
 *     css-url-background                 (category-prefixed: CSS url() per property)
 *     event-onclick                      (category-prefixed: event handlers)
 *     clean-plain-text                   (tier-prefixed: clean baseline)
 *
 *   IDs must be unique across MALICIOUS_PAYLOADS and CLEAN_PAYLOADS combined.
 *   Task 7's Playwright spec asserts uniqueness at load time — a duplicate
 *   fails CI immediately rather than silently shadowing.
 */

// Type-only import — keeps corpus.ts free of runtime deps that
// sanitize-pipeline pulls in (d3, postcss, jsdom). Re-exported via the
// optional `sanitizeOptions` field on `Payload` so the harness can opt
// individual payloads into toggle-on sanitization.
import type { SanitizeOptions } from '../../src/sanitize-pipeline';

export type CspCategory =
    | 'img-src'
    | 'style-src'
    | 'script-src'
    | 'connect-src'
    | 'font-src'
    | 'frame-src'
    | 'object-src'
    | 'default-src'
    | 'none';

/**
 * Grouping for the corpus. Used by the doc generator to group "Worked
 * examples" into sections, and by test filtering to run a subset.
 */
export type PayloadCategory =
    | 'ms-cert'                // 1. Microsoft cert report 2026-04 (the regressions)
    | 'css-url-per-property'   // 2. url() across CSS properties that accept it
    | 'css-url-scheme'         // 3. url() scheme variants (http, blob, javascript, ...)
    | 'data-uri-smuggling'     // 4. MIME-type smuggling in data: URIs
    | 'at-rule'                // 5. @import, @font-face, @namespace, @document
    | 'event-handler'          // 6. on* attributes
    | 'svg'                    // 7. SVG-specific vectors
    | 'html-element'           // 8. disallowed HTML elements
    | 'html-attribute'         // 9. disallowed HTML attributes
    | 'encoding'               // 10. encoding / obfuscation
    | 'owasp'                  // 11. OWASP XSS Filter Evasion Cheat Sheet
    | 'partial-survival'       // 12. mixed safe/unsafe declarations
    | 'clean-baseline'         //     legitimate content that must keep rendering
    | 'lorem'                  //     rich-text rendering fixtures (paragraphs,
                               //     headings, lists, nesting). Kept in a
                               //     separate array (test/fixtures/lorem.ts);
                               //     the sanitization doc generator never
                               //     iterates lorem entries. Reusing the
                               //     PayloadCategory union lets the UAT CSV
                               //     generator emit the same column shape
                               //     without forking the Payload interface.
    | 'hyperlinks';            //     hyperlinks-enabled UAT fixtures
                               //     (test/fixtures/hyperlinks.ts). Every
                               //     entry carries `sanitizeOptions:
                               //     { allowHyperlinks: true }` so the UAT
                               //     reviewer can visually verify the
                               //     toggle-on behavior — both that legitimate
                               //     http(s) hrefs survive AND that
                               //     scheme-allowlist rejection (javascript:,
                               //     mailto:, fragment, etc.) still fires
                               //     even when the toggle is enabled.

/**
 * Substring assertions for sanitized output. Shared between `Payload`
 * (CSP harness corpus) and `StylesheetScenario` (custom-stylesheet UAT
 * fixtures) so both surfaces use one shape.
 */
export interface SanitizationAssertion {
    /** Substrings that MUST appear in the sanitized output. */
    contains?: string[];
    /** Substrings that MUST NOT appear in the sanitized output. */
    notContains?: string[];
}

export interface Payload {
    /** Stable, unique identifier. See ID NAMING CONVENTION in the header. */
    id: string;
    /**
     * Plain-language description aimed at a Power BI report author — not a
     * security engineer. This string appears in the user-facing
     * docs/sanitization-rules.md "Worked examples" section.
     */
    description: string;
    /** Raw HTML payload exactly as it would arrive from a data field. */
    input: string;
    /**
     * Substring assertions against the sanitizer's output.
     *
     * - `contains`: substrings that MUST appear in the sanitized output
     *   (e.g. text content that must survive).
     * - `notContains`: substrings that MUST NOT appear (e.g. the dangerous
     *   parts that the sanitizer must have stripped).
     *
     * Both fields are optional. Omitting `notContains` means "no negative
     * assertions" — use this for clean baseline payloads where there is
     * nothing to strip.
     */
    expectedSanitized: SanitizationAssertion;
    /**
     * Grouping for docs and test filtering. See PayloadCategory.
     *
     * `'lorem'` is intentionally excluded — lorem rich-text fixtures
     * use the separate `LoremPayload` interface so a lorem entry can
     * never accidentally land in `MALICIOUS_PAYLOADS` /
     * `CLEAN_PAYLOADS`. The compile-time guard makes the cross-array
     * uniqueness check in csp-regression.spec.ts redundant for the
     * lorem-vs-corpus collision case.
     */
    category: Exclude<PayloadCategory, 'lorem'>;
    /**
     * CSP directive most likely to fire if the sanitizer leaks. Used to
     * triage harness failures — a violation on `img-src` while running a
     * payload labelled `script-src` points at a classification bug as
     * well as a sanitizer bug. Use 'none' for clean baseline payloads.
     */
    cspCategory: CspCategory;
    /** Provenance: cert report, OWASP, GitHub issue, "baseline", etc. */
    source: string;
    /**
     * Optional sanitizer options for this payload. Omitted = fail-closed
     * default (`{ allowHyperlinks: false }`), which mirrors the
     * production `hyperlinks` toggle default in `src/visual-constants.ts`
     * and matches what an AppSource reviewer running the visual in
     * default state will see.
     *
     * Set explicitly when a payload needs to exercise the toggle-on
     * path (e.g. asserting an `<a href="https://...">` survives sanitize
     * AND renders CSP-clean when hyperlinks are enabled). Without this
     * field, the harness has no way to exercise the toggle-on branch
     * end-to-end through the CSP sandbox.
     */
    sanitizeOptions?: SanitizeOptions;
}

/**
 * Lorem rich-text fixture — same shape as `Payload` but with the
 * `category` narrowed to literal `'lorem'`. Defining this as a
 * separate interface (rather than reusing `Payload`) makes the
 * compile-time guard meaningful: a `Payload[]` cannot contain a
 * lorem entry and vice-versa. Source: test/fixtures/lorem.ts.
 */
export interface LoremPayload extends Omit<Payload, 'category'> {
    category: 'lorem';
}

/**
 * Hyperlinks-enabled UAT fixture — same shape as `Payload` but with two
 * narrowings:
 *   - `category` narrowed to literal `'hyperlinks'` so a hyperlinks
 *     entry cannot accidentally land in another array (compile-time
 *     cross-array guard, same pattern as `LoremPayload`).
 *   - `sanitizeOptions` narrowed from optional to REQUIRED literal
 *     `{ allowHyperlinks: true }`. The whole point of this fixture set
 *     is to document the toggle-on rendering path; an entry that omits
 *     the field (or sets `allowHyperlinks: false`) is silently wrong and
 *     would emit toggle-off output into `hyperlinks.csv`. Narrowing at
 *     the interface catches this at compile time rather than letting it
 *     reach the runtime guard in test/hyperlinks-rendering.test.ts.
 *
 * Source: test/fixtures/hyperlinks.ts.
 */
export interface HyperlinksPayload
    extends Omit<Payload, 'category' | 'sanitizeOptions'> {
    category: 'hyperlinks';
    sanitizeOptions: { allowHyperlinks: true };
}

/**
 * Malicious payloads. The sanitizer MUST strip the dangerous parts (per
 * each entry's `notContains`) and the harness MUST observe zero CSP
 * violations, console errors, and outbound network requests when the
 * sanitized output is rendered.
 */
export const MALICIOUS_PAYLOADS: Payload[] = [
    // ─────────────────────────────────────────────────────────────────
    // Category 1: Microsoft cert report 2026-04 (the regressions)
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'ms-cert-2026-04-content-url-data',
        description:
            'Inline style with content:url() pointing at a non-image data URI. ' +
            'Browser attempts to fetch and triggers img-src CSP violation.',
        input: '<div style="content:url(data:1234***qwerty)">Hello</div>',
        expectedSanitized: {
            contains: ['Hello'],
            notContains: ['data:1234', 'content:url', 'content: url']
        },
        category: 'ms-cert',
        cspCategory: 'img-src',
        source: 'MS cert report 2026-04 (1200.1.3 finding)'
    },
    {
        id: 'ms-cert-2026-04-img-src-data',
        description:
            'Image element with non-image data URI in src attribute. ' +
            'Browser attempts to load and triggers img-src CSP violation.',
        input: '<img src="data:1234***qwerty" alt="x">',
        expectedSanitized: {
            notContains: ['data:1234']
        },
        category: 'ms-cert',
        cspCategory: 'img-src',
        source: 'MS cert report 2026-04 (1200.1.3 finding)'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 2: url() per CSS property
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'css-url-background',
        description: 'background property with external URL.',
        input: '<div style="background: url(https://attacker.example/x.png)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-background-image',
        description: 'background-image with external URL.',
        input: '<div style="background-image: url(https://attacker.example/x.png)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-cursor',
        description: 'cursor property with external URL.',
        input: '<div style="cursor: url(https://attacker.example/x.cur), auto">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-list-style-image',
        description: 'list-style-image with external URL.',
        input: '<ul style="list-style-image: url(https://attacker.example/x.png)"><li>x</li></ul>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-border-image',
        description: 'border-image with external URL.',
        input: '<div style="border-image: url(https://attacker.example/x.png) 30">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-mask',
        description: 'mask with external URL.',
        input: '<div style="mask: url(https://attacker.example/x.svg)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-mask-image',
        description: 'mask-image with external URL.',
        input: '<div style="mask-image: url(https://attacker.example/x.svg)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-webkit-mask',
        description: '-webkit-mask with external URL.',
        input: '<div style="-webkit-mask: url(https://attacker.example/x.svg)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-shape-outside',
        description: 'shape-outside with external URL.',
        input: '<div style="shape-outside: url(https://attacker.example/x.png)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-clip-path',
        description: 'clip-path with external URL.',
        input: '<div style="clip-path: url(https://attacker.example/x.svg#c)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-filter',
        description: 'filter with external URL.',
        input: '<div style="filter: url(https://attacker.example/x.svg#f)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-offset-path',
        description: 'offset-path with external URL.',
        input: '<div style="offset-path: url(https://attacker.example/x.svg#p)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 systematic coverage'
    },
    {
        id: 'css-url-custom-property',
        description: 'CSS custom property carrying url() that is referenced via var().',
        input:
            '<div style="--bg: url(https://attacker.example/x.png); background: var(--bg)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example', 'url('] },
        category: 'css-url-per-property',
        cspCategory: 'img-src',
        source: 'category-2 indirection attack'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 3: url() scheme variants
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'css-url-scheme-https',
        description: 'https url() in background.',
        input: '<div style="background: url(https://attacker.example/x.png)">x</div>',
        expectedSanitized: { notContains: ['https://attacker.example'] },
        category: 'css-url-scheme',
        cspCategory: 'img-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-http',
        description: 'http url() in background.',
        input: '<div style="background: url(http://attacker.example/x.png)">x</div>',
        // eslint-disable-next-line powerbi-visuals/no-http-string
        expectedSanitized: { notContains: ['http://attacker.example'] },
        category: 'css-url-scheme',
        cspCategory: 'img-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-protocol-relative',
        description: 'protocol-relative url() in background.',
        input: '<div style="background: url(//attacker.example/x.png)">x</div>',
        expectedSanitized: { notContains: ['attacker.example'] },
        category: 'css-url-scheme',
        cspCategory: 'img-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-relative',
        description: 'relative url() in background.',
        input: '<div style="background: url(/x.png)">x</div>',
        expectedSanitized: { notContains: ['url(/x'] },
        category: 'css-url-scheme',
        cspCategory: 'img-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-data-text-html',
        description: 'data:text/html in background.',
        input: '<div style="background: url(data:text/html,<script>alert(1)</script>)">x</div>',
        expectedSanitized: { notContains: ['data:text/html', '<script>'] },
        category: 'css-url-scheme',
        cspCategory: 'default-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-data-text-javascript',
        description: 'data:text/javascript in background.',
        input: '<div style="background: url(data:text/javascript,alert(1))">x</div>',
        expectedSanitized: { notContains: ['data:text/javascript', 'alert(1)'] },
        category: 'css-url-scheme',
        cspCategory: 'script-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-data-text-css',
        description: 'data:text/css in background.',
        input: '<div style="background: url(data:text/css,body{background:red})">x</div>',
        expectedSanitized: { notContains: ['data:text/css'] },
        category: 'css-url-scheme',
        cspCategory: 'style-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-data-font-woff',
        description: 'data:font/woff in @font-face — must be blocked because @font-face is dropped.',
        input: '<style>@font-face { font-family: x; src: url(data:font/woff,abc) }</style>',
        expectedSanitized: { notContains: ['@font-face', 'data:font'] },
        category: 'css-url-scheme',
        cspCategory: 'font-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-blob',
        description: 'blob: scheme in background.',
        input: '<div style="background: url(blob:https://attacker.example/x)">x</div>',
        expectedSanitized: { notContains: ['blob:'] },
        category: 'css-url-scheme',
        cspCategory: 'img-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-filesystem',
        description: 'filesystem: scheme in background.',
        input: '<div style="background: url(filesystem:https://attacker.example/persistent/x)">x</div>',
        expectedSanitized: { notContains: ['filesystem:'] },
        category: 'css-url-scheme',
        cspCategory: 'img-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-javascript',
        description: 'javascript: scheme in background url().',
        input: '<div style="background: url(javascript:alert(1))">x</div>',
        expectedSanitized: { notContains: ['javascript:'] },
        category: 'css-url-scheme',
        cspCategory: 'script-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-empty',
        description: 'Empty url().',
        input: '<div style="background: url()">x</div>',
        expectedSanitized: { notContains: ['background:'] },
        category: 'css-url-scheme',
        cspCategory: 'img-src',
        source: 'category-3 scheme coverage'
    },
    {
        id: 'css-url-scheme-whitespace',
        description: 'Whitespace-only url().',
        input: '<div style="background: url( )">x</div>',
        expectedSanitized: { notContains: ['background:'] },
        category: 'css-url-scheme',
        cspCategory: 'img-src',
        source: 'category-3 scheme coverage'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 4: Data URI MIME smuggling
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'data-uri-mime-mismatch-png-html',
        description: 'image/png declared but content is HTML.',
        input: '<img src="data:image/png,<html><body>hi</body></html>">',
        expectedSanitized: { notContains: ['<html>', '<body>'] },
        category: 'data-uri-smuggling',
        cspCategory: 'img-src',
        source: 'category-4 mime smuggling'
    },
    {
        id: 'data-uri-mime-whitespace',
        description: 'Whitespace inserted into MIME type to evade pattern match.',
        input: '<img src="data: image/png ,abc">',
        expectedSanitized: { notContains: ['data: image'] },
        category: 'data-uri-smuggling',
        cspCategory: 'img-src',
        source: 'category-4 mime smuggling'
    },
    {
        id: 'data-uri-mime-tab',
        description: 'Tab character inserted into MIME type.',
        input: '<img src="data:image/png\t,abc">',
        expectedSanitized: { notContains: ['data:image/png\t'] },
        category: 'data-uri-smuggling',
        cspCategory: 'img-src',
        source: 'category-4 mime smuggling'
    },
    {
        id: 'data-uri-mime-control-char',
        description: 'Control character (0x01) inserted into MIME type.',
        input: '<img src="data:image/png\u0001,abc">',
        expectedSanitized: { notContains: ['data:image/png\u0001'] },
        category: 'data-uri-smuggling',
        cspCategory: 'img-src',
        source: 'category-4 mime smuggling'
    },
    {
        id: 'data-uri-svg-script',
        description:
            'SVG data URI payload contains <script>. Browsers sandbox SVG ' +
            'in image-loading context but the sanitizer scans the decoded ' +
            'payload as defense-in-depth for sandbox-weak rendering surfaces ' +
            '(older WebView2, mobile, export pipelines).',
        input: "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>\">",
        expectedSanitized: {
            notContains: ['<script', 'alert(1)', 'data:image/svg+xml']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'script-src',
        source: 'Security review — svg+xml payload defense-in-depth'
    },
    {
        id: 'data-uri-svg-onload',
        description:
            'SVG data URI payload contains an on* event handler. Same ' +
            'defense-in-depth scan rejects the URI before it reaches the DOM.',
        input: "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>\">",
        expectedSanitized: {
            notContains: ['onload', 'alert(1)', 'data:image/svg+xml']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'script-src',
        source: 'Security review — svg+xml payload defense-in-depth'
    },
    {
        id: 'data-uri-svg-foreignobject',
        description:
            'SVG data URI payload contains a <foreignObject>. Even though ' +
            'image-context loading neuters foreignObject HTML in the browser, ' +
            'the sanitizer rejects it as defense-in-depth.',
        input: "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><foreignObject><iframe src='https://attacker.example'/></foreignObject></svg>\">",
        expectedSanitized: {
            notContains: ['foreignObject', 'attacker.example', 'data:image/svg+xml']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'frame-src',
        source: 'Security review — svg+xml payload defense-in-depth'
    },
    {
        id: 'data-uri-svg-inner-external-href',
        description:
            'SVG data URI payload contains an inner element with external ' +
            'xlink:href. Image-context sandbox blocks fetches but the ' +
            'sanitizer rejects the URI to keep external references out of ' +
            'sandbox-weak surfaces.',
        input: "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image xlink:href='https://attacker.example/track.png' width='10' height='10'/></svg>\">",
        expectedSanitized: {
            notContains: ['attacker.example', 'data:image/svg+xml']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'img-src',
        source: 'Security review — svg+xml payload defense-in-depth'
    },
    {
        id: 'data-uri-svg-base64-script',
        description:
            'Base64-encoded SVG data URI carrying a <script> tag. Verifies ' +
            'the payload scanner decodes base64 before pattern-matching, not ' +
            'just the ;utf8, form.',
        input:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=">',
        expectedSanitized: {
            notContains: ['data:image/svg+xml', 'PHN2Zy']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'script-src',
        source: 'Security review — svg+xml payload defense-in-depth (base64 path)'
    },
    {
        id: 'data-uri-svg-onclick-quote-adjacent',
        description:
            'SVG payload with an on* event handler placed adjacent to a ' +
            'closing attribute quote (no whitespace between). HTML5\'s lenient ' +
            'tokenizer treats the closing `"` as an attribute boundary and ' +
            'fires onclick — the boundary regex must match `"on...=` as well ' +
            'as `\\son...=` for sandbox-weak surfaces (security review).',
        input: '<img src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' id=\'x\'onclick=\'alert(1)\'/>">',
        expectedSanitized: {
            notContains: ['onclick', 'alert(1)', 'data:image/svg+xml']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'script-src',
        source: 'Security review — quote-adjacent event handler boundary'
    },
    {
        id: 'data-uri-svg-inner-data-text-html',
        description:
            'SVG payload with an inner element href pointing at a nested ' +
            'data:text/html URI. Even though the outer image-context sandbox ' +
            'blocks the inner fetch, the payload scanner now restricts inner ' +
            'data: hrefs to data:image/* MIME types — matching the outer ' +
            'allowlist so sandbox-weak surfaces also reject it (Security review).',
        input: '<img src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\'><image href=\'data:text/html,<script>alert(1)</script>\' width=\'10\' height=\'10\'/></svg>">',
        expectedSanitized: {
            notContains: ['data:text/html', '<script', 'alert(1)']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'script-src',
        source: 'Security review — inner href data: restricted to image/*'
    },
    {
        id: 'svg-funciri-data-foreignobject',
        description:
            'SVG funciri presentation attribute (filter) pointing at a ' +
            'data:image/svg+xml URI whose embedded payload contains ' +
            '<foreignObject>. The funciri scheme gate alone admits any ' +
            'data: URI; the new payload check runs the same ' +
            'image-data-URI safety predicate (isSafeImageDataUri) as the ' +
            'top-level src/href and CSS url() paths so sandbox-weak ' +
            'surfaces (older WebView2, mobile, export pipelines) still ' +
            'drop the embedded foreignObject (Security review).',
        input: '<svg><rect filter="url(data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\'><foreignObject><iframe src=\'https://attacker.example\'/></foreignObject></svg>)" width="10" height="10"/></svg>',
        expectedSanitized: {
            notContains: ['foreignObject', 'attacker.example']
        },
        category: 'svg',
        cspCategory: 'frame-src',
        source: 'Security review — funciri data: payload scan'
    },
    {
        id: 'svg-funciri-data-text-html',
        description:
            'SVG funciri pointing at data:text/html (a non-image MIME). ' +
            'Pre-fix, the funciri gate only checked scheme==data and ' +
            'admitted any subtype; now the MIME allowlist drops it before ' +
            'the inner <script> can ever be parsed by a sandbox-weak ' +
            'surface (security review).',
        input: '<svg><rect mask="url(data:text/html,<script>alert(1)</script>)" width="10" height="10"/></svg>',
        expectedSanitized: {
            notContains: ['data:text/html', '<script', 'alert(1)']
        },
        category: 'svg',
        cspCategory: 'script-src',
        source: 'Security review — funciri MIME allowlist'
    },
    {
        id: 'svg-funciri-multi-url-smuggle',
        description:
            'SMIL <animate values="..."> carrying TWO url() tokens — a ' +
            'safe data:image/png as the first keyframe and an external ' +
            'https://attacker as the second. The previous funciri gate ' +
            'used value.match() (non-global) so only the first token was ' +
            'validated; the smuggled second triggered a cross-origin ' +
            'fetch on every rendering surface (including the sandbox-weak ' +
            'targets the payload scan defends). Funciri now iterates every ' +
            'url() token and drops the attribute if any non-fragment, ' +
            'non-data scheme survives (security review).',
        input:
            '<svg><rect width="10" height="10" fill="red">' +
            '<animate attributeName="fill" ' +
            'values="url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z3I3rUAAAAASUVORK5CYII=);url(https://attacker.example/track)" ' +
            'dur="1s"/>' +
            '</rect></svg>',
        expectedSanitized: {
            notContains: ['attacker.example']
        },
        category: 'svg',
        cspCategory: 'default-src',
        source: 'Security review — funciri multi-url() iteration'
    },
    {
        id: 'data-uri-svg-nested-base64-script',
        description:
            'Outer data:image/svg+xml whose <image href> points at a ' +
            'nested data:image/svg+xml;base64 URI that base64-encodes ' +
            '`<svg><script>alert(1)</script></svg>`. The outer regex ' +
            'cannot see through the opaque base64 wrapper — the payload ' +
            'scan recursively decodes nested data:image/svg+xml inner ' +
            'hrefs (depth-capped at MAX_PAYLOAD_SCAN_DEPTH) so the inner ' +
            'script is exposed and the entire chain is rejected ' +
            '(security review).',
        // base64 of `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`
        input: '<img src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\'><image href=\'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=\' width=\'10\' height=\'10\'/></svg>">',
        expectedSanitized: {
            notContains: [
                'data:image/svg+xml',
                'PHN2Zy',
                '<script',
                'alert(1)'
            ]
        },
        category: 'data-uri-smuggling',
        cspCategory: 'script-src',
        source: 'Security review — recursive nested svg+xml payload scan'
    },
    {
        id: 'data-uri-svg-href-quote-adjacent',
        description:
            'SVG payload with an inner element href placed adjacent to a ' +
            'closing attribute quote (no whitespace between). HTML5\'s ' +
            'lenient tokenizer treats the closing `"` as an attribute ' +
            'boundary and would initiate the fetch — the boundary regex on ' +
            'the inner-href scan must match `"href=` and `\'href=` as well ' +
            'as `\\shref=` for sandbox-weak surfaces. Symmetric to the on* ' +
            'event-handler boundary fix (security review).',
        input: '<img src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\'><image id=\'x\'href=\'https://attacker.example/pixel\' width=\'10\' height=\'10\'/></svg>">',
        expectedSanitized: {
            notContains: ['attacker.example', 'data:image/svg+xml']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'img-src',
        source: 'Security review — quote-adjacent href boundary'
    },
    {
        id: 'data-uri-svg-malformed-percent-script',
        description:
            'SVG data URI whose percent-encoded payload carries `<script>` ' +
            'plus a trailing malformed `%GG` escape. Pre-fix, ' +
            '`decodeSvgDataUriPayload` caught the `decodeURIComponent` ' +
            'throw and returned the raw still-encoded string; the ' +
            '`/<script\\b/i` regex never saw through `%3Cscript%3E` and ' +
            'the URI passed sanitization, while a sandbox-weak surface ' +
            'would still decode and execute it. The decoder now ' +
            'fail-closes (returns null) on malformed percent-encoding, ' +
            'matching the symmetric base64-failure path (security review).',
        input:
            '<img src="data:image/svg+xml;utf8,' +
            '%3Csvg xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%3E' +
            '%3Cscript%3Ealert(1)%3C%2Fscript%3E' +
            '%3C%2Fsvg%3E%GG' +
            '">',
        expectedSanitized: {
            notContains: ['data:image/svg+xml', '%3Cscript', 'alert(1)']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'script-src',
        source: 'Security review — malformed percent-encoding fail-closed (script payload)'
    },
    {
        id: 'data-uri-svg-malformed-percent-onload',
        description:
            'Companion to data-uri-svg-malformed-percent-script with the ' +
            'attack vector swapped to an `onload=` event handler. Same ' +
            'bypass primitive (malformed `%XX` causes `decodeURIComponent` ' +
            'to throw; pre-fix the raw still-encoded string was scanned ' +
            'and the encoded `onload=` slipped past the boundary regex). ' +
            'Demonstrates the fix covers all the downstream regex checks ' +
            'in `hasDangerousSvgPayload`, not just `<script>` (security ' +
            'review).',
        input:
            '<img src="data:image/svg+xml;utf8,' +
            '%3Csvg xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27 ' +
            "onload%3D%27alert(1)%27%2F%3E%G" +
            '">',
        expectedSanitized: {
            notContains: ['data:image/svg+xml', 'onload', 'alert(1)']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'script-src',
        source: 'Security review — malformed percent-encoding fail-closed (event-handler payload)'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 5: At-rule vectors
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'at-rule-import-external',
        description: '@import with external URL.',
        input: '<style>@import url(https://attacker.example/x.css);</style>',
        expectedSanitized: { notContains: ['@import', 'attacker.example'] },
        category: 'at-rule',
        cspCategory: 'style-src',
        source: 'category-5 at-rule'
    },
    {
        id: 'at-rule-font-face-external',
        description: '@font-face with external src.',
        input: '<style>@font-face { font-family: x; src: url(https://attacker.example/x.woff); }</style>',
        expectedSanitized: { notContains: ['@font-face', 'attacker.example'] },
        category: 'at-rule',
        cspCategory: 'font-src',
        source: 'category-5 at-rule'
    },
    {
        id: 'at-rule-namespace',
        description: '@namespace with external URL.',
        input: '<style>@namespace url(https://attacker.example/);</style>',
        expectedSanitized: { notContains: ['@namespace', 'attacker.example'] },
        category: 'at-rule',
        cspCategory: 'style-src',
        source: 'category-5 at-rule'
    },
    {
        id: 'at-rule-document',
        description: '@document with external URL match.',
        input: '<style>@document url(https://attacker.example/) { body { color: red; } }</style>',
        expectedSanitized: { notContains: ['@document', 'attacker.example'] },
        category: 'at-rule',
        cspCategory: 'style-src',
        source: 'category-5 at-rule'
    },
    {
        id: 'at-rule-import-nested-in-media',
        description: '@import nested inside @media.',
        input: '<style>@media screen { @import url(https://attacker.example/x.css); }</style>',
        expectedSanitized: { notContains: ['@import', 'attacker.example'] },
        category: 'at-rule',
        cspCategory: 'style-src',
        source: 'category-5 at-rule'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 6: Event handler attributes
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'event-onclick',
        description: 'onclick handler.',
        input: '<div onclick="alert(1)">x</div>',
        expectedSanitized: { notContains: ['onclick'] },
        category: 'event-handler',
        cspCategory: 'script-src',
        source: 'category-6 event handler'
    },
    {
        id: 'event-onload',
        description: 'onload handler on img.',
        input: '<img src="data:image/png;base64,iVBORw0KGgo=" onload="alert(1)">',
        expectedSanitized: { notContains: ['onload', 'alert(1)'] },
        category: 'event-handler',
        cspCategory: 'script-src',
        source: 'category-6 event handler'
    },
    {
        id: 'event-onerror',
        description: 'onerror handler on img with bad src.',
        input: '<img src="x" onerror="alert(1)">',
        expectedSanitized: { notContains: ['onerror'] },
        category: 'event-handler',
        cspCategory: 'script-src',
        source: 'category-6 event handler'
    },
    {
        id: 'event-onmouseover',
        description: 'onmouseover handler.',
        input: '<div onmouseover="alert(1)">x</div>',
        expectedSanitized: { notContains: ['onmouseover'] },
        category: 'event-handler',
        cspCategory: 'script-src',
        source: 'category-6 event handler'
    },
    {
        id: 'event-onfocus',
        description: 'onfocus handler on input.',
        input: '<input onfocus="alert(1)" autofocus>',
        expectedSanitized: { notContains: ['onfocus'] },
        category: 'event-handler',
        cspCategory: 'script-src',
        source: 'category-6 event handler'
    },
    {
        id: 'event-onanimationstart',
        description: 'onanimationstart handler.',
        input: '<div onanimationstart="alert(1)">x</div>',
        expectedSanitized: { notContains: ['onanimationstart'] },
        category: 'event-handler',
        cspCategory: 'script-src',
        source: 'category-6 event handler'
    },
    {
        id: 'event-ontransitionend',
        description: 'ontransitionend handler.',
        input: '<div ontransitionend="alert(1)">x</div>',
        expectedSanitized: { notContains: ['ontransitionend'] },
        category: 'event-handler',
        cspCategory: 'script-src',
        source: 'category-6 event handler'
    },
    {
        id: 'event-mixed-case',
        description: 'OnClick mixed case.',
        input: '<div OnClick="alert(1)">x</div>',
        expectedSanitized: { notContains: ['OnClick', 'onclick'] },
        category: 'event-handler',
        cspCategory: 'script-src',
        source: 'category-6 event handler'
    },
    {
        id: 'event-svg-onbegin',
        description: 'onbegin on SVG animate.',
        input: '<svg><animate onbegin="alert(1)" attributeName="x" /></svg>',
        expectedSanitized: { notContains: ['onbegin'] },
        category: 'event-handler',
        cspCategory: 'script-src',
        source: 'category-6 svg event'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 7: SVG-specific
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'svg-script-child',
        description: 'script element inside svg.',
        input: '<svg><script>alert(1)</script></svg>',
        expectedSanitized: { notContains: ['<script>', 'alert(1)'] },
        category: 'svg',
        cspCategory: 'script-src',
        source: 'category-7 svg'
    },
    {
        id: 'svg-foreign-object-html',
        description: 'foreignObject containing HTML script.',
        input: '<svg><foreignObject><script>alert(1)</script></foreignObject></svg>',
        expectedSanitized: { notContains: ['<script>', 'alert(1)'] },
        category: 'svg',
        cspCategory: 'script-src',
        source: 'category-7 svg'
    },
    {
        id: 'svg-animate-javascript',
        description: 'animate with javascript: in to attribute.',
        input: '<svg><animate attributeName="href" to="javascript:alert(1)" /></svg>',
        expectedSanitized: { notContains: ['javascript:'] },
        category: 'svg',
        cspCategory: 'script-src',
        source: 'category-7 svg'
    },
    {
        id: 'svg-set-javascript',
        description:
            'set element with javascript: target via attributeName="href". ' +
            'The SMIL_ATTRIBUTE_NAME_DENYLIST drops the attributeName attribute, ' +
            'neutering the animation; the javascript: value is also rejected by ' +
            'the scriptingPatterns gate.',
        input: '<svg><set attributeName="href" to="javascript:alert(1)" /></svg>',
        expectedSanitized: {
            notContains: [
                'javascript:',
                'attributeName="href"',
                'attributeName=\'href\''
            ]
        },
        category: 'svg',
        cspCategory: 'script-src',
        source: 'category-7 svg'
    },
    {
        id: 'svg-animate-override-href',
        description:
            'SMIL animate attempting to override <image> href to an external URL ' +
            'at runtime. SMIL animation elements are allowed (issue #145) but ' +
            'attributeName="href" is on SMIL_ATTRIBUTE_NAME_DENYLIST, so the ' +
            'attributeName attribute is dropped — the animate element survives ' +
            'but has nothing to bind to and cannot rewrite the sanitized href.',
        input:
            '<svg><image href="data:image/png;base64,iVBORw0KGgo=">' +
            '<animate attributeName="href" to="https://attacker.example/track.png" begin="0s" dur="1ms" fill="freeze"/>' +
            '</image></svg>',
        expectedSanitized: {
            notContains: [
                'attributeName="href"',
                'attributeName=\'href\''
            ]
        },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P1 finding — SMIL animation cannot override sanitized URL attributes'
    },
    {
        id: 'svg-animate-override-style',
        description:
            'SMIL animate attempting to overwrite the entire inline style attribute ' +
            'at runtime. attributeName="style" is on the denylist because animating ' +
            'style replaces the whole declaration string, re-introducing url() ' +
            'declarations the static sanitizer never saw.',
        input:
            '<svg><rect width="10" height="10" style="fill: red">' +
            '<animate attributeName="style" to="background:url(javascript:alert(1))" dur="1s"/>' +
            '</rect></svg>',
        expectedSanitized: {
            notContains: [
                'javascript:',
                'attributeName="style"',
                'attributeName=\'style\''
            ]
        },
        category: 'svg',
        cspCategory: 'script-src',
        source: 'issue #145 SMIL bypass — bulk-attr style animation'
    },
    {
        id: 'svg-animate-external-xlink-href',
        description:
            'SMIL animate with an external xlink:href (referencing the element ' +
            'to animate). Per-tag scheme allowlist for SMIL tags is fragment-only, ' +
            'so external URLs are dropped at the URL gate.',
        input:
            '<svg><animate xlink:href="https://attacker.example/evil.svg" attributeName="opacity" from="0" to="1" dur="1s"/></svg>',
        expectedSanitized: {
            notContains: ['attacker.example', 'xlink:href="https']
        },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'issue #145 SMIL bypass — external href on SMIL element'
    },
    {
        id: 'svg-animate-to-javascript-value',
        description:
            'SMIL animate where attributeName names a SAFE presentation ' +
            'property (fill) but the `to` value carries a `javascript:` ' +
            'scheme. Once attributeName clears SMIL_ATTRIBUTE_NAME_DENYLIST, ' +
            'the value-side gate is the scriptingPatterns substring scan — ' +
            'this row pins that contract so a future weakening of ' +
            'scriptingPatterns is caught (security review).',
        input:
            '<svg><rect width="10" height="10" fill="red">' +
            '<animate attributeName="fill" to="javascript:alert(1)" dur="1s"/>' +
            '</rect></svg>',
        expectedSanitized: {
            notContains: ['javascript:', 'alert(1)']
        },
        category: 'svg',
        cspCategory: 'script-src',
        source: 'Security review — SMIL value-side gate (scriptingPatterns)'
    },
    {
        id: 'svg-use-javascript',
        description: 'use with javascript: xlink:href.',
        input: '<svg><use xlink:href="javascript:alert(1)" /></svg>',
        expectedSanitized: { notContains: ['javascript:'] },
        category: 'svg',
        cspCategory: 'script-src',
        source: 'category-7 svg'
    },
    {
        id: 'svg-use-data-svg-xml',
        description: 'use with data:image/svg+xml xlink:href.',
        input: '<svg><use xlink:href="data:image/svg+xml,<svg/>" /></svg>',
        expectedSanitized: { notContains: ['data:image/svg+xml'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'category-7 svg'
    },
    {
        id: 'svg-image-external-href',
        description:
            'SVG image element with external href. Same restriction as HTML img: ' +
            'only data: URIs permitted, no external resource loading.',
        input: '<svg><image href="https://attacker.example/track.png" /></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P1 finding — allowedSchemesByTag missing SVG image'
    },
    {
        id: 'svg-image-external-xlink-href',
        description:
            'SVG image element with external xlink:href (legacy syntax). ' +
            'Must be blocked just like href.',
        input: '<svg><image xlink:href="https://attacker.example/track.png" /></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P1 finding — allowedSchemesByTag missing SVG image'
    },
    {
        id: 'svg-textpath-external-href',
        description:
            'SVG textPath with external href. textPath should only reference ' +
            'same-document fragment IDs (#path), not external URLs.',
        input: '<svg><text><textPath href="https://attacker.example/path.svg#p">label</textPath></text></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'default-src',
        source: 'code review P1 finding — allowedSchemesByTag missing SVG textpath'
    },
    {
        id: 'svg-marker-external-href',
        description:
            'SVG2 <marker href> can reference another marker by fragment ID; ' +
            'external URLs must be dropped. Per-tag URL gate enforces ' +
            'fragment-only via allowedSchemesByTag.',
        input: '<svg><marker id="m" href="https://attacker.example/m.svg" viewBox="0 0 10 10"/></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'default-src',
        source: 'Security review — marker fragment-only allowedSchemesByTag'
    },
    {
        id: 'svg-symbol-external-href',
        description:
            'SVG2 <symbol href> can reference another symbol by fragment ID; ' +
            'external URLs must be dropped. Per-tag URL gate enforces ' +
            'fragment-only via allowedSchemesByTag.',
        input: '<svg><symbol id="s" href="https://attacker.example/s.svg" viewBox="0 0 10 10"/></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'default-src',
        source: 'Security review — symbol fragment-only allowedSchemesByTag'
    },
    {
        id: 'svg-feimage-external-href',
        description:
            'SVG feImage filter primitive with external href. Same restriction as ' +
            '<image>: only data: URIs are permitted, no external resource loading.',
        input: '<svg><filter id="f"><feImage href="https://attacker.example/x.png"/></filter></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P0 finding — denylist switch + missing feimage scheme entry'
    },
    {
        id: 'svg-pattern-external-href',
        description:
            'SVG pattern element with external href. Patterns should only ' +
            'reference same-document fragment IDs, not external URLs.',
        input: '<svg><defs><pattern id="p" href="https://attacker.example/x.svg"><rect width="10" height="10"/></pattern></defs></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P0 finding — denylist switch + missing pattern scheme entry'
    },
    {
        id: 'svg-lineargradient-external-href',
        description:
            'SVG linearGradient with external href. Gradients should only ' +
            'reference same-document fragment IDs, not external URLs.',
        input: '<svg><defs><linearGradient id="g" href="https://attacker.example/x.svg"><stop offset="0%" stop-color="red"/></linearGradient></defs></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P0 finding — denylist switch + missing lineargradient scheme entry'
    },
    {
        id: 'svg-radialgradient-external-href',
        description:
            'SVG radialGradient with external href. Gradients should only ' +
            'reference same-document fragment IDs, not external URLs.',
        input: '<svg><defs><radialGradient id="g" href="https://attacker.example/x.svg"><stop offset="0%" stop-color="red"/></radialGradient></defs></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P0 finding — denylist switch + missing radialgradient scheme entry'
    },
    {
        id: 'svg-filter-external-href',
        description:
            'SVG filter element with external href. Filters should only ' +
            'reference same-document fragment IDs, not external URLs.',
        input: '<svg><filter id="f" href="https://attacker.example/x.svg"><feGaussianBlur stdDeviation="2"/></filter></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P0 finding — denylist switch + missing filter scheme entry'
    },
    {
        id: 'svg-funciri-mask-external',
        description:
            'SVG mask attribute carrying url(https://...). Funciri values on ' +
            'SVG presentation attributes must be scheme-checked, not just the ' +
            'src/href/xlink:href attribute names.',
        input: '<svg><rect mask="url(https://attacker.example/m.svg)" width="10" height="10"/></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P1 finding — funciri value scheme not enforced'
    },
    {
        id: 'svg-funciri-clip-path-external',
        description:
            'SVG clip-path attribute carrying url(https://...). Same funciri ' +
            'concern as mask.',
        input: '<svg><rect clip-path="url(https://attacker.example/c.svg)" width="10" height="10"/></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P1 finding — funciri value scheme not enforced'
    },
    {
        id: 'svg-funciri-filter-external',
        description:
            'SVG filter attribute carrying url(https://...). Same funciri ' +
            'concern as mask and clip-path.',
        input: '<svg><rect filter="url(https://attacker.example/f.svg)" width="10" height="10"/></svg>',
        expectedSanitized: { notContains: ['attacker.example', 'https://'] },
        category: 'svg',
        cspCategory: 'img-src',
        source: 'code review P1 finding — funciri value scheme not enforced'
    },
    {
        id: 'svg-href-on-non-anchor-circle',
        description:
            'href on an SVG <circle> — only SVG <a> (and a small set of ' +
            'internal-reference tags like pattern/gradient/marker/symbol/' +
            'textpath/image/feimage/animate) may carry href / xlink:href. ' +
            'Shape elements default-deny URL attributes via the SVG ' +
            'allowedSchemesByTag gate. Holds regardless of the format-pane ' +
            'hyperlinks toggle — that toggle is scoped to <a>; non-<a> ' +
            'SVG elements are governed by the per-tag scheme allowlist.',
        input: '<svg><circle cx="5" cy="5" r="5" href="https://attacker.example"/></svg>',
        expectedSanitized: {
            notContains: ['href=', 'attacker.example']
        },
        category: 'svg',
        cspCategory: 'connect-src',
        source: 'MS cert report 2026-05 — href on non-anchor (defense-in-depth coverage)'
    },
    {
        id: 'svg-xlink-href-on-non-anchor-rect',
        description:
            'Legacy SVG 1.1 xlink:href form on an SVG <rect>. Same gate ' +
            'as svg-href-on-non-anchor-circle — default-deny because ' +
            '<rect> is not in allowedSchemesByTag. Toggle-state ' +
            'independent.',
        input: '<svg><rect width="10" height="10" xlink:href="https://attacker.example"/></svg>',
        expectedSanitized: {
            notContains: ['xlink:href', 'attacker.example']
        },
        category: 'svg',
        cspCategory: 'connect-src',
        source: 'MS cert report 2026-05 — href on non-anchor (defense-in-depth coverage)'
    },
    {
        id: 'svg-href-on-non-anchor-text',
        description:
            'href on an SVG <text>. Same default-deny path as ' +
            '<circle>/<rect>. Toggle-state independent.',
        input: '<svg><text x="5" y="5" href="https://attacker.example">marker</text></svg>',
        expectedSanitized: {
            contains: ['marker'],
            notContains: ['href=', 'attacker.example']
        },
        category: 'svg',
        cspCategory: 'connect-src',
        source: 'MS cert report 2026-05 — href on non-anchor (defense-in-depth coverage)'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 8: HTML-level disallowed elements
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'html-iframe',
        description: 'iframe element.',
        input: '<iframe src="https://attacker.example"></iframe>',
        expectedSanitized: { notContains: ['<iframe', 'attacker.example'] },
        category: 'html-element',
        cspCategory: 'frame-src',
        source: 'category-8 html'
    },
    {
        id: 'html-object',
        description: 'object element with data attribute.',
        input: '<object data="https://attacker.example/x.swf"></object>',
        expectedSanitized: { notContains: ['<object', 'attacker.example'] },
        category: 'html-element',
        cspCategory: 'object-src',
        source: 'category-8 html'
    },
    {
        id: 'html-embed',
        description: 'embed element.',
        input: '<embed src="https://attacker.example/x.swf">',
        expectedSanitized: { notContains: ['<embed', 'attacker.example'] },
        category: 'html-element',
        cspCategory: 'object-src',
        source: 'category-8 html'
    },
    {
        id: 'html-meta-refresh',
        description: 'meta http-equiv refresh.',
        input: '<meta http-equiv="refresh" content="0;url=https://attacker.example">',
        expectedSanitized: { notContains: ['<meta', 'http-equiv', 'attacker.example'] },
        category: 'html-element',
        cspCategory: 'default-src',
        source: 'category-8 html'
    },
    {
        id: 'html-base-javascript',
        description: 'base href with javascript:.',
        input: '<base href="javascript:alert(1)//">',
        expectedSanitized: { notContains: ['<base', 'javascript:'] },
        category: 'html-element',
        cspCategory: 'script-src',
        source: 'category-8 html'
    },
    {
        id: 'html-form-formaction',
        description: 'form with formaction.',
        input: '<form><button formaction="javascript:alert(1)">go</button></form>',
        expectedSanitized: { notContains: ['formaction', 'javascript:'] },
        category: 'html-element',
        cspCategory: 'script-src',
        source: 'category-8 html'
    },
    {
        id: 'html-link-stylesheet',
        description: 'link rel=stylesheet pointing externally.',
        input: '<link rel="stylesheet" href="https://attacker.example/x.css">',
        expectedSanitized: { notContains: ['<link', 'attacker.example'] },
        category: 'html-element',
        cspCategory: 'style-src',
        source: 'category-8 html'
    },
    {
        id: 'html-link-import',
        description: 'link rel=import.',
        input: '<link rel="import" href="https://attacker.example/x.html">',
        expectedSanitized: { notContains: ['<link', 'attacker.example'] },
        category: 'html-element',
        cspCategory: 'default-src',
        source: 'category-8 html'
    },
    {
        id: 'html-input-image-javascript',
        description: 'input type=image with javascript: src.',
        input: '<input type="image" src="javascript:alert(1)">',
        expectedSanitized: { notContains: ['javascript:'] },
        category: 'html-element',
        cspCategory: 'script-src',
        source: 'category-8 html'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 9: Disallowed attributes
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'attr-srcdoc',
        description: 'iframe srcdoc (executes as document) — also iframe is dropped.',
        input: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
        expectedSanitized: { notContains: ['srcdoc', '<script>'] },
        category: 'html-attribute',
        cspCategory: 'script-src',
        source: 'category-9 attribute'
    },
    {
        id: 'attr-formaction-on-button',
        description: 'formaction attribute on a button.',
        input: '<button formaction="https://attacker.example">go</button>',
        expectedSanitized: { notContains: ['formaction', 'attacker.example'] },
        category: 'html-attribute',
        cspCategory: 'default-src',
        source: 'category-9 attribute'
    },
    {
        id: 'attr-ping-on-anchor',
        description: 'ping attribute on a tag.',
        input: '<a href="https://example.com" ping="https://attacker.example">x</a>',
        expectedSanitized: { notContains: ['ping=', 'attacker.example'] },
        category: 'html-attribute',
        cspCategory: 'connect-src',
        source: 'category-9 attribute'
    },
    {
        id: 'attr-background-on-body',
        description: 'background attribute on body (legacy).',
        input: '<body background="https://attacker.example/x.png"></body>',
        expectedSanitized: { notContains: ['background=', 'attacker.example'] },
        category: 'html-attribute',
        cspCategory: 'img-src',
        source: 'category-9 attribute'
    },
    {
        id: 'attr-srcset',
        description: 'srcset on img — explicitly dropped per spec section 3.',
        input: '<img src="data:image/png;base64,iVBORw0KGgo=" srcset="https://attacker.example/x.png 2x">',
        expectedSanitized: { notContains: ['srcset'] },
        category: 'html-attribute',
        cspCategory: 'img-src',
        source: 'category-9 attribute'
    },
    {
        id: 'attr-href-on-div',
        description:
            'href on a <div> — only <a> carries href in HTML. The per-tag ' +
            'allowlist drops the attribute regardless of the format-pane ' +
            'hyperlinks toggle (the toggle is scoped to <a>; every other ' +
            'tag is governed by its own attribute allowlist).',
        input: '<div href="https://attacker.example">marker</div>',
        expectedSanitized: {
            contains: ['marker'],
            notContains: ['href=', 'attacker.example']
        },
        category: 'html-attribute',
        cspCategory: 'connect-src',
        source: 'MS cert report 2026-05 — href on non-anchor (defense-in-depth coverage)'
    },
    {
        id: 'attr-href-on-span',
        description:
            'href on a <span>. Same per-tag-allowlist gate as <div>. ' +
            'Toggle-state independent.',
        input: '<span href="https://attacker.example">marker</span>',
        expectedSanitized: {
            contains: ['marker'],
            notContains: ['href=', 'attacker.example']
        },
        category: 'html-attribute',
        cspCategory: 'connect-src',
        source: 'MS cert report 2026-05 — href on non-anchor (defense-in-depth coverage)'
    },
    {
        id: 'attr-href-on-img',
        description:
            'href on an <img>. <img> has its own per-tag allowlist ' +
            '(src/alt/width/height/loading/decoding); href is not in it ' +
            'so the attribute is dropped. The data: src is preserved as ' +
            'the legitimate image surface. Toggle-state independent.',
        input: '<img src="data:image/png;base64,iVBORw0KGgo=" href="https://attacker.example" alt="marker">',
        expectedSanitized: {
            contains: ['marker', 'data:image/png'],
            notContains: ['href=', 'attacker.example']
        },
        category: 'html-attribute',
        cspCategory: 'connect-src',
        source: 'MS cert report 2026-05 — href on non-anchor (defense-in-depth coverage)'
    },
    {
        id: 'attr-href-on-table-td',
        description:
            'href on a <td>. Common author mistake (treating cells as ' +
            'links via href instead of nesting an <a>). Per-tag allowlist ' +
            'drops it; toggle-state independent.',
        input: '<table><tbody><tr><td href="https://attacker.example">marker</td></tr></tbody></table>',
        expectedSanitized: {
            contains: ['marker'],
            notContains: ['href=', 'attacker.example']
        },
        category: 'html-attribute',
        cspCategory: 'connect-src',
        source: 'MS cert report 2026-05 — href on non-anchor (defense-in-depth coverage)'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 10: Encoding / obfuscation
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'enc-html-entity-javascript',
        description: 'HTML entity encoding of javascript:.',
        input: '<a href="&#x6A;avascript:alert(1)">x</a>',
        expectedSanitized: { notContains: ['javascript:'] },
        category: 'encoding',
        cspCategory: 'script-src',
        source: 'category-10 encoding'
    },
    {
        id: 'enc-mixed-case',
        description: 'Mixed case JaVaScRiPt:.',
        input: '<a href="JaVaScRiPt:alert(1)">x</a>',
        expectedSanitized: { notContains: ['avaScRiPt', 'javascript:'] },
        category: 'encoding',
        cspCategory: 'script-src',
        source: 'category-10 encoding'
    },
    {
        id: 'enc-tab-in-scheme',
        description: 'Tab inserted into javascript scheme.',
        input: '<a href="java\tscript:alert(1)">x</a>',
        expectedSanitized: { notContains: ['java\tscript:'] },
        category: 'encoding',
        cspCategory: 'script-src',
        source: 'category-10 encoding'
    },
    {
        id: 'enc-newline-in-scheme',
        description: 'Newline inserted into javascript scheme.',
        input: '<a href="java\nscript:alert(1)">x</a>',
        expectedSanitized: { notContains: ['java\nscript:'] },
        category: 'encoding',
        cspCategory: 'script-src',
        source: 'category-10 encoding'
    },
    {
        id: 'enc-leading-whitespace',
        description: 'Leading whitespace before scheme.',
        input: '<a href="   javascript:alert(1)">x</a>',
        expectedSanitized: { notContains: ['javascript:'] },
        category: 'encoding',
        cspCategory: 'script-src',
        source: 'category-10 encoding'
    },
    {
        id: 'enc-null-byte',
        description: 'Null byte in scheme.',
        input: '<a href="java\u0000script:alert(1)">x</a>',
        expectedSanitized: { notContains: ['script:'] },
        category: 'encoding',
        cspCategory: 'script-src',
        source: 'category-10 encoding'
    },
    {
        id: 'enc-fullwidth',
        description: 'Fullwidth Unicode javascript.',
        input: '<a href="\uff4aavascript:alert(1)">x</a>',
        expectedSanitized: { notContains: ['avascript:'] },
        category: 'encoding',
        cspCategory: 'script-src',
        source: 'category-10 encoding'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 11: OWASP XSS Filter Evasion Cheat Sheet
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'owasp-script-img-onerror',
        description: 'OWASP: img with onerror.',
        input: '<IMG SRC=x onerror="alert(\'XSS\')">',
        expectedSanitized: { notContains: ['onerror'] },
        category: 'owasp',
        cspCategory: 'script-src',
        source: 'OWASP XSS Filter Evasion'
    },
    {
        id: 'owasp-script-img-javascript-href',
        description: 'OWASP: image with javascript: href via dynsrc.',
        input: '<IMG DYNSRC="javascript:alert(\'XSS\')">',
        expectedSanitized: { notContains: ['DYNSRC', 'dynsrc', 'javascript:'] },
        category: 'owasp',
        cspCategory: 'script-src',
        source: 'OWASP XSS Filter Evasion'
    },
    {
        id: 'owasp-bgsound',
        description: 'OWASP: BGSOUND element.',
        input: '<BGSOUND SRC="javascript:alert(\'XSS\')">',
        expectedSanitized: { notContains: ['BGSOUND', 'bgsound', 'javascript:'] },
        category: 'owasp',
        cspCategory: 'script-src',
        source: 'OWASP XSS Filter Evasion'
    },
    {
        id: 'owasp-svg-onload',
        description: 'OWASP: svg onload.',
        input: '<svg onload="alert(1)">',
        expectedSanitized: { notContains: ['onload', 'alert(1)'] },
        category: 'owasp',
        cspCategory: 'script-src',
        source: 'OWASP XSS Filter Evasion'
    },
    {
        id: 'owasp-marquee',
        description: 'OWASP: marquee with onstart.',
        input: '<marquee onstart="alert(1)">x</marquee>',
        expectedSanitized: { notContains: ['onstart'] },
        category: 'owasp',
        cspCategory: 'script-src',
        source: 'OWASP XSS Filter Evasion'
    },
    {
        id: 'owasp-style-expression',
        description: 'OWASP: style expression() (legacy IE).',
        input: '<div style="width: expression(alert(1))">x</div>',
        expectedSanitized: { notContains: ['expression('] },
        category: 'owasp',
        cspCategory: 'script-src',
        source: 'OWASP XSS Filter Evasion'
    },
    {
        id: 'owasp-meta-charset',
        description: 'OWASP: meta charset utf-7 attack.',
        input: '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-7">',
        expectedSanitized: { notContains: ['<META', '<meta'] },
        category: 'owasp',
        cspCategory: 'default-src',
        source: 'OWASP XSS Filter Evasion'
    },
    {
        id: 'owasp-isindex',
        description: 'OWASP: ISINDEX action.',
        input: '<ISINDEX TYPE=IMAGE SRC="javascript:alert(\'XSS\')">',
        expectedSanitized: { notContains: ['ISINDEX', 'isindex'] },
        category: 'owasp',
        cspCategory: 'script-src',
        source: 'OWASP XSS Filter Evasion'
    },
    // ─────────────────────────────────────────────────────────────────
    // Code-review findings (added post-review to lock in the bypasses
    // the adversarial and security reviewers identified)
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'review-css-url-data-image-no-base64',
        description:
            'CSS url() with a safe image MIME type but no base64 encoding — ' +
            'the content is plain-text HTML smuggled behind an image/png declaration.',
        input: '<div style="background: url(data:image/png,<svg/onload=alert(1)>)">x</div>',
        expectedSanitized: {
            contains: ['x'],
            notContains: ['data:image/png', 'alert', 'onload', 'background']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'img-src',
        source: 'code review P0 finding — isSafeImageDataUri missing base64 check'
    },
    {
        id: 'review-img-src-external-https',
        description:
            'Image element with an external HTTPS URL. The Power BI sandbox ' +
            'does not allow visuals to load external resources; only data: URIs ' +
            'are permitted for img src.',
        input: '<img src="https://attacker.example/tracking.png" alt="x">',
        expectedSanitized: {
            notContains: ['attacker.example', 'https://']
        },
        category: 'html-attribute',
        cspCategory: 'img-src',
        source: 'code review P1 finding — allowedSchemesByTag not enforced'
    },
    {
        id: 'review-data-uri-no-mime',
        description:
            'Data URI with no MIME type (data:,payload). RFC 2397 defaults to ' +
            'text/plain, which is not on the image allowlist.',
        input: '<img src="data:,<script>alert(1)</script>" alt="x">',
        expectedSanitized: {
            notContains: ['data:,', 'alert', '<script>']
        },
        category: 'data-uri-smuggling',
        cspCategory: 'img-src',
        source: 'code review P1 finding — getSanitizedDataUri null mimeMatch'
    },
    {
        id: 'review-unclosed-style-tag',
        description:
            'Unclosed <style> tag. The preprocessStyleTags regex requires a ' +
            'closing </style> to match; if absent, the raw CSS body would bypass ' +
            'postcss sanitization without the uponSanitizeElement backstop.',
        input: '<style>@import url(https://attacker.example/evil.css)</style>',
        expectedSanitized: {
            notContains: ['@import', 'attacker.example']
        },
        category: 'at-rule',
        cspCategory: 'style-src',
        source: 'code review P1 finding — preprocessStyleTags regex bypass + backstop'
    },
    // ─────────────────────────────────────────────────────────────────
    // Category 12: Partial-survival cases (declaration drop, not whole-style drop)
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'partial-color-survives-bad-background',
        description:
            'Style with safe color and unsafe background — color survives, background dropped.',
        input: '<div style="color: red; background: url(https://attacker.example/x.png)">x</div>',
        expectedSanitized: {
            // postcss normalizes whitespace around the colon, so the
            // sanitized output is 'color:red' rather than 'color: red'.
            contains: ['color:red'],
            notContains: ['attacker.example', 'background']
        },
        category: 'partial-survival',
        cspCategory: 'img-src',
        source: 'category-12 partial survival'
    },
    {
        id: 'partial-multiple-declarations',
        description: 'Multiple safe declarations and one unsafe — only the unsafe one drops.',
        input:
            '<div style="font-size: 14px; color: blue; cursor: url(https://attacker.example/c.cur), auto; padding: 4px">x</div>',
        expectedSanitized: {
            // postcss normalizes whitespace around the colon, so the
            // sanitized output collapses to 'font-size:14px' etc.
            contains: ['font-size:14px', 'color:blue', 'padding:4px'],
            notContains: ['attacker.example', 'cursor']
        },
        category: 'partial-survival',
        cspCategory: 'img-src',
        source: 'category-12 partial survival'
    },
    // ─────────────────────────────────────────────────────────────────
    // Toggle-on coverage: prove the malicious-href schemes are still
    // rejected when the format-pane `hyperlinks` toggle is ON. These
    // entries opt in to `allowHyperlinks: true` so the harness exercises
    // the toggle-on branch end-to-end through the CSP sandbox —
    // complementing the unit-test coverage in
    // test/sanitize-pipeline.test.ts. Without these, the entire
    // regression suite ran toggle-off and a future scheme-allowlist
    // regression in the toggle-on path would be invisible to CI.
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'attr-href-javascript-toggle-on',
        description:
            'javascript: scheme href on <a> with hyperlinks toggle enabled — must still drop. ' +
            'The toggle governs whether href is allowed to populate; the per-tag scheme allowlist ' +
            '(http/https only) governs which schemes survive. Both gates fire even when the toggle is on.',
        input: '<a href="javascript:alert(1)">x</a>',
        expectedSanitized: {
            notContains: ['javascript:', 'alert(1)']
        },
        category: 'html-attribute',
        cspCategory: 'script-src',
        source: 'MS cert report 2026-05 — href on non-anchor (toggle-on coverage)',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'svg-href-javascript-toggle-on',
        description:
            'javascript: scheme href on SVG <a> with hyperlinks toggle enabled — must still drop. ' +
            'Same per-tag scheme allowlist as the HTML <a> case.',
        input: '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
        expectedSanitized: {
            notContains: ['javascript:', 'alert(1)']
        },
        category: 'svg',
        cspCategory: 'script-src',
        source: 'MS cert report 2026-05 — href on non-anchor (toggle-on coverage)',
        sanitizeOptions: { allowHyperlinks: true }
    }
];

/**
 * Legitimate "clean" payloads that must continue to render with zero
 * violations after sanitization. Used as the baseline test tier to catch
 * over-tightening that breaks real-world report content.
 */
export const CLEAN_PAYLOADS: Payload[] = [
    {
        id: 'clean-plain-text',
        description:
            'A simple paragraph of text wrapped in a <p> tag. The most common ' +
            'real-world case — must render unchanged.',
        input: '<p>Hello, world.</p>',
        expectedSanitized: {
            contains: ['Hello, world.']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-basic-formatting',
        description:
            'Basic inline text formatting (bold, italic, underline). Standard ' +
            'rich-text output from a report author.',
        input: '<p><strong>Bold</strong> <em>italic</em> <u>under</u></p>',
        expectedSanitized: {
            contains: ['<strong>Bold</strong>', '<em>italic</em>']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-image-data-uri',
        description:
            'An image embedded as a base64 PNG data URI — the recommended way ' +
            'to include images in a sanitized visual.',
        input:
            '<img src="data:image/png;base64,' +
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z3I3rUAAAAASUVORK5CYII=" ' +
            'alt="dot">',
        expectedSanitized: {
            contains: ['data:image/png']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-color-style',
        description:
            'An inline style attribute using only safe properties (color and ' +
            'font-weight) with no external resource references. Sanitizer ' +
            'preserves both declarations verbatim. UAT visual expectation: ' +
            'when no Custom stylesheet is supplied, the issue #144 cascade ' +
            'override forces `color: inherit !important` on every descendant ' +
            'with an inline style, so the rendered text appears in the ' +
            'visual\'s Default body color (typically black) rather than red ' +
            '— this is by design (see ' +
            'docs/solutions/2026-05-issue-144-body-styling-cascade.md). ' +
            '`font-weight: bold` is not on the override list and renders as ' +
            'authored. To preserve the inline red, supply a Custom stylesheet.',
        input: '<p style="color: red; font-weight: bold">red bold</p>',
        expectedSanitized: {
            // postcss normalizes whitespace around the colon, so the
            // sanitized output is 'color:red;font-weight:bold'.
            contains: ['color:red', 'font-weight:bold'],
            notContains: ['url(']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-svg-basic-shapes',
        description:
            'A small inline SVG with the most common primitive shapes — circle, ' +
            'rect, and line — using basic fill and stroke. Should render as ' +
            'three side-by-side shapes.',
        input:
            '<svg width="180" height="40" viewBox="0 0 180 40">' +
            '<circle cx="20" cy="20" r="15" fill="steelblue"/>' +
            '<rect x="60" y="5" width="30" height="30" fill="orange"/>' +
            '<line x1="120" y1="20" x2="170" y2="20" stroke="#333" stroke-width="3"/>' +
            '</svg>',
        expectedSanitized: {
            contains: ['<svg', 'circle', 'steelblue', 'orange', 'stroke-width']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-svg-responsive-viewbox',
        description:
            'An SVG that scales to fill its container using viewBox plus 100% ' +
            'width and height with preserveAspectRatio. The standard pattern ' +
            'for responsive maps and dashboards.',
        input:
            '<svg viewBox="0 0 100 100" width="100%" height="100%" ' +
            'preserveAspectRatio="xMidYMid meet">' +
            '<rect x="10" y="10" width="80" height="80" fill="#0078d4"/>' +
            '</svg>',
        expectedSanitized: {
            contains: ['viewBox', 'preserveAspectRatio', 'width="100%"', 'height="100%"']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-svg-overlay-with-opacity',
        description:
            'A semi-transparent rectangle overlay on top of a solid shape, using ' +
            'fill-opacity. Common pattern for highlighting a region of a chart.',
        input:
            '<svg width="120" height="40" viewBox="0 0 120 40">' +
            '<rect x="0" y="0" width="120" height="40" fill="steelblue"/>' +
            '<rect x="40" y="0" width="40" height="40" fill="red" fill-opacity="0.4"/>' +
            '</svg>',
        expectedSanitized: {
            contains: ['fill-opacity', 'steelblue', 'red']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-svg-text-styling',
        description:
            'SVG text with the styling a chart axis or legend typically uses — ' +
            'italic font-style, text-anchor, and rotated tick label via transform.',
        input:
            '<svg width="160" height="60" viewBox="0 0 160 60">' +
            '<text x="10" y="20" text-anchor="start" font-style="italic" font-size="14">Axis label</text>' +
            '<text x="80" y="50" text-anchor="middle" transform="rotate(-45 80 50)">Q1 2025</text>' +
            '</svg>',
        expectedSanitized: {
            contains: ['font-style', 'italic', 'text-anchor', 'rotate(-45']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-svg-stroke-styling',
        description:
            'A dashed grid line, a rounded line cap, and a polyline sparkline ' +
            'with rounded joins. Exercises stroke-dasharray, stroke-linecap, ' +
            'and stroke-linejoin on the shapes that use them most often.',
        input:
            '<svg width="160" height="40" viewBox="0 0 160 40">' +
            '<line x1="0" y1="20" x2="160" y2="20" stroke="#ccc" stroke-dasharray="4,2"/>' +
            '<line x1="10" y1="30" x2="150" y2="30" stroke="#000" stroke-width="3" stroke-linecap="round"/>' +
            '<polyline points="0,35 30,15 60,25 90,8 120,18 150,4" ' +
            'fill="none" stroke="#0078d4" stroke-width="2" ' +
            'stroke-linejoin="round" stroke-linecap="round"/>' +
            '</svg>',
        expectedSanitized: {
            contains: ['stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'polyline']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-svg-filter-drop-shadow',
        description:
            'A drop shadow applied to a path via the canonical SVG filter chain — ' +
            'feGaussianBlur, feOffset, and feMerge. Exercises filter primitives ' +
            'with their distinctive camelCase attributes.',
        input:
            '<svg width="160" height="60" viewBox="0 0 160 60">' +
            '<defs>' +
            '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">' +
            '<feGaussianBlur in="SourceAlpha" stdDeviation="2"/>' +
            '<feOffset dx="1" dy="1" result="off"/>' +
            '<feMerge><feMergeNode in="off"/><feMergeNode in="SourceGraphic"/></feMerge>' +
            '</filter>' +
            '</defs>' +
            '<rect x="20" y="15" width="120" height="30" fill="#0078d4" filter="url(#shadow)"/>' +
            '</svg>',
        expectedSanitized: {
            contains: ['stdDeviation', 'feGaussianBlur', 'feOffset', 'feMergeNode', 'filter="url(#shadow)"']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-svg-linear-gradient',
        description:
            'A rectangle filled with a horizontal linear gradient defined in <defs> ' +
            'and referenced via fill="url(#id)". Tests gradient definitions, ' +
            'gradientUnits, and stop-color.',
        input:
            '<svg width="160" height="40" viewBox="0 0 160 40">' +
            '<defs>' +
            '<linearGradient id="g1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="160" y2="0">' +
            '<stop offset="0%" stop-color="#0078d4"/>' +
            '<stop offset="100%" stop-color="#50e6ff"/>' +
            '</linearGradient>' +
            '</defs>' +
            '<rect x="0" y="0" width="160" height="40" fill="url(#g1)"/>' +
            '</svg>',
        expectedSanitized: {
            contains: ['linearGradient', 'gradientUnits', 'stop-color', 'fill="url(#g1)"']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-svg-sparkline',
        description:
            'A small inline sparkline showing a trend line with an end-point ' +
            'marker — the kind of chart a report author would embed next to a ' +
            'KPI value.',
        input:
            '<svg width="120" height="30" viewBox="0 0 120 30" xmlns="http://www.w3.org/2000/svg">' +
            '<g transform="translate(2,2)">' +
            '<path d="M0,20 L20,10 L40,15 L60,5 L80,12 L100,3" ' +
            'fill="none" stroke="#0078d4" stroke-width="1.5" ' +
            'stroke-linecap="round" stroke-linejoin="round"/>' +
            '<circle cx="100" cy="3" r="2" fill="#0078d4"/>' +
            '</g></svg>',
        expectedSanitized: {
            contains: ['viewBox', 'translate(2,2)', 'M0,20', 'stroke-linecap', 'stroke-linejoin']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-svg-bar-chart',
        description:
            'A small bar chart with two bars, an x-axis baseline, a tick line, ' +
            'and a rotated italic tick label. Exercises text-anchor, font-style, ' +
            'transform, and group nesting in a recognizable chart shape.',
        input:
            '<svg width="200" height="120" viewBox="0 0 200 120">' +
            '<g class="axis" transform="translate(0,100)">' +
            '<line x1="0" y1="0" x2="200" y2="0" stroke="#333"/>' +
            '<g class="tick" transform="translate(20,0)">' +
            '<line y2="6" stroke="#333"/>' +
            '<text y="9" dy="0.71em" text-anchor="middle" font-style="italic">Jan</text>' +
            '</g></g>' +
            '<g class="bars">' +
            '<rect x="10" y="40" width="20" height="60" fill="steelblue"/>' +
            '<rect x="40" y="20" width="20" height="80" fill="steelblue"/>' +
            '</g></svg>',
        expectedSanitized: {
            contains: ['text-anchor', 'font-style', 'steelblue', 'translate(0,100)']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'clean-img-svg-xml-data-uri',
        description:
            'A small inline SVG embedded as data:image/svg+xml;utf8 in <img src>. ' +
            'This is the shape DAX measures emit when a report author builds an ' +
            'SVG string and feeds it to HTML Content as an image. Browsers ' +
            'sandbox SVG loaded via <img>, so embedded scripts and external ' +
            'resource references would not execute even if present (issue #143 ' +
            'follow-up).',
        input: "<img src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><circle cx='4' cy='4' r='3' fill='red'/></svg>\">",
        expectedSanitized: {
            contains: [
                'data:image/svg+xml',
                "viewBox='0 0 8 8'",
                "circle cx='4'"
            ]
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'issue #143 — svg+xml in <img src> image-context loading'
    },
    {
        id: 'clean-svg-animate-opacity',
        description:
            'SMIL animation targeting opacity (a safe presentation attribute). ' +
            'attributeName="opacity" is not on the denylist, so the animation ' +
            'survives intact and renders the fade-in effect at runtime (issue ' +
            '#145 HomeTetris pattern).',
        input:
            '<svg><g opacity="0">' +
            '<animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="0s" fill="freeze"/>' +
            '<rect width="10" height="10" fill="red"/></g></svg>',
        expectedSanitized: {
            contains: [
                '<animate',
                'attributeName="opacity"',
                'from="0"',
                'to="1"',
                'fill="freeze"'
            ]
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'issue #145 — safe SMIL animation pass-through'
    },
    {
        id: 'clean-css-fragment-url-fill',
        description:
            'CSS rule using url(#fragment) to reference an in-document SVG ' +
            'gradient. Same-document fragment refs resolve in-place and never ' +
            'fetch, so the CSS sanitizer admits them as a fast-path before ' +
            'the url() data:image safety check runs (security review).',
        input:
            '<style>.shape { fill: url(#gradient1); }</style>' +
            '<svg><defs><linearGradient id="gradient1"><stop offset="0%" stop-color="red"/><stop offset="100%" stop-color="blue"/></linearGradient></defs>' +
            '<rect class="shape" width="100" height="50"/></svg>',
        expectedSanitized: {
            contains: [
                '.shape',
                'fill: url(#gradient1)',
                '<linearGradient',
                '<rect class="shape"'
            ]
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'Security review — fragment-only url() in CSS sanitizer'
    },
    {
        id: 'clean-css-fragment-url-filter',
        description:
            'Inline style filter property pointing at an in-document SVG filter ' +
            'definition via url(#filterId). Common SVG drop-shadow / blur ' +
            'pattern; the fragment-only url() must survive the CSS sanitizer.',
        input:
            '<svg><defs><filter id="dropShadow"><feGaussianBlur stdDeviation="2"/></filter></defs>' +
            '<rect width="50" height="50" fill="red" style="filter: url(#dropShadow)"/></svg>',
        expectedSanitized: {
            // postcss normalizes whitespace around the colon for inline
            // style attributes, so the surviving form is `filter:url(...)`
            // (no space). Same convention as partial-multiple-declarations
            // and clean-color-style.
            contains: [
                '<filter id="dropShadow"',
                '<feGaussianBlur',
                'filter:url(#dropShadow)'
            ]
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'Security review — fragment-only url() in inline style'
    },
    {
        id: 'clean-svg-marker-fragment-href',
        description:
            'SVG2 <marker> cross-referencing another marker definition via ' +
            'href="#otherMarker". Fragment-only allowedSchemesByTag entry ' +
            'lets it through (security review).',
        input:
            '<svg><defs>' +
            '<marker id="base" viewBox="0 0 10 10"><path d="M0,0 L10,5 L0,10"/></marker>' +
            '<marker id="derived" href="#base" viewBox="0 0 10 10"/>' +
            '</defs><line x1="0" y1="0" x2="100" y2="0" stroke="black" marker-end="url(#derived)"/></svg>',
        expectedSanitized: {
            contains: [
                '<marker id="base"',
                '<marker id="derived"',
                'href="#base"',
                'marker-end="url(#derived)"'
            ]
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'Security review — marker fragment-only allowedSchemesByTag'
    },
    {
        id: 'clean-svg-symbol-fragment-href',
        description:
            'SVG2 <symbol> cross-referencing another symbol definition via ' +
            'href="#otherSymbol". Fragment-only allowedSchemesByTag entry ' +
            'lets it through (security review).',
        input:
            '<svg><defs>' +
            '<symbol id="base" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol>' +
            '<symbol id="derived" href="#base" viewBox="0 0 10 10"/>' +
            '</defs></svg>',
        expectedSanitized: {
            contains: [
                '<symbol id="base"',
                '<symbol id="derived"',
                'href="#base"'
            ]
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'Security review — symbol fragment-only allowedSchemesByTag'
    },
    // ─────────────────────────────────────────────────────────────────
    // Toggle-on clean baseline: prove http(s) href DOES survive on <a>
    // when the format-pane `hyperlinks` toggle is enabled, and that the
    // resulting DOM renders CSP-clean (no violations, no outbound
    // network requests at render time — the link only navigates when
    // clicked, which the Power BI host gates separately via launchUrl).
    // Without this entry, the harness has no coverage of the legitimate
    // toggle-on path through the CSP sandbox.
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'clean-anchor-href-toggle-on',
        description:
            'A standard https:// hyperlink with the `hyperlinks` toggle enabled. ' +
            'The href attribute survives sanitization (rendered as <a href="https://example.com">) ' +
            'and the resulting DOM renders without CSP violations — clicks delegate to host.launchUrl ' +
            'rather than the browser, so no navigation happens at render time.',
        input: '<a href="https://example.com">visit example</a>',
        expectedSanitized: {
            contains: ['href="https://example.com"', 'visit example']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'MS cert report 2026-05 — hyperlinks toggle on (positive path)',
        sanitizeOptions: { allowHyperlinks: true }
    }
];
