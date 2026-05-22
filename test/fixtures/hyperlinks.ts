/**
 * Hyperlinks-enabled UAT fixtures.
 *
 * Companion to test-integration/csp-harness/corpus.ts and
 * test/fixtures/lorem.ts. This array exists because the visual's
 * format-pane `hyperlinks` toggle changes sanitizer behavior — when
 * ON, `<a href>` survives sanitization (rendered to the DOM) and the
 * click handler delegates the URL to `host.launchUrl`. The default
 * UAT corpora (corpus.csv, lorem.csv) all run at the production
 * default state (`hyperlinks: false`, href stripped) so the UAT
 * reviewer cannot visually verify the toggle-on rendering path from
 * those files alone.
 *
 * Every entry in this array sets `sanitizeOptions: { allowHyperlinks:
 * true }`. The generator emits `test-uat/hyperlinks.csv` whose
 * `sanitizedOutput` column reflects toggle-on sanitizer output. The
 * companion Power BI UAT report page binds those rows with the
 * visual's `Hyperlinks` setting enabled so the reviewer can confirm:
 *
 *   1. Legitimate http(s) hrefs survive sanitization AND render as
 *      clickable links that delegate to `host.launchUrl`.
 *   2. Dangerous schemes (`javascript:`, `data:`) are still rejected
 *      even with the toggle on — the toggle controls whether the
 *      attribute is allowed to populate; the per-tag scheme allowlist
 *      separately controls which schemes survive.
 *   3. Unsupported-but-not-dangerous schemes (`mailto:`, `tel:`,
 *      fragment-only `#anchor`) are silently dropped because Power
 *      BI's `host.launchUrl` contract only supports http(s). Authors
 *      who expect mailto/tel/fragment behavior need to be told that
 *      Power BI's link delegation does not support them.
 *
 * The sanitization doc generator
 * (scripts/generate-sanitization-docs.ts) does NOT iterate this
 * array, so hyperlinks fixtures never appear in
 * docs/sanitization-rules.md "Worked examples". They are about
 * toggle-on rendering verification, not sanitization rule
 * documentation — the worked examples already cover the toggle-off
 * default state.
 *
 * HOW TO ADD A NEW FIXTURE:
 * 1. Pick a stable `id` with the `hyperlinks-` prefix.
 * 2. Write a plain-language `description` aimed at a Power BI report
 *    author — this is what they will see in the CSV and Power BI
 *    report.
 * 3. Write the raw `input` HTML.
 * 4. List substrings the sanitizer's output MUST contain in
 *    `expectedSanitized.contains` and MUST NOT contain in
 *    `expectedSanitized.notContains`.
 * 5. Set `sanitizeOptions: { allowHyperlinks: true }` — required for
 *    every entry in this array.
 * 6. Run `npx vitest run test/hyperlinks-rendering.test.ts` to
 *    confirm the assertion passes.
 * 7. Run `npm run uat:generate` to refresh `test-uat/hyperlinks.csv`.
 *
 * IDs must be unique across MALICIOUS_PAYLOADS, CLEAN_PAYLOADS,
 * LOREM_PAYLOADS, and HYPERLINKS_PAYLOADS combined. The Playwright
 * spec asserts this at load time.
 */
import type { HyperlinksPayload } from '../../test-integration/csp-harness/corpus';

