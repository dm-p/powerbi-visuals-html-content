/**
 * Custom-stylesheet UAT fixtures.
 *
 * Companion to test/fixtures/lorem.ts (rich-text rendering) and
 * test-integration/csp-harness/corpus.ts (sanitization regression).
 * This array drives the THIRD sanitization surface — the visual's
 * `Custom stylesheet` setting on the format pane — which currently has
 * no UAT coverage.
 *
 * The three sanitization surfaces (per docs/sanitization-rules.md):
 *
 *   1. Inline `style` attributes        → covered by corpus.csv
 *   2. `<style>` tag bodies in data     → covered by corpus.csv
 *   3. The custom stylesheet setting    → COVERED HERE
 *
 * Surfaces 2 and 3 share the `sanitizeCss(..., 'stylesheet')` code
 * path, but they reach the DOM differently:
 *
 *   - Surface 2 → `<style>` element ends up inside the visual's
 *     content container (in the body), sanitized as part of the data
 *     payload.
 *   - Surface 3 → `<style id="visualUserStylesheet">` is created in
 *     the page `<head>` by the visual itself (resolveStyling in
 *     domain-utils.ts), sanitized via getSanitizedCss.
 *
 * The body-styling cascade override (issue #144) is gated on whether
 * a custom stylesheet is supplied — surface 3 is the gate's flip
 * point. UAT here verifies both the sanitization parity AND the
 * cascade-gate behavior.
 *
 * Each fixture has:
 *   - `id` — stable, prefixed `style-`, must be unique across all
 *     corpus arrays (MALICIOUS_PAYLOADS, CLEAN_PAYLOADS,
 *     LOREM_PAYLOADS, STYLESHEET_PAYLOADS).
 *   - `description` — what the operator should observe.
 *   - `expectedOutcome` — short visual-confirmation hint shown to the
 *     UAT operator (e.g. "text renders red", "rule silently dropped").
 *   - `htmlInput` — the HTML/measure content to bind to the visual.
 *   - `cssInput` — the CSS to paste into the Custom stylesheet
 *     setting on the format pane.
 *   - `cssExpectedSanitized.contains` / `notContains` — substrings
 *     that must / must not appear in `getSanitizedCss(cssInput)`.
 *     Drives `test/stylesheet-rendering.test.ts`.
 *
 * HOW TO USE IN POWER BI DESKTOP:
 *
 * 1. Bind `htmlInput` (the html_input column) to the HTML Content
 *    visual's Values field on the stylesheet UAT page.
 * 2. Use the slicer to pick a scenario by id.
 * 3. For the selected scenario, copy the `css_input` column value
 *    and paste it into the visual's format pane → Stylesheet → Custom
 *    stylesheet setting.
 * 4. Refresh the visual (navigate away + back) and visually compare
 *    against `expected_outcome`.
 *
 * HOW TO ADD A NEW FIXTURE:
 *
 * 1. Pick a stable `id` with the `style-` prefix.
 * 2. Write a plain-language `description`.
 * 3. Write the raw `cssInput` exactly as a report author would paste
 *    it. Keep it small and structurally meaningful — UAT operators
 *    have to copy this into the format pane by hand.
 * 4. Write a minimal `htmlInput` that exercises the CSS rule (e.g. a
 *    `<p class="target">` for a rule targeting `.target`).
 * 5. List substrings the sanitized CSS MUST contain in
 *    `cssExpectedSanitized.contains` (and MUST NOT in
 *    `cssExpectedSanitized.notContains`) — pick the structurally
 *    distinctive parts.
 * 6. Run `npx vitest run test/stylesheet-rendering.test.ts`.
 * 7. Run `npm run uat:generate` to refresh `test-uat/stylesheet.csv`.
 */

export interface StylesheetScenario {
    /** Stable, unique identifier. Must start with `style-`. */
    id: string;
    /** Plain-language description shown in the CSV. */
    description: string;
    /** Short hint for the UAT operator on what the visual should look like. */
    expectedOutcome: string;
    /** HTML payload to bind to the visual. */
    htmlInput: string;
    /** CSS to paste into the Custom stylesheet setting on the format pane. */
    cssInput: string;
    /** Sanitization assertions on `getSanitizedCss(cssInput)`. */
    cssExpectedSanitized: {
        contains?: string[];
        notContains?: string[];
    };
}

