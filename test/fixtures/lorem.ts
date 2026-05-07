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
import type { Payload } from '../../test-integration/csp-harness/corpus';

export const LOREM_PAYLOADS: Payload[] = [
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
    }
];
