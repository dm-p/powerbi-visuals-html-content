#!/usr/bin/env node
/**
 * Regenerates the "Worked examples" block in docs/sanitization-rules.md
 * from the malicious-payload corpus at
 * test-integration/csp-harness/corpus.ts.
 *
 * Each corpus entry is run through the production sanitizer via
 * getSanitizedHtmlForTesting so the rendered input/output pairs
 * always reflect the current rule set. This keeps the user-facing
 * documentation and the regression tests in lockstep.
 *
 * Usage:
 *   npx tsx scripts/generate-sanitization-docs.ts           # write
 *   npx tsx scripts/generate-sanitization-docs.ts --check   # fail on drift
 *
 * The JSDOM bootstrap below duplicates test-integration/setup-dom.ts
 * rather than importing it, because this script lives at the repo root
 * and has its own module resolution context. The duplication is
 * intentional and small.
 */

// JSDOM setup MUST happen BEFORE importing sanitize-pipeline so the
// transitive DOM-touching modules see a populated globalThis.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/'
});
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.Range = dom.window.Range;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLDivElement = dom.window.HTMLDivElement;
g.DocumentFragment = dom.window.DocumentFragment;
g.DOMParser = dom.window.DOMParser;
try {
    g.navigator = dom.window.navigator;
} catch {
    Object.defineProperty(globalThis, 'navigator', {
        value: dom.window.navigator,
        configurable: true
    });
}
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
    MALICIOUS_PAYLOADS,
    CLEAN_PAYLOADS,
    Payload,
    PayloadCategory
} from '../test-integration/csp-harness/corpus';
import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOC_PATH = path.resolve(__dirname, '..', 'docs', 'sanitization-rules.md');
const START_MARKER = '<!-- WORKED_EXAMPLES_START';
const END_MARKER = '<!-- WORKED_EXAMPLES_END -->';

/**
 * Human-readable titles and section ordering for each PayloadCategory.
 * The generator renders worked-example subsections in this order and
 * uses the second value as the ### heading. Any category not listed
 * here is rendered in a final "Other" section as a belt-and-braces
 * fallback so new categories added to corpus.ts still appear somewhere.
 */
const CATEGORY_ORDER: Array<[PayloadCategory, string, string]> = [
    ['ms-cert', 'Microsoft certification report payloads', 'The exact payloads flagged by Microsoft\'s certification review.'],
    ['css-url-per-property', 'CSS `url()` across CSS properties', 'Every CSS property that accepts a `url()` function, asserted against unsafe arguments.'],
    ['css-url-scheme', 'CSS `url()` scheme variants', 'Every scheme or pseudo-scheme that might appear inside a `url()` argument.'],
    ['data-uri-smuggling', 'Data URI MIME smuggling', 'Data URIs that declare a safe MIME type but carry unsafe content.'],
    ['at-rule', 'CSS at-rules', 'At-rules that load external resources or bypass other rules.'],
    ['event-handler', 'Event handler attributes', 'HTML `on*` attributes that execute script.'],
    ['svg', 'SVG-specific vectors', 'Payloads that only work inside SVG contexts.'],
    ['html-element', 'Disallowed HTML elements', 'HTML elements blocked at the tag level.'],
    ['html-attribute', 'Disallowed HTML attributes', 'HTML attributes blocked at the attribute level.'],
    ['encoding', 'Encoding and obfuscation', 'Unicode and whitespace obfuscation of dangerous tokens.'],
    ['owasp', 'OWASP XSS Filter Evasion Cheat Sheet', 'Representative entries from the OWASP XSS Filter Evasion list.'],
    ['partial-survival', 'Partial-survival cases', 'Mixed safe and unsafe content where only the unsafe part must drop.'],
    ['clean-baseline', 'Clean baseline (safe content)', 'Legitimate content that must continue to render unchanged.']
];

function renderPayload(payload: Payload): string {
    const sanitized = getSanitizedHtmlForTesting(payload.input, 'html');
    const lines: string[] = [];
    lines.push(`#### ${payload.description}`);
    lines.push('');
    lines.push('**Input:**');
    lines.push('');
    lines.push('```html');
    lines.push(payload.input);
    lines.push('```');
    lines.push('');
    lines.push('**Output:**');
    lines.push('');
    lines.push('```html');
    lines.push(sanitized || '(empty — entire input was dropped)');
    lines.push('```');
    lines.push('');
    return lines.join('\n');
}

function renderWorkedExamples(): string {
    const allPayloads: Payload[] = [...MALICIOUS_PAYLOADS, ...CLEAN_PAYLOADS];
    // Group by PayloadCategory while preserving corpus insertion order
    // inside each group (stable, deterministic).
    const byCategory = new Map<PayloadCategory, Payload[]>();
    for (const p of allPayloads) {
        const list = byCategory.get(p.category) || [];
        list.push(p);
        byCategory.set(p.category, list);
    }

    const sections: string[] = [];
    sections.push('');
    sections.push('');
    for (const [category, title, blurb] of CATEGORY_ORDER) {
        const payloads = byCategory.get(category);
        if (!payloads || payloads.length === 0) continue;
        sections.push(`### ${title}`);
        sections.push('');
        sections.push(blurb);
        sections.push('');
        for (const p of payloads) {
            sections.push(renderPayload(p));
        }
        byCategory.delete(category);
    }
    // Any categories not in CATEGORY_ORDER — render last with a generic
    // heading so new corpus categories still appear in the doc until
    // CATEGORY_ORDER gets updated. Sorted alphabetically for determinism.
    const remainingCategories = [...byCategory.keys()].sort();
    for (const category of remainingCategories) {
        const payloads = byCategory.get(category)!;
        sections.push(`### Other: ${category}`);
        sections.push('');
        for (const p of payloads) {
            sections.push(renderPayload(p));
        }
    }
    sections.push('');
    return sections.join('\n');
}

function replaceBetweenMarkers(source: string, body: string): string {
    const startIdx = source.indexOf(START_MARKER);
    const endIdx = source.indexOf(END_MARKER);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        throw new Error(
            `Could not find ${START_MARKER} / ${END_MARKER} markers in ${DOC_PATH}`
        );
    }
    // Preserve the start-marker line (through its newline) and the
    // end-marker line verbatim. Only the body between them is replaced.
    const startLineEnd = source.indexOf('\n', startIdx);
    if (startLineEnd === -1) {
        throw new Error(`Start marker line in ${DOC_PATH} has no terminating newline`);
    }
    const before = source.slice(0, startLineEnd + 1);
    const after = source.slice(endIdx);
    return `${before}${body}${after}`;
}

function main(): void {
    const checkMode = process.argv.includes('--check');
    const source = fs.readFileSync(DOC_PATH, 'utf8');
    const body = renderWorkedExamples();
    const updated = replaceBetweenMarkers(source, body);

    if (checkMode) {
        if (updated !== source) {
            process.stderr.write(
                'ERROR: docs/sanitization-rules.md is out of date relative ' +
                'to test-integration/csp-harness/corpus.ts.\n' +
                'Run: npm run docs:generate\n' +
                'and commit the result.\n'
            );
            process.exit(1);
        }
        process.stdout.write(
            'docs/sanitization-rules.md is in sync with the corpus.\n'
        );
        return;
    }

    if (updated === source) {
        process.stdout.write('docs/sanitization-rules.md is already up to date.\n');
        return;
    }
    fs.writeFileSync(DOC_PATH, updated);
    process.stdout.write(`Updated ${DOC_PATH}\n`);
}

main();
