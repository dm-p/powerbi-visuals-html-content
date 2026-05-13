/**
 * Lorem rich-text fixtures.
 *
 * Companion to test-integration/csp-harness/corpus.ts (which covers
 * sanitization regression). This array drives:
 *
 *   - test/lorem-rendering.test.ts            — vitest assertions that
 *                                               every fixture's sanitized
 *                                               output contains the
 *                                               expected substrings.
 *   - scripts/generate-uat-corpus.ts          — emits test-uat/lorem.csv
 *                                               for binding to the Power
 *                                               BI UAT report.
 *
 * The sanitization doc generator (scripts/generate-sanitization-docs.ts)
 * does NOT iterate this array, so lorem entries never appear in
 * docs/sanitization-rules.md "Worked examples". They are about rendering
 * fidelity, not sanitization behavior.
 *
 * HOW TO ADD A NEW FIXTURE:
 * 1. Pick a stable `id` with the `lorem-` prefix.
 * 2. Write a plain-language `description` aimed at a Power BI report
 *    author — this is what they will see in the CSV and Power BI report.
 * 3. Write the raw `input` HTML.
 * 4. List substrings the sanitizer's output MUST contain in
 *    `expectedSanitized.contains` — pick the structurally distinctive
 *    parts (text content, tag names that survive, key attributes).
 * 5. Run `npx vitest run test/lorem-rendering.test.ts` to confirm the
 *    assertion passes.
 * 6. Run `npm run uat:generate` to refresh `test-uat/lorem.csv`.
 *
 * IDs must be unique across MALICIOUS_PAYLOADS, CLEAN_PAYLOADS, and
 * LOREM_PAYLOADS combined.
 *
 * Use short, structurally meaningful sample text rather than long Lorem
 * Ipsum boilerplate. The fixtures are about HTML structure under the
 * sanitizer, not the prose itself.
 */
import type { LoremPayload } from '../../test-integration/csp-harness/corpus';