export const STYLESHEET_PAYLOADS: StylesheetScenario[] = [
    // ─────────────────────────────────────────────────────────────────
    // Clean baselines — these MUST survive and render visibly.
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'style-basic-color',
        description:
            'A single class selector setting color. Verifies the most common ' +
            'authored-stylesheet shape survives surface 3 sanitization.',
        expectedOutcome: 'The "target" paragraph renders in red.',
        htmlInput: '<p class="target">red text via custom stylesheet</p>',
        cssInput: '.target { color: red; }',
        cssExpectedSanitized: {
            contains: ['.target', 'color: red']
        }
    },
    {
        id: 'style-css-variables',
        description:
            'CSS custom properties on :root, referenced via var() in a class ' +
            'rule. Surface 3 must preserve both the declaration and the ' +
            'reference unchanged.',
        expectedOutcome: 'The "card" block renders with a blue background and white text.',
        htmlInput: '<div class="card">var() reference test</div>',
        cssInput:
            ':root { --card-bg: #2F06D2; --card-fg: #ffffff; }\n' +
            '.card { background: var(--card-bg); color: var(--card-fg); padding: 12px; }',
        cssExpectedSanitized: {
            contains: ['--card-bg', '--card-fg', 'var(--card-bg)', 'var(--card-fg)']
        }
    },
    {
        id: 'style-modern-functions',
        description:
            'Modern CSS value functions — clamp(), rgba() — and !important. ' +
            'These exercise the postcss value-parser path inside sanitizeCss ' +
            'and are common in real reporter content (issue #143 follow-up).',
        expectedOutcome:
            'The "shape" element renders with a fluid font-size, semi-transparent shadow, ' +
            'and the !important font-weight wins over any inherited rule.',
        htmlInput: '<div class="shape">modern css functions</div>',
        cssInput:
            '.shape {\n' +
            '    font-size: clamp(12px, 3vw, 24px);\n' +
            '    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);\n' +
            '    font-weight: 700 !important;\n' +
            '}',
        cssExpectedSanitized: {
            contains: ['clamp(', 'rgba(', '!important']
        }
    },
    {
        id: 'style-multiline-selector-has-hover',
        description:
            'Multi-line comma-separated selector list using :has(:hover) — the ' +
            'exact shape that broke on Power BI 1.6.1.0 (issue #143 kriscs1). ' +
            'Surface 3 must preserve the LF-separated selector list intact.',
        expectedOutcome:
            'Hovering the .row element fades the .panel inside it; both ' +
            'selectors must survive sanitization for the rule to apply.',
        htmlInput:
            '<div class="row"><div class="panel">hover the parent row to fade me</div></div>',
        cssInput:
            '.row:has(.panel:hover) .panel,\n' +
            '.row:has(.panel:focus) .panel {\n' +
            '    opacity: 0.4;\n' +
            '    transition: opacity 0.2s ease-in;\n' +
            '}',
        cssExpectedSanitized: {
            contains: [
                '.row:has(.panel:hover)',
                '.row:has(.panel:focus)',
                'opacity: 0.4',
                'transition'
            ]
        }
    },
    {
        id: 'style-fragment-url-fill',
        description:
            'CSS rule using url(#fragment) to reference an in-document SVG ' +
            'gradient. Same-document fragment refs must survive surface 3 ' +
            'sanitization (Greptile review fix).',
        expectedOutcome:
            'The .badge rectangle renders with the in-document gradient applied as fill.',
        htmlInput:
            '<svg viewBox="0 0 100 50">' +
            '<defs><linearGradient id="g1"><stop offset="0%" stop-color="#2F06D2"/><stop offset="100%" stop-color="#D24013"/></linearGradient></defs>' +
            '<rect class="badge" width="100" height="50"/>' +
            '</svg>',
        cssInput: '.badge { fill: url(#g1); }',
        cssExpectedSanitized: {
            contains: ['.badge', 'fill: url(#g1)']
        }
    },
    {
        id: 'style-data-image-svg-xml',
        description:
            'CSS background-image with a data:image/svg+xml URI (URL-encoded ' +
            'angle brackets — the canonical CSS-embedded SVG form). Verifies ' +
            'the MIME-conditional base64 bypass added for issue #143.',
        expectedOutcome:
            'The .swatch span shows a 16x16 SVG icon as its background-image.',
        htmlInput: '<span class="swatch">swatch</span>',
        cssInput:
            '.swatch {\n' +
            '    display: inline-block;\n' +
            '    width: 32px;\n' +
            '    height: 32px;\n' +
            "    background-image: url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23E07A5F'/%3E%3C/svg%3E\");\n" +
            '}',
        cssExpectedSanitized: {
            contains: ['.swatch', 'data:image/svg+xml', '%3Csvg', '%23E07A5F']
        }
    },
    {
        id: 'style-media-keyframes',
        description:
            '@media query plus @keyframes animation. Both at-rules are on the ' +
            'sanitizer allowlist; the inner declarations must round-trip.',
        expectedOutcome:
            'The .pulse element fades in over 1s. On viewports ≤ 600px the font-size ' +
            'shrinks to 12px.',
        htmlInput: '<div class="pulse">animated</div>',
        cssInput:
            '@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }\n' +
            '.pulse { animation: fadein 1s ease-in forwards; font-size: 16px; }\n' +
            '@media (max-width: 600px) {\n' +
            '    .pulse { font-size: 12px; }\n' +
            '}',
        cssExpectedSanitized: {
            contains: [
                '@keyframes fadein',
                '@media',
                'animation:',
                'font-size: 12px'
            ]
        }
    },

    // ─────────────────────────────────────────────────────────────────
    // Sanitization regression — these MUST be sanitized away. The
    // visible content should NOT receive the dangerous styling.
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'style-at-import-external',
        description:
            '@import of an external stylesheet. Triggers a CSP violation and ' +
            'must be stripped by sanitizeCss before the rule reaches the ' +
            'page <head>. The safe sibling `.target { color: red }` rule ' +
            'must survive (partial-survival — same shape as ' +
            'style-url-javascript and style-moz-binding).',
        expectedOutcome:
            'The .target paragraph renders red (the sibling rule survives ' +
            'sanitization). The @import line is silently dropped — no ' +
            'network request to attacker.example fires.',
        htmlInput:
            '<p class="target">@import dropped, color rule survives</p>',
        cssInput:
            "@import url('https://attacker.example/evil.css');\n" +
            '.target { color: red; }',
        cssExpectedSanitized: {
            contains: ['.target', 'color: red'],
            notContains: ['@import', 'attacker.example']
        }
    },
    {
        id: 'style-expression',
        description:
            'CSS expression() (legacy IE attack vector). The whole declaration ' +
            'must be dropped by the postcss walker.',
        expectedOutcome: 'The .target paragraph renders with default width, no script execution.',
        htmlInput: '<p class="target">expression() should be dropped</p>',
        cssInput: '.target { width: expression(alert(1)); color: red; }',
        cssExpectedSanitized: {
            notContains: ['expression(', 'alert']
        }
    },
    {
        id: 'style-url-javascript',
        description:
            'background-image using url(javascript:...). Declaration must be ' +
            'dropped; the safe color: red sibling MUST survive (partial-survival).',
        expectedOutcome:
            'The .target paragraph renders red but has no background image (the ' +
            'background declaration was dropped).',
        htmlInput: '<p class="target">background dropped, color survives</p>',
        cssInput:
            '.target {\n' +
            '    color: red;\n' +
            '    background-image: url(javascript:alert(1));\n' +
            '}',
        cssExpectedSanitized: {
            contains: ['.target', 'color: red'],
            notContains: ['javascript', 'background-image', 'alert']
        }
    },
    {
        id: 'style-url-external',
        description:
            'background-image using an external https: URL. Must be dropped ' +
            '(Power BI sandbox blocks external resource loading).',
        expectedOutcome:
            'The .target element renders with no background image and no network ' +
            'request to attacker.example.',
        htmlInput: '<div class="target">no external background</div>',
        cssInput:
            '.target {\n' +
            '    background-image: url(https://attacker.example/bg.png);\n' +
            '    padding: 16px;\n' +
            '}',
        cssExpectedSanitized: {
            contains: ['.target', 'padding'],
            notContains: ['attacker.example', 'background-image']
        }
    },
    {
        id: 'style-moz-binding',
        description:
            '-moz-binding (legacy Firefox XBL injection vector). Property name ' +
            'is denied; whole declaration dropped.',
        expectedOutcome:
            'The .target paragraph renders red. No XBL binding is applied.',
        htmlInput: '<p class="target">moz-binding stripped</p>',
        cssInput:
            '.target {\n' +
            '    color: red;\n' +
            "    -moz-binding: url('https://attacker.example/binding.xml#x');\n" +
            '}',
        cssExpectedSanitized: {
            contains: ['.target', 'color: red'],
            notContains: ['-moz-binding', 'attacker.example']
        }
    }
];
