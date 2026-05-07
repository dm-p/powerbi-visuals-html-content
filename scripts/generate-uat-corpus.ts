#!/usr/bin/env node
/**
 * Generates the UAT CSV outputs from the typed payload sources.
 *
 * Two CSVs are produced in test-uat/, with identical column shape so a
 * single Power BI binding pattern handles both:
 *
 *   - corpus.csv  — sanitization regression. Driven by MALICIOUS_PAYLOADS
 *                   and CLEAN_PAYLOADS in test-integration/csp-harness/
 *                   corpus.ts. Each row is an attack vector or clean
 *                   baseline whose sanitized output is the expected
 *                   result.
 *
 *   - lorem.csv   — rich-text rendering fidelity. Driven by
 *                   LOREM_PAYLOADS in test/fixtures/lorem.ts. Each row is
 *                   a structurally distinct rich-text shape (paragraph,
 *                   list, blockquote, article, table, etc.) the visual
 *                   must render unchanged. Foundation for body-styling
 *                   and rich-text regression in the UAT report.
 *
 * Each row includes the raw input, the sanitized output (via the
 * production sanitizer), and all metadata. The CSVs are intended for
 * import into a Power BI semantic model so the HTML Content visual can
 * be exercised as an end user would see it.
 *
 * Usage:
 *   npx tsx scripts/generate-uat-corpus.ts
 *
 * Re-run whenever any source corpus or the sanitizer changes.
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
    Payload
} from '../test-integration/csp-harness/corpus';
import { LOREM_PAYLOADS } from '../test/fixtures/lorem';
import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.resolve(__dirname, '..', 'test-uat');
const CORPUS_PATH = path.join(OUT_DIR, 'corpus.csv');
const LOREM_PATH = path.join(OUT_DIR, 'lorem.csv');

const HEADER = ['id', 'description', 'type', 'category', 'cspCategory', 'source', 'input', 'sanitizedOutput'];

/** Escape a value for CSV (RFC 4180). */
function csvField(value: string): string {
    if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
}

function rowFor(payload: Payload, type: 'malicious' | 'clean' | 'lorem'): string[] {
    return [
        payload.id,
        payload.description,
        type,
        payload.category,
        payload.cspCategory,
        payload.source,
        payload.input,
        getSanitizedHtmlForTesting(payload.input, 'html')
    ];
}

function writeCsv(outPath: string, rows: string[][]): void {
    const lines = [
        HEADER.map(csvField).join(','),
        ...rows.map(row => row.map(csvField).join(','))
    ];
    fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const corpusRows: string[][] = [
    ...MALICIOUS_PAYLOADS.map(p => rowFor(p, 'malicious')),
    ...CLEAN_PAYLOADS.map(p => rowFor(p, 'clean'))
];
writeCsv(CORPUS_PATH, corpusRows);
console.log(`Wrote ${corpusRows.length} rows to ${CORPUS_PATH}`);

const loremRows: string[][] = LOREM_PAYLOADS.map(p => rowFor(p, 'lorem'));
writeCsv(LOREM_PATH, loremRows);
console.log(`Wrote ${loremRows.length} rows to ${LOREM_PATH}`);
