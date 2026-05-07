import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';
import { LOREM_PAYLOADS } from './fixtures/lorem';

/**
 * Regression suite for the lorem rich-text fixtures.
 *
 * Each fixture is run through the production sanitizer and asserted
 * against its `expectedSanitized` substring assertions. A second block
 * verifies that `test-uat/lorem.csv` is in lockstep with the source
 * array — if either drifts (a CSV row deleted by hand, an array entry
 * added without re-running `npm run uat:generate`), this suite fails so
 * the divergence cannot land silently.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOREM_CSV_PATH = path.resolve(__dirname, '..', 'test-uat', 'lorem.csv');

describe('lorem fixtures — sanitized output', () => {
    it.each(LOREM_PAYLOADS.map(p => [p.id, p]))(
        '%s preserves expected substrings',
        (_id, payload) => {
            const out = getSanitizedHtmlForTesting(payload.input, 'html');
            for (const needle of payload.expectedSanitized.contains ?? []) {
                expect(out).toContain(needle);
            }
            for (const forbidden of payload.expectedSanitized.notContains ?? []) {
                expect(out).not.toContain(forbidden);
            }
        }
    );
});

describe('lorem fixtures — CSV sync', () => {
    it('test-uat/lorem.csv exists', () => {
        expect(fs.existsSync(LOREM_CSV_PATH)).toBe(true);
    });

    it('row count matches LOREM_PAYLOADS length', () => {
        const csv = fs.readFileSync(LOREM_CSV_PATH, 'utf-8');
        // Subtract 1 for the header. Trailing newline produces an empty
        // final element, so filter empties before counting.
        const dataRows = csv.split('\n').slice(1).filter(line => line.length > 0);
        expect(dataRows.length).toBe(LOREM_PAYLOADS.length);
    });

    it('first column of every data row matches a fixture id in order', () => {
        const csv = fs.readFileSync(LOREM_CSV_PATH, 'utf-8');
        const dataRows = csv.split('\n').slice(1).filter(line => line.length > 0);
        const csvIds = dataRows.map(line => {
            // The id is the first comma-separated field. Lorem ids never
            // contain commas or quotes, so a simple split is safe here —
            // do not generalise this to other CSV columns.
            return line.split(',', 1)[0];
        });
        expect(csvIds).toEqual(LOREM_PAYLOADS.map(p => p.id));
    });

    it('every fixture id is unique', () => {
        const ids = LOREM_PAYLOADS.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
