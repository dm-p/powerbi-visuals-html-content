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
    | 'clean-baseline';        //     legitimate content that must keep rendering

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
    expectedSanitized: {
        contains?: string[];
        notContains?: string[];
    };
    /** Grouping for docs and test filtering. See PayloadCategory. */
    category: PayloadCategory;
    /**
     * CSP directive most likely to fire if the sanitizer leaks. Used to
     * triage harness failures — a violation on `img-src` while running a
     * payload labelled `script-src` points at a classification bug as
     * well as a sanitizer bug. Use 'none' for clean baseline payloads.
     */
    cspCategory: CspCategory;
    /** Provenance: cert report, OWASP, GitHub issue, "baseline", etc. */
    source: string;
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
            'font-weight) with no external resource references.',
        input: '<p style="color: red; font-weight: bold">red bold</p>',
        expectedSanitized: {
            contains: ['color: red', 'font-weight: bold'],
            notContains: ['url(']
        },
        category: 'clean-baseline',
        cspCategory: 'none',
        source: 'baseline'
    }
];