export const HYPERLINKS_PAYLOADS: HyperlinksPayload[] = [
    // ─────────────────────────────────────────────────────────────────
    // Positive path: legitimate hyperlinks should survive and render.
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'hyperlinks-clean-anchor-https',
        description:
            'A standard https:// hyperlink. With the Hyperlinks toggle ON, ' +
            'the href attribute survives sanitization and the rendered <a> ' +
            'is clickable. Click delegates to host.launchUrl rather than ' +
            'navigating in-place — Power BI shows its native "open URL" ' +
            'prompt the first time.',
        input: '<a href="https://example.com">Visit example.com</a>',
        expectedSanitized: {
            contains: ['href="https://example.com"', 'Visit example.com']
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — positive path (https)',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-clean-anchor-http',
        description:
            'A plain http:// hyperlink. http is also on the allowlist (some ' +
            'intranet content still uses it), so href survives. The Power BI ' +
            'host may show a security warning before navigating; that is the ' +
            'host\'s choice, not the visual.',
        input: '<a href="http://example.com">Visit (http)</a>',
        expectedSanitized: {
            contains: ['href="http://example.com"', 'Visit (http)']
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — positive path (http)',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-clean-anchor-in-prose',
        description:
            'A realistic inline link in a sentence. Verifies the anchor renders ' +
            'with the surrounding text intact, not as a block element.',
        input:
            '<p>See <a href="https://example.com/docs">the documentation</a> ' +
            'for details.</p>',
        expectedSanitized: {
            contains: [
                '<p>See ',
                '<a href="https://example.com/docs">the documentation</a>',
                ' for details.</p>'
            ]
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — positive path (inline prose)',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-target-stripped-rel-preserved',
        description:
            'An anchor with `target="_blank"` and `rel="noopener"`. The ' +
            '`target` attribute is stripped by DOMPurify (default ' +
            'tabnabbing protection — DOMPurify removes `target` rather ' +
            'than rewriting it to include `rel="noopener noreferrer"`). ' +
            '`rel` survives intact because it is on the allowlist. In ' +
            'Power BI this has no functional impact: clicks delegate to ' +
            '`host.launchUrl`, which always opens in the host-controlled ' +
            'navigation surface regardless of the `target` attribute. ' +
            'Document so authors do not chase phantom "target lost" bugs.',
        input:
            '<a href="https://example.com" target="_blank" rel="noopener">' +
            'external link</a>',
        expectedSanitized: {
            contains: [
                'href="https://example.com"',
                'rel="noopener"',
                'external link'
            ],
            notContains: ['target=']
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — DOMPurify target-attribute behavior',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-clean-multiple-links',
        description:
            'Multiple anchors in a single payload. Verifies each href is ' +
            'preserved independently.',
        input:
            '<p><a href="https://example.com/one">first</a>, ' +
            '<a href="https://example.com/two">second</a>, and ' +
            '<a href="https://example.com/three">third</a>.</p>',
        expectedSanitized: {
            contains: [
                'href="https://example.com/one"',
                'href="https://example.com/two"',
                'href="https://example.com/three"'
            ]
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — positive path (multiple anchors)',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-reject-svg-xlink-href-legacy',
        description:
            'An SVG <a> using the legacy SVG 1.1 xlink:href form. DOMPurify ' +
            'does NOT preserve `xlink:href` on SVG <a> elements (the ' +
            'namespaced legacy form is dropped during sanitization even ' +
            'though the SVG2 unprefixed `href` form does survive — see ' +
            'hyperlinks-clean-svg-anchor-href). Surfacing in UAT so authors ' +
            'using older SVG authoring tools that emit `xlink:href` know ' +
            'to migrate to the SVG2 form. The click handler retains an ' +
            '`xlink:href` fallback as defense-in-depth, but in practice the ' +
            'sanitizer drops the attribute before the click handler sees it.',
        input:
            '<svg width="100" height="30" viewBox="0 0 100 30">' +
            '<a xlink:href="https://example.com">' +
            '<text x="5" y="20" fill="blue" text-decoration="underline">' +
            'SVG link</text></a></svg>',
        expectedSanitized: {
            contains: ['SVG link'],
            // `href=` covers both the xlink:href form and a hypothetical
            // future DOMPurify version that normalizes xlink:href to the
            // SVG2 unprefixed `href` rather than dropping it — without
            // this needle, the rename case would slip past the
            // `xlink:href` check while still leaving a live link.
            notContains: ['xlink:href', 'href=', 'example.com']
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — DOMPurify drops xlink:href on SVG <a>',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-clean-svg-anchor-href',
        description:
            'An SVG <a> wrapping a <text> shape, using the SVG2 unprefixed ' +
            'href form. Modern SVG authoring tools emit this form. The ' +
            'click handler reads either form (prefers unprefixed href when ' +
            'both are present).',
        input:
            '<svg width="100" height="30" viewBox="0 0 100 30">' +
            '<a href="https://example.com">' +
            '<text x="5" y="20" fill="blue" text-decoration="underline">' +
            'SVG2 link</text></a></svg>',
        expectedSanitized: {
            contains: ['href="https://example.com"', 'SVG2 link']
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — positive path (SVG2 href)',
        sanitizeOptions: { allowHyperlinks: true }
    },

    // ─────────────────────────────────────────────────────────────────
    // Negative path: schemes the toggle does NOT relax. The format-pane
    // toggle controls whether href is allowed to populate; the per-tag
    // scheme allowlist separately governs which schemes survive. The
    // following entries all have the toggle on but still must drop.
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'hyperlinks-reject-javascript',
        description:
            'A `javascript:` href with the Hyperlinks toggle ON. This must ' +
            'still drop — the toggle governs WHETHER href is allowed; the ' +
            'allowedSchemesByTag list (http/https only on <a>) separately ' +
            'governs WHICH schemes survive. Output renders as a hrefless ' +
            '<a> — the text stays, the URL surface is gone.',
        input: '<a href="javascript:alert(1)">click me</a>',
        expectedSanitized: {
            contains: ['<a>', 'click me'],
            notContains: ['javascript:', 'alert(1)', 'href=']
        },
        category: 'hyperlinks',
        cspCategory: 'script-src',
        source: 'hyperlinks UAT — scheme allowlist still fires (javascript:)',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-reject-data',
        description:
            'A `data:` href with the toggle ON. Same gate as javascript: — ' +
            'the per-tag scheme allowlist (http/https) rejects data: even ' +
            'when href is allowed to populate. Rendered as a hrefless <a>.',
        input: '<a href="data:text/html,<script>alert(1)</script>">click me</a>',
        expectedSanitized: {
            contains: ['<a>', 'click me'],
            notContains: ['data:', 'script', 'href=']
        },
        category: 'hyperlinks',
        cspCategory: 'script-src',
        source: 'hyperlinks UAT — scheme allowlist still fires (data:)',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-reject-mailto',
        description:
            'A `mailto:` href with the toggle ON. Not dangerous, but not ' +
            'on the allowlist — Power BI\'s host.launchUrl only handles ' +
            'http(s), so mailto would no-op even if it survived. The ' +
            'sanitizer drops it so the rendered DOM never advertises a ' +
            'broken link. Authors who want mail integration must use a ' +
            'different mechanism (e.g. a dedicated drillthrough action).',
        input: '<a href="mailto:contact@example.com">email us</a>',
        expectedSanitized: {
            contains: ['<a>', 'email us'],
            notContains: ['mailto:', 'href=']
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — Power BI launchUrl contract (mailto:)',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-reject-tel',
        description:
            'A `tel:` href with the toggle ON. Same reasoning as mailto: ' +
            '— not on the allowlist, would no-op at the click handler ' +
            'anyway. Surfacing this case in UAT so authors are not ' +
            'surprised that tel: links do not work.',
        input: '<a href="tel:+1234567890">call us</a>',
        expectedSanitized: {
            contains: ['<a>', 'call us'],
            notContains: ['tel:', 'href=']
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — Power BI launchUrl contract (tel:)',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-reject-fragment',
        description:
            'A fragment-only href (`#section`) with the toggle ON. The ' +
            'per-tag scheme allowlist on <a> is `["http","https"]`, which ' +
            'does NOT include the empty scheme — so fragment-only hrefs ' +
            'are stripped. Different from SVG paint-server tags ' +
            '(pattern, marker, gradients), which DO allow empty-scheme ' +
            'fragment refs. Authors who want in-page navigation must ' +
            'either use a full URL with #fragment OR rely on the visual\'s ' +
            'native cross-filter interactions, not in-page anchors.',
        input: '<p>Jump to <a href="#section-2">section 2</a>.</p>',
        expectedSanitized: {
            contains: ['<p>Jump to ', 'section 2', '</p>'],
            notContains: ['href=']
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — fragment-only href dropped on <a>',
        sanitizeOptions: { allowHyperlinks: true }
    },
    {
        id: 'hyperlinks-reject-relative',
        description:
            'A site-relative href (`/path`) with the toggle ON. No scheme ' +
            'means it falls into the same "empty-scheme" bucket as the ' +
            'fragment case and is stripped. Power BI visuals do not have ' +
            'a meaningful base URL anyway — relative URLs would resolve to ' +
            'the embedding host (Power BI Service), not the author\'s ' +
            'intended target.',
        input: '<a href="/internal/dashboard">internal link</a>',
        expectedSanitized: {
            contains: ['<a>', 'internal link'],
            notContains: ['href=', '/internal']
        },
        category: 'hyperlinks',
        cspCategory: 'none',
        source: 'hyperlinks UAT — relative href dropped on <a>',
        sanitizeOptions: { allowHyperlinks: true }
    }
];
