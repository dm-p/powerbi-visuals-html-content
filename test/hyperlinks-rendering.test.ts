import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';
import { HYPERLINKS_PAYLOADS } from './fixtures/hyperlinks';
import type { HyperlinksPayload } from '../test-integration/csp-harness/corpus';
import { parseCsvRecords } from './helpers/parse-csv-records';

/**
 * Regression suite for the hyperlinks-enabled UAT fixtures.
 *
 * Mirrors `lorem-rendering.test.ts`: each fixture is run through the
 * production sanitizer (with that fixture's `sanitizeOptions`, which
 * by contract sets `{ allowHyperlinks: true }`) and asserted against
 * its `expectedSanitized` substring assertions. A second block
 * verifies that `test-uat/hyperlinks.csv` is in lockstep with the
 * source array — if either drifts (a CSV row deleted by hand, an
 * array entry added without re-running `npm run uat:generate`), this
 * suite fails so the divergence cannot land silently.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HYPERLINKS_CSV_PATH = path.resolve(
    __dirname,
    '..',
    'test-uat',
    'hyperlinks.csv'
);

describe('hyperlinks fixtures — sanitized output', () => {
    // Annotated tuple type so `payload` is narrowed to HyperlinksPayload
    // inside the callback rather than `string | HyperlinksPayload`.
    it.each(
        HYPERLINKS_PAYLOADS.map((p): [string, HyperlinksPayload] => [p.id, p])
    )('%s preserves expected substrings', (_id, payload) => {
        // Every entry in this array must opt in to allowHyperlinks: true —
        // that's the whole point of the fixture set. Assert it loudly
        // rather than silently honoring `undefined` (which would
        // fall-closed to allowHyperlinks: false and confuse the
        // substring assertions below).
        expect(
            payload.sanitizeOptions?.allowHyperlinks,
            `${payload.id} must set sanitizeOptions.allowHyperlinks: true`
        ).toBe(true);

        const out = getSanitizedHtmlForTesting(
            payload.input,
            'html',
            payload.sanitizeOptions
        );
        for (const needle of payload.expectedSanitized.contains ?? []) {
            expect(out).toContain(needle);
        }
        for (const forbidden of payload.expectedSanitized.notContains ?? []) {
            expect(out).not.toContain(forbidden);
        }
    });
});

describe('hyperlinks fixtures — CSV sync', () => {
    // Read once. If the file is missing, the existsSync test fails first
    // with a clean message and the dependent tests skip via undefined
    // guards rather than throwing ENOENT with a confusing stack trace.
    let csvText: string | undefined;
    let csvDataRows: string[] | undefined;

    beforeAll(() => {
        if (fs.existsSync(HYPERLINKS_CSV_PATH)) {
            csvText = fs.readFileSync(HYPERLINKS_CSV_PATH, 'utf-8');
            csvDataRows = parseCsvRecords(csvText).slice(1);
        }
    });

    it('test-uat/hyperlinks.csv exists', () => {
        expect(fs.existsSync(HYPERLINKS_CSV_PATH)).toBe(true);
    });

    it('row count matches HYPERLINKS_PAYLOADS length', () => {
        if (!csvDataRows) {
            expect(fs.existsSync(HYPERLINKS_CSV_PATH)).toBe(true);
            return;
        }
        expect(csvDataRows.length).toBe(HYPERLINKS_PAYLOADS.length);
    });

    it('first column of every data row matches a fixture id in order', () => {
        if (!csvDataRows) {
            expect(fs.existsSync(HYPERLINKS_CSV_PATH)).toBe(true);
            return;
        }
        // Full-array equality (rather than per-index loop) catches
        // same-count reorders that would otherwise pass silently.
        const csvIds = csvDataRows.map((row) => row.split(',', 1)[0]);
        const fixtureIds = HYPERLINKS_PAYLOADS.map((p) => p.id);
        expect(csvIds).toEqual(fixtureIds);
    });

    // Guard tests mirroring lorem-rendering.test.ts. Defend the
    // `split(',', 1)[0]` shortcut used to extract the id column above —
    // it is safe only when fixture ids contain no commas or quotes,
    // and would silently misbehave if a maintainer ever added one.
    it('every fixture id is unique', () => {
        const ids = HYPERLINKS_PAYLOADS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every fixture id is comma- and quote-free', () => {
        for (const payload of HYPERLINKS_PAYLOADS) {
            expect(payload.id).not.toContain(',');
            expect(payload.id).not.toContain('"');
        }
    });
});
