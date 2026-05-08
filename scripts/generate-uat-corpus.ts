#!/usr/bin/env node
/**
 * Generates the UAT CSV outputs from the typed payload sources.
 *
 * Three CSVs are produced in test-uat/:
 *
 *   - corpus.csv     — sanitization regression. Driven by
 *                      MALICIOUS_PAYLOADS and CLEAN_PAYLOADS in
 *                      test-integration/csp-harness/corpus.ts. Each row
 *                      is an attack vector or clean baseline whose
 *                      sanitized output is the expected result. Tests
 *                      sanitization surfaces 1 (inline style) and 2
 *                      (<style> tag in data).
 *
 *   - lorem.csv      — rich-text rendering fidelity. Driven by
 *                      LOREM_PAYLOADS in test/fixtures/lorem.ts. Each
 *                      row is a structurally distinct rich-text shape
 *                      (paragraph, list, blockquote, article, table,
 *                      etc.) the visual must render unchanged.
 *                      Foundation for body-styling and rich-text
 *                      regression in the UAT report.
 *
 *   - stylesheet.csv — custom-stylesheet UAT. Driven by
 *                      STYLESHEET_PAYLOADS in
 *                      test/fixtures/stylesheet-scenarios.ts. Each row
 *                      pairs an HTML payload with a CSS payload that
 *                      the operator pastes into the visual's format
 *                      pane Custom stylesheet setting. Tests
 *                      sanitization surface 3 — the only path that
 *                      doesn't share a DOM injection point with surfaces
 *                      1 and 2.
 *
 * corpus.csv and lorem.csv share the same column shape (a single
 * binding pattern handles both). stylesheet.csv has its own column
 * shape (`html_input` + `css_input` + `css_sanitized`) because the CSS
 * is operator-pasted, not bound.
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
// transitive DOM-touching modules see a populated globalThis. The
// helper is a side-effect import — keep it first.
import './_setup-jsdom';

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
    MALICIOUS_PAYLOADS,
    CLEAN_PAYLOADS
} from '../test-integration/csp-harness/corpus';
import type {
    LoremPayload,
    Payload
} from '../test-integration/csp-harness/corpus';
import { LOREM_PAYLOADS } from '../test/fixtures/lorem';
import { STYLESHEET_PAYLOADS } from '../test/fixtures/stylesheet-scenarios';
import {
    getSanitizedHtmlForTesting,
    getSanitizedCss
} from '../src/sanitize-pipeline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.resolve(__dirname, '..', 'test-uat');
const CORPUS_PATH = path.join(OUT_DIR, 'corpus.csv');
const LOREM_PATH = path.join(OUT_DIR, 'lorem.csv');
const STYLESHEET_PATH = path.join(OUT_DIR, 'stylesheet.csv');

const HEADER = ['id', 'description', 'type', 'category', 'cspCategory', 'source', 'input', 'sanitizedOutput'];

const STYLESHEET_HEADER = [
    'id',
    'description',
    'expected_outcome',
    'html_input',
    'html_sanitized',
    'css_input',
    'css_sanitized'
];

/** Escape a value for CSV (RFC 4180). */
function csvField(value: string): string {
    if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
}

function rowFor(
    payload: Payload | LoremPayload,
    type: 'malicious' | 'clean' | 'lorem'
): string[] {
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

/** stylesheet.csv has its own column shape — see STYLESHEET_HEADER. */
function writeStylesheetCsv(): void {
    const lines = [STYLESHEET_HEADER.map(csvField).join(',')];
    for (const scenario of STYLESHEET_PAYLOADS) {
        lines.push(
            [
                scenario.id,
                scenario.description,
                scenario.expectedOutcome,
                scenario.htmlInput,
                getSanitizedHtmlForTesting(scenario.htmlInput, 'html'),
                scenario.cssInput,
                getSanitizedCss(scenario.cssInput)
            ]
                .map(csvField)
                .join(',')
        );
    }
    fs.writeFileSync(STYLESHEET_PATH, lines.join('\n') + '\n', 'utf-8');
}

writeStylesheetCsv();
console.log(
    `Wrote ${STYLESHEET_PAYLOADS.length} rows to ${STYLESHEET_PATH}`
);
