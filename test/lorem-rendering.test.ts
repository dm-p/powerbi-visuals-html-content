import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';
import { LOREM_PAYLOADS } from './fixtures/lorem';
import type { LoremPayload } from '../test-integration/csp-harness/corpus';
import { parseCsvRecords } from './helpers/parse-csv-records';

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
    // Annotated tuple type so `payload` is narrowed to LoremPayload
    // inside the callback rather than `string | LoremPayload`.
    it.each(LOREM_PAYLOADS.map((p): [string, LoremPayload] => [p.id, p]))(
        '%s preserves expected substrings',
        (_id, payload) => {
            // Lorem fixtures document sanitizer output for the
            // hyperlinks-enabled case (toggle ON). With the toggle
            // OFF — the new fail-closed default — <a href> is stripped,
            // which would invalidate every `<a href="...">` substring
            // assertion in the corpus. Opt in explicitly here.
            const out = getSanitizedHtmlForTesting(payload.input, 'html', {
                allowHyperlinks: true
            });
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
    // Read once. If the file is missing, the existsSync test fails first
    // with a clean message and the dependent tests skip via undefined
    // guards rather than throwing ENOENT with a confusing stack trace.
    let csvText: string | undefined;
    let csvDataRows: string[] | undefined;

    beforeAll(() => {
        if (fs.existsSync(LOREM_CSV_PATH)) {
            csvText = fs.readFileSync(LOREM_CSV_PATH, 'utf-8');
            // Parse RFC 4180 records. Quoted fields may contain embedded
            // newlines (the sanitized-output column is multi-line CSS for
            // fixtures like reporter-cards that round-trip through postcss),
            // so a naive split on \n mis-counts records. We only need the
            // first field of each data record for the assertions below, so
            // we read just enough to find each record boundary.
            csvDataRows = parseCsvRecords(csvText).slice(1);
        }
    });

    it('test-uat/lorem.csv exists', () => {
        expect(fs.existsSync(LOREM_CSV_PATH)).toBe(true);
    });

    it('row count matches LOREM_PAYLOADS length', () => {
        if (!csvDataRows) {
            // existsSync test above already failed; skip with a clear
            // assertion rather than throwing on undefined.
            expect(fs.existsSync(LOREM_CSV_PATH)).toBe(true);
            return;
        }
        expect(csvDataRows.length).toBe(LOREM_PAYLOADS.length);
    });

    it('first column of every data row matches a fixture id in order', () => {
        if (!csvDataRows) {
            expect(fs.existsSync(LOREM_CSV_PATH)).toBe(true);
            return;
        }
        const csvIds = csvDataRows.map(line => {
            // The id is the first comma-separated field. Lorem ids never
            // contain commas or quotes (enforced below), so a simple
            // split is safe here — do not generalise this to other CSV
            // columns.
            return line.split(',', 1)[0];
        });
        expect(csvIds).toEqual(LOREM_PAYLOADS.map(p => p.id));
    });

    it('every fixture id is unique', () => {
        const ids = LOREM_PAYLOADS.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every fixture id is comma- and quote-free (defends the naive split)', () => {
        // Backstop for the simple-split id extraction above. If a future
        // fixture id contains a comma or quote, the row-id assertion
        // would silently miscount; this assertion fails immediately.
        for (const p of LOREM_PAYLOADS) {
            expect(p.id).not.toContain(',');
            expect(p.id).not.toContain('"');
        }
    });
});
