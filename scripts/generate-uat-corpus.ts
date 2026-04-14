#!/usr/bin/env node
/**
 * Generates test-uat/corpus.csv from the malicious/clean payload corpus.
 *
 * Each row includes the raw input, the sanitized output (via the
 * production sanitizer), and all corpus metadata. The CSV is intended
 * for import into a Power BI semantic model so the HTML Content visual
 * can be exercised as an end user would see it.
 *
 * Usage:
 *   npx tsx scripts/generate-uat-corpus.ts
 *
 * Re-run whenever the corpus or sanitizer changes.
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
import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.resolve(__dirname, '..', 'test-uat');
const OUT_PATH = path.join(OUT_DIR, 'corpus.csv');

/** Escape a value for CSV (RFC 4180). */
function csvField(value: string): string {
    if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
}

function buildRows(): string[][] {
    const rows: string[][] = [];

    for (const payload of MALICIOUS_PAYLOADS) {
        const sanitized = getSanitizedHtmlForTesting(payload.input, 'html');
        rows.push([
            payload.id,
            payload.description,
            'malicious',
            payload.category,
            payload.cspCategory,
            payload.source,
            payload.input,
            sanitized
        ]);
    }

    for (const payload of CLEAN_PAYLOADS) {
        const sanitized = getSanitizedHtmlForTesting(payload.input, 'html');
        rows.push([
            payload.id,
            payload.description,
            'clean',
            payload.category,
            payload.cspCategory,
            payload.source,
            payload.input,
            sanitized
        ]);
    }

    return rows;
}

const HEADER = ['id', 'description', 'type', 'category', 'cspCategory', 'source', 'input', 'sanitizedOutput'];

fs.mkdirSync(OUT_DIR, { recursive: true });

const rows = buildRows();
const lines = [
    HEADER.map(csvField).join(','),
    ...rows.map(row => row.map(csvField).join(','))
];

fs.writeFileSync(OUT_PATH, lines.join('\n') + '\n', 'utf-8');

console.log(`Wrote ${rows.length} rows to ${OUT_PATH}`);