export const LOREM_PAYLOADS: LoremPayload[] = [
    {
        id: 'lorem-simple-paragraph',
        description:
            'A single short paragraph. The simplest case — must render unchanged.',
        input: '<p>Lorem ipsum dolor sit amet.</p>',
        expectedSanitized: {
            contains: ['<p>', 'Lorem ipsum dolor sit amet.', '</p>']
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-paragraph-with-emphasis',
        description:
            'A paragraph with inline emphasis — bold, italic, code, and an ' +
            'https link. Standard rich-text output where every inline tag must ' +
            'survive. Note: fragment-only hrefs (e.g. "#section") are stripped ' +
            'from <a> by the URL scheme guard, which only allows http/https on ' +
            '<a href>; use a full URL.',
        input:
            '<p>This is <strong>bold</strong>, this is <em>italic</em>, ' +
            'this is <code>monospaced</code>, and this is ' +
            '<a href="https://example.com/section-2">a link</a>.</p>',
        expectedSanitized: {
            contains: [
                '<strong>bold</strong>',
                '<em>italic</em>',
                '<code>monospaced</code>',
                '<a href="https://example.com/section-2">a link</a>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-multiple-paragraphs',
        description:
            'Two paragraphs separated by no extra markup. Tests that successive ' +
            '<p> blocks are preserved in document order.',
        input:
            '<p>First paragraph: a brief introduction to the topic.</p>' +
            '<p>Second paragraph: a follow-up with additional detail.</p>',
        expectedSanitized: {
            contains: [
                '<p>First paragraph: a brief introduction to the topic.</p>',
                '<p>Second paragraph: a follow-up with additional detail.</p>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-headings-hierarchy',
        description:
            'A heading hierarchy from h1 through h6 in document order. Verifies ' +
            'that every heading level survives sanitization.',
        input:
            '<h1>Heading level 1</h1>' +
            '<h2>Heading level 2</h2>' +
            '<h3>Heading level 3</h3>' +
            '<h4>Heading level 4</h4>' +
            '<h5>Heading level 5</h5>' +
            '<h6>Heading level 6</h6>',
        expectedSanitized: {
            contains: [
                '<h1>Heading level 1</h1>',
                '<h2>Heading level 2</h2>',
                '<h3>Heading level 3</h3>',
                '<h4>Heading level 4</h4>',
                '<h5>Heading level 5</h5>',
                '<h6>Heading level 6</h6>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-ordered-list',
        description:
            'An ordered list with three items. The most common pattern for ' +
            'numbered steps and rankings.',
        input:
            '<ol>' +
            '<li>First step.</li>' +
            '<li>Second step.</li>' +
            '<li>Third step.</li>' +
            '</ol>',
        expectedSanitized: {
            contains: [
                '<ol>',
                '<li>First step.</li>',
                '<li>Second step.</li>',
                '<li>Third step.</li>',
                '</ol>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-unordered-list',
        description:
            'An unordered list with three items — the most common bullet pattern ' +
            'and the structural shape reported in issue #144.',
        input:
            '<ul>' +
            '<li>Apples</li>' +
            '<li>Oranges</li>' +
            '<li>Pears</li>' +
            '</ul>',
        expectedSanitized: {
            contains: [
                '<ul>',
                '<li>Apples</li>',
                '<li>Oranges</li>',
                '<li>Pears</li>',
                '</ul>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-nested-list',
        description:
            'An unordered list containing a sub-list two levels deep. Verifies ' +
            'that nested list structure and indentation are preserved.',
        input:
            '<ul>' +
            '<li>Top item one' +
            '<ul>' +
            '<li>Nested item one</li>' +
            '<li>Nested item two</li>' +
            '</ul>' +
            '</li>' +
            '<li>Top item two</li>' +
            '</ul>',
        expectedSanitized: {
            contains: [
                'Top item one',
                'Nested item one',
                'Nested item two',
                'Top item two'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-definition-list',
        description:
            'A definition list with two term/description pairs. Less common but ' +
            'important for glossaries and metadata-style content.',
        input:
            '<dl>' +
            '<dt>HTML</dt>' +
            '<dd>HyperText Markup Language.</dd>' +
            '<dt>CSS</dt>' +
            '<dd>Cascading Style Sheets.</dd>' +
            '</dl>',
        expectedSanitized: {
            contains: [
                '<dl>',
                '<dt>HTML</dt>',
                '<dd>HyperText Markup Language.</dd>',
                '<dt>CSS</dt>',
                '<dd>Cascading Style Sheets.</dd>',
                '</dl>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-blockquote-with-paragraphs',
        description:
            'A blockquote containing two paragraphs and an attribution via ' +
            '<cite>. Tests that block-level content nests cleanly inside ' +
            '<blockquote>.',
        input:
            '<blockquote>' +
            '<p>The opening line of a memorable quote.</p>' +
            '<p>The follow-up sentence that gives it context.</p>' +
            '<cite>Attributed Author</cite>' +
            '</blockquote>',
        expectedSanitized: {
            contains: [
                '<blockquote>',
                '<p>The opening line of a memorable quote.</p>',
                '<p>The follow-up sentence that gives it context.</p>',
                '<cite>Attributed Author</cite>',
                '</blockquote>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-article-structure',
        description:
            'An <article> with <header>, two <section> blocks each carrying an ' +
            '<h2> and a <p>, and a <footer>. Tests HTML5 sectioning elements as ' +
            'a coherent document.',
        input:
            '<article>' +
            '<header><h1>Quarterly Report</h1></header>' +
            '<section>' +
            '<h2>Summary</h2>' +
            '<p>Revenue grew by twelve percent.</p>' +
            '</section>' +
            '<section>' +
            '<h2>Outlook</h2>' +
            '<p>Continued growth is anticipated.</p>' +
            '</section>' +
            '<footer><small>Filed 2026-05-07.</small></footer>' +
            '</article>',
        expectedSanitized: {
            contains: [
                '<article>',
                '<header>',
                '<h1>Quarterly Report</h1>',
                '<section>',
                '<h2>Summary</h2>',
                '<p>Revenue grew by twelve percent.</p>',
                '<h2>Outlook</h2>',
                '<p>Continued growth is anticipated.</p>',
                '<footer>',
                '<small>Filed 2026-05-07.</small>',
                '</article>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-table-with-text',
        description:
            'A small table with a caption, header row, and two body rows. ' +
            'Verifies that table elements (caption, thead, tbody, th, tr, td) ' +
            'all survive sanitization for tabular text content.',
        input:
            '<table>' +
            '<caption>Quarterly figures</caption>' +
            '<thead><tr><th>Quarter</th><th>Revenue</th></tr></thead>' +
            '<tbody>' +
            '<tr><td>Q1</td><td>120</td></tr>' +
            '<tr><td>Q2</td><td>138</td></tr>' +
            '</tbody>' +
            '</table>',
        expectedSanitized: {
            contains: [
                '<table>',
                '<caption>Quarterly figures</caption>',
                '<thead>',
                '<th>Quarter</th>',
                '<th>Revenue</th>',
                '<tbody>',
                '<td>Q1</td>',
                '<td>120</td>',
                '<td>Q2</td>',
                '<td>138</td>',
                '</table>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    {
        id: 'lorem-paragraph-list-paragraph',
        description:
            'A paragraph followed by a bulleted list followed by another ' +
            'paragraph. Approximates the enriched-text shape reported in ' +
            'issue #144 — body styling must apply uniformly across the prose ' +
            'and the list items.',
        input:
            '<p>Before bringing the report to the meeting, please review:</p>' +
            '<ul>' +
            '<li>The headline figures on page one.</li>' +
            '<li>The variance commentary on page three.</li>' +
            '<li>The forward-looking statements on page five.</li>' +
            '</ul>' +
            '<p>Bring any questions to the discussion.</p>',
        expectedSanitized: {
            contains: [
                '<p>Before bringing the report to the meeting, please review:</p>',
                '<ul>',
                '<li>The headline figures on page one.</li>',
                '<li>The variance commentary on page three.</li>',
                '<li>The forward-looking statements on page five.</li>',
                '</ul>',
                '<p>Bring any questions to the discussion.</p>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'baseline'
    },
    // ─────────────────────────────────────────────────────────────────
    // Office-paste residue (issue #144 root cause).
    //
    // Per https://github.com/dm-p/powerbi-visuals-html-content/issues/144#issuecomment-4393240092
    // the reporter traced the "Default body styling not applied" bug to
    // inline style residue introduced when content is pasted into a
    // SharePoint enriched-text field from Outlook, Teams, or Word
    // without "paste as plain text". The pasted HTML carries inline
    // `style="background-color:...; color:...; font-family:...; font-size:..."`
    // declarations that win the cascade against the body styling
    // resolveStyling applies to `#htmlViewer`, so the user's chosen
    // font color, size, and family are silently overridden.
    //
    // These fixtures exercise the visual against representative
    // office-paste shapes. The sanitizer's job is to PRESERVE these
    // inline styles (they are safe — no url(), no expression(), no
    // javascript:); the visual's apply layer is what must win. These
    // rows in the UAT CSV are the demonstration surface for the bug
    // today and the verification surface for the fix tomorrow.
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'lorem-office-paste-paragraph',
        description:
            'A paragraph pasted from Outlook/Word with inline office residue ' +
            '— background-color, color, font-family, font-size all hardcoded ' +
            'on a wrapping <span>. The text content survives but the embedded ' +
            'styling overrides the visual\'s Default body styling (issue #144).',
        input:
            '<p><span style="background-color:#ffffff; color:#000000; ' +
            'font-family:Calibri, sans-serif; font-size:11pt;">' +
            'This paragraph was pasted from Outlook with formatting intact.' +
            '</span></p>',
        expectedSanitized: {
            contains: [
                'background-color:#ffffff',
                'color:#000000',
                'font-family:Calibri',
                'font-size:11pt',
                'This paragraph was pasted from Outlook with formatting intact.'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #144 — office-paste residue'
    },
    {
        id: 'lorem-office-paste-bulleted-list',
        description:
            'A bulleted list where each <li> wraps its content in a <span> ' +
            'carrying Outlook/Teams paste residue. Matches the enriched-text ' +
            'with-bullets shape from the issue #144 reproduction.',
        input:
            '<ul>' +
            '<li><span style="background-color:#ffffff; color:#000000; ' +
            'font-family:Segoe UI, sans-serif; font-size:11pt;">' +
            'First bullet from a copy/paste.</span></li>' +
            '<li><span style="background-color:#ffffff; color:#000000; ' +
            'font-family:Segoe UI, sans-serif; font-size:11pt;">' +
            'Second bullet from the same paste.</span></li>' +
            '<li><span style="background-color:#ffffff; color:#000000; ' +
            'font-family:Segoe UI, sans-serif; font-size:11pt;">' +
            'Third bullet rounding it out.</span></li>' +
            '</ul>',
        expectedSanitized: {
            contains: [
                '<ul>',
                'background-color:#ffffff',
                'font-family:Segoe UI',
                'First bullet from a copy/paste.',
                'Second bullet from the same paste.',
                'Third bullet rounding it out.',
                '</ul>'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #144 — office-paste residue'
    },
    {
        id: 'lorem-office-paste-mixed-content',
        description:
            'Mixed paragraphs and a list, every block carrying its own paste ' +
            'residue, plus an outer <div> with a wrapper background — typical ' +
            'of SharePoint enriched-text rendering after an Outlook paste.',
        input:
            '<div style="background-color:#ffffff;">' +
            '<p><span style="color:#000000; font-family:Calibri, sans-serif; ' +
            'font-size:11pt;">Briefing for the weekly review:</span></p>' +
            '<ul>' +
            '<li><span style="color:#000000; font-family:Calibri, sans-serif; ' +
            'font-size:11pt;">Headline metrics tracking on plan.</span></li>' +
            '<li><span style="color:#000000; font-family:Calibri, sans-serif; ' +
            'font-size:11pt;">Variance commentary attached.</span></li>' +
            '</ul>' +
            '<p><span style="color:#000000; font-family:Calibri, sans-serif; ' +
            'font-size:11pt;">Comments by close of business.</span></p>' +
            '</div>',
        expectedSanitized: {
            contains: [
                'background-color:#ffffff',
                'color:#000000',
                'font-family:Calibri',
                'Briefing for the weekly review:',
                'Headline metrics tracking on plan.',
                'Variance commentary attached.',
                'Comments by close of business.'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #144 — office-paste residue'
    },
    // ─────────────────────────────────────────────────────────────────
    // CSS variables + modern CSS in <style>-in-data (issue #143 follow-up).
    //
    // Per https://github.com/dm-p/powerbi-visuals-html-content/issues/143
    // (comments) reporters on 1.6.1.0 said their
    // <style id="visualUserStylesheet"> content with CSS variables was
    // being stripped after the cert-remediation update. The current
    // branch handles all of these cases (verified by the css-sanitizer
    // and sanitize-pipeline test suites). These fixtures are the UAT
    // surface — bind them in Power BI Desktop to verify the rendered
    // output looks the way the reporter expected.
    // ─────────────────────────────────────────────────────────────────
    {
        id: 'lorem-style-tag-css-variables',
        description:
            'A <style> tag in the bound data defining CSS custom properties ' +
            'on :root and referencing them via var() on a card. The visual ' +
            'must preserve both the declarations and the references so the ' +
            'theming pattern works.',
        input:
            '<style>' +
            ':root { --card-bg: #f7f7fa; --card-fg: #112233; --card-pad: 12px; }' +
            '.themed-card { ' +
            'background: var(--card-bg); ' +
            'color: var(--card-fg); ' +
            'padding: var(--card-pad); ' +
            'border-radius: 8px; ' +
            'border: 1px solid #ccc; ' +
            '}' +
            '</style>' +
            '<div class="themed-card">' +
            '<h3>Themed card</h3>' +
            '<p>Content rendered with CSS variables defined in the same payload.</p>' +
            '</div>',
        expectedSanitized: {
            contains: [
                '--card-bg',
                '--card-fg',
                '--card-pad',
                'var(--card-bg)',
                'var(--card-fg)',
                'var(--card-pad)',
                'Themed card',
                'CSS variables defined in the same payload'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #143 — CSS variables in <style>-in-data'
    },
    {
        id: 'lorem-style-tag-modern-css',
        description:
            'A <style> tag using clamp(), rgba(), :hover, and a transition. ' +
            'Verifies the modern CSS surface that report authors typically ' +
            'use for responsive cards and hover affordances.',
        input:
            '<style>' +
            '.modern-card { ' +
            'font-size: clamp(14px, 2vw, 18px); ' +
            'box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15); ' +
            'transition: box-shadow 0.2s, transform 0.2s; ' +
            '}' +
            '.modern-card:hover { ' +
            'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); ' +
            'transform: translateY(-1px); ' +
            '}' +
            '</style>' +
            '<div class="modern-card">' +
            '<p>Hover me to see the transition.</p>' +
            '</div>',
        expectedSanitized: {
            contains: [
                'clamp(',
                'rgba(',
                ':hover',
                'transition',
                'transform',
                'translateY',
                'Hover me to see the transition.'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #143 — modern CSS in <style>-in-data'
    },
    {
        id: 'lorem-style-tag-reporter-cards',
        description:
            'Compact reproduction of the report — ' +
            ':root variables, themed cards using a MULTI-LINE comma-' +
            'separated selector (.card-wide, .card-wide-link), :hover, ' +
            '@media query containing another multi-line selector, ' +
            'clamp(), rgba(), and !important all in one <style> block ' +
            'bound to the visual via the data payload. The multi-line ' +
            'selector form is the load-bearing case for the issue #143 ' +
            'regression — pre-fix the dangerous-selector check dropped ' +
            'any rule with a newline between selectors.',
        input:
            '<style id="visualUserStylesheet" type="text/css">' +
            ':root {' +
            '--card-bg-color: #ffffff;' +
            '--card-hover-bg-color: #C8DFF4;' +
            '--card-font-family: "Arial", "Tahoma", "Segoe UI", sans-serif;' +
            '}\n' +
            '.card-wide,\n' +
            '.card-wide-link {\n' +
            '    display: flex;\n' +
            '    flex-direction: row;\n' +
            '    width: calc(100% - 40px);\n' +
            '    border: 2px solid #ccc;\n' +
            '    border-radius: 12px;\n' +
            '    padding: 16px;\n' +
            '    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);\n' +
            '    transition: transform 0.2s, box-shadow 0.2s, background-color 0.2s;\n' +
            '    color: inherit;\n' +
            '    background-color: var(--card-bg-color);\n' +
            '    font-family: var(--card-font-family) !important;\n' +
            '}\n' +
            '.card-wide-link:hover {' +
            'transform: scale(1.01);' +
            'background-color: var(--card-hover-bg-color);' +
            '}' +
            '.card-title { font-size: clamp(32px, 4vw, 48px); font-weight: 700; }' +
            '@media (max-width: 600px) {\n' +
            '    .card-wide,\n' +
            '    .card-wide-link {\n' +
            '        padding: 12px;\n' +
            '    }\n' +
            '    .card-title { font-size: clamp(12px, 3.5vw, 16px) !important; }\n' +
            '}' +
            '</style>' +
            '<div class="card-wide-link">' +
            '<div class="card-content">' +
            '<div class="card-title">Quarterly Inventory Snapshot</div>' +
            '<div class="card-desc">Stock levels and turnover rates.</div>' +
            '</div>' +
            '</div>',
        expectedSanitized: {
            contains: [
                '--card-bg-color',
                '--card-hover-bg-color',
                '--card-font-family',
                'var(--card-bg-color)',
                'var(--card-hover-bg-color)',
                'var(--card-font-family)',
                '.card-wide',
                '.card-wide-link',
                'flex-direction',
                'calc(100% - 40px)',
                'rgba(',
                'clamp(',
                'scale(',
                ':hover',
                '@media',
                '!important',
                'inherit',
                'Quarterly Inventory Snapshot'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #143 — report content (multi-line selectors)'
    },
    {
        id: 'lorem-svg-as-img-data-uri-utf8',
        description:
            'An SVG embedded as a data URI inside <img src="data:image/svg+xml;utf8,...">. ' +
            'This is the shape that DAX measures emit when a report author builds an SVG ' +
            'string and feeds it into HTML Content as an image. The SVG itself is text ' +
            '(not base64) and must survive sanitization with viewBox, fill, and shape ' +
            'attributes intact. Browsers sandbox SVG loaded via <img>, so embedded ' +
            'scripts would not execute even if present (issue #143 follow-up).',
        input:
            '<p>Inline SVG via data URI:</p>' +
            "<img alt='svg-icon' src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='24' height='24'><circle cx='12' cy='12' r='10' fill='%231f77b4'/><rect x='8' y='8' width='8' height='8' fill='white'/></svg>\">",
        expectedSanitized: {
            contains: [
                'data:image/svg+xml',
                'utf8',
                "viewBox='0 0 24 24'",
                "circle cx='12'",
                "rect x='8'",
                "fill='%231f77b4'"
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #143 — DAX SVG-as-IMG output pattern'
    },
    {
        id: 'lorem-svg-data-uri-css-background',
        description:
            'A small inline SVG used as a CSS background-image via url(data:image/svg+xml;utf8,...). ' +
            'Common pattern for icons rendered through stylesheet rules rather than <img> tags. ' +
            'Angle brackets in the SVG are URL-encoded (%3C, %3E) — this is the canonical form ' +
            'for SVG-in-CSS data URIs because the HTML parser treats <style> body as raw text up ' +
            'to </style> but DOM parsers and serializers can mis-interpret literal `<svg/>` inside ' +
            'CSS, so url-encoding is the standard practice. The SVG must survive postcss-based CSS ' +
            'sanitization without the base64 gate that applies to raster image MIME types.',
        input:
            '<style>' +
            ".swatch { width: 32px; height: 32px; display: inline-block; " +
            "background-image: url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23e07a5f'/%3E%3C/svg%3E\"); }" +
            '</style>' +
            '<span class="swatch"></span> Brand swatch',
        expectedSanitized: {
            contains: [
                '.swatch',
                'background-image',
                'data:image/svg+xml',
                '%3Csvg',
                "viewBox='0 0 16 16'",
                "fill='%23e07a5f'",
                '%3C/svg%3E',
                'Brand swatch'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #143 — svg+xml in CSS url() image-context loading'
    },
    {
        id: 'lorem-svg-smil-fade-in',
        description:
            'An SVG with SMIL animation — the HomeTetris fade-in pattern from ' +
            'issue #145. Two animation elements per group (one <animate> targeting ' +
            'opacity, one <animateTransform> targeting transform="translate") with ' +
            'staggered begin times. Both animation shapes target safe presentation/ ' +
            'geometry properties, so the SMIL_ATTRIBUTE_NAME_DENYLIST does not ' +
            'fire and the entire animation survives sanitization. Browsers run the ' +
            'animations natively without script execution.',
        input:
            "<svg width='120' height='80' viewBox='0 0 120 80' xmlns='http://www.w3.org/2000/svg'>" +
            "<g opacity='0'>" +
            "<animateTransform attributeName='transform' type='translate' " +
            "from='0,-40' to='0,0' dur='1s' begin='0s' fill='freeze'/>" +
            "<animate attributeName='opacity' from='0' to='1' dur='0.5s' " +
            "begin='0s' fill='freeze'/>" +
            "<rect x='10' y='20' width='40' height='40' fill='#2F06D2'/>" +
            '</g>' +
            "<g opacity='0'>" +
            "<animateTransform attributeName='transform' type='translate' " +
            "from='0,-40' to='0,0' dur='1s' begin='0.5s' fill='freeze'/>" +
            "<animate attributeName='opacity' from='0' to='1' dur='0.5s' " +
            "begin='0.5s' fill='freeze'/>" +
            "<rect x='70' y='20' width='40' height='40' fill='#D24013'/>" +
            '</g>' +
            '</svg>',
        // Note: input uses single-quoted attributes for HTML readability,
        // but DOMPurify normalizes attribute quoting to double quotes
        // during sanitization, so the expected substrings here are
        // double-quoted to match the post-sanitization shape.
        expectedSanitized: {
            contains: [
                '<animateTransform',
                'attributeName="transform"',
                'type="translate"',
                'from="0,-40"',
                'to="0,0"',
                '<animate',
                'attributeName="opacity"',
                'begin="0s"',
                'begin="0.5s"',
                'fill="freeze"',
                'fill="#2F06D2"',
                'fill="#D24013"'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #145 — HomeTetris SMIL animation pattern'
    },
    {
        id: 'lorem-inline-svg-icon-evenodd-cutout',
        description:
            'A table row with a small inline <svg> icon next to body text — ' +
            'the canonical DAX-measure pattern for in-line icons (info / warning / ' +
            'status glyphs). The icon is a single <path> using fill-rule="evenodd" ' +
            'and clip-rule="evenodd" to cut the inner glyph (an exclamation mark) ' +
            'out of the outer disc. If either rule attribute is dropped, the path ' +
            'fills as one solid shape and the cutout collapses to a blue circle ' +
            'with no visible glyph — the exact symptom reported in issue #147. ' +
            'The fixture asserts that fill-rule, clip-rule, the d path data, the ' +
            'path fill colour, and the svg viewBox all survive sanitization. ' +
            'Single-quoted attributes in the input are normalized to double ' +
            'quotes by DOMPurify; expected substrings reflect the post-sanitization ' +
            'shape.',
        input:
            "<table style='border-collapse:collapse;width:100%;background-color:#eaedf4'>" +
            '<tr>' +
            "<td style='border:none;width:40px;vertical-align:middle;padding-bottom:0px'>" +
            "<svg width='32' height='32' viewBox='0 0 32 32' fill='none' " +
            "xmlns='http://www.w3.org/2000/svg'>" +
            "<path fill-rule='evenodd' clip-rule='evenodd' " +
            "d='M16 29.33C23.36 29.33 29.33 23.36 29.33 16C29.33 8.64 23.36 2.67 16 2.67C8.64 2.67 2.67 8.64 2.67 16C2.67 23.36 8.64 29.33 16 29.33ZM17.33 12V9.33H14.67V12H17.33ZM17.33 22.67V14.67H14.67V22.67H17.33Z' " +
            "fill='#002664'/>" +
            '</svg>' +
            '</td>' +
            "<td style='border:none;vertical-align:middle;padding-bottom:5px'>" +
            'If there is no data, please check the slicers.' +
            '</td>' +
            '</tr>' +
            '</table>',
        expectedSanitized: {
            contains: [
                '<svg',
                'viewBox="0 0 32 32"',
                'xmlns="http://www.w3.org/2000/svg"',
                '<path',
                'fill-rule="evenodd"',
                'clip-rule="evenodd"',
                'd="M16 29.33',
                'fill="#002664"',
                'If there is no data'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #147 — inline-SVG icon with evenodd cutout (DAX measure pattern)'
    },
    {
        id: 'lorem-inline-callout-with-background',
        description:
            'A two-row callout strip with an inline background-color on each ' +
            'cell — the typical "info / warning" shape a DAX measure emits ' +
            'when shading rows by status. Asserts the sanitizer preserves ' +
            'the inline background-color declarations so the visual\'s ' +
            'render layer can show them. Visual UAT: with the "Override ' +
            'inline styling" toggle OFF (default), the cell backgrounds ' +
            'render as authored (#eaedf4 / #fff4ce). With the toggle ON, ' +
            'the cascade override leaves background-color alone (it is no ' +
            'longer in the rule body, issue #147 secondary symptom) and ' +
            'only color/font/alignment are forced to inherit. Either way, ' +
            'the backgrounds are visible.',
        input:
            "<table style='border-collapse:collapse;width:100%'>" +
            '<tr>' +
            "<td style='background-color:#eaedf4;padding:8px;border:1px solid #c8c8c8'>" +
            'Informational note: rows shaded for context.' +
            '</td>' +
            '</tr>' +
            '<tr>' +
            "<td style='background-color:#fff4ce;padding:8px;border:1px solid #c8c8c8'>" +
            'Warning: action required before continuing.' +
            '</td>' +
            '</tr>' +
            '</table>',
        expectedSanitized: {
            contains: [
                'background-color:#eaedf4',
                'background-color:#fff4ce',
                'Informational note',
                'Warning: action required'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #147 — inline background-color survival (callout pattern)'
    },
    {
        id: 'lorem-inline-coloured-spans-coperf-shape',
        description:
            'Paragraph with inline-styled <span style="color:..."> for ' +
            'conditional formatting — the shape a DAX measure emits when ' +
            'highlighting status values inline (e.g. red for low, green for ' +
            'high, the HTML CoPerf measure pattern reported on issue #144 ' +
            'follow-up). Asserts the sanitizer preserves the inline color ' +
            'declarations. Visual UAT path 2 (default): with the "Override ' +
            'inline styling" toggle OFF, the per-span colors render as ' +
            'authored — red, amber, green appear inline. Path 1: with the ' +
            'toggle ON, the cascade override forces every inline-styled ' +
            'descendant to inherit the body Font color (paste-cleanup mode). ' +
            'Both behaviors are valid; the toggle expresses author intent.',
        input:
            '<p>' +
            'Status: ' +
            "<span style='color:#d13438;font-weight:600'>Low</span>, " +
            "<span style='color:#f7630c;font-weight:600'>Medium</span>, " +
            "<span style='color:#107c10;font-weight:600'>High</span>." +
            '</p>',
        expectedSanitized: {
            contains: [
                'color:#d13438',
                'color:#f7630c',
                'color:#107c10',
                'Low',
                'Medium',
                'High'
            ]
        },
        category: 'lorem',
        cspCategory: 'none',
        source: 'issue #144 follow-up — HTML CoPerf inline-coloured-spans pattern'
    }
];
