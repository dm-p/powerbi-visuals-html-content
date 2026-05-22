import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    getSanitizedCss,
    getSanitizedHtmlForTesting
} from '../src/sanitize-pipeline';
import {
    STYLESHEET_PAYLOADS,
    StylesheetScenario
} from './fixtures/stylesheet-scenarios';
import { parseCsvRecords } from './helpers/parse-csv-records';

/**
 * Regression suite for the custom-stylesheet UAT fixtures.
 *
 * The visual's Custom stylesheet setting is sanitization surface 3
 * (per docs/sanitization-rules.md). It shares the postcss-based
 * `sanitizeCss(..., 'stylesheet')` code path with surface 2 (<style>
 * tag in data) but reaches the DOM via a different injection point —
 * `<style id="visualUserStylesheet">` in the page <head>, written by
 * resolveStyling in domain-utils.ts. The body-styling cascade override
 * (issue #144) is also gated on whether this surface is supplied.
 *
 * This suite asserts:
 *   1. Each scenario's CSS survives `getSanitizedCss` with the expected
 *      contains / notContains substrings (mirrors what the visual will
 *      paste into <head> when the operator copies cssInput into the
 *      format pane).
 *   2. Each scenario's HTML survives `getSanitizedHtmlForTesting`
 *      cleanly — no scenario should rely on dangerous HTML.
 *   3. `test-uat/stylesheet.csv` is in lockstep with STYLESHEET_PAYLOADS
 *      (same row count, same id order). Catches drift if the CSV is
 *      hand-edited or a fixture is added without re-running uat:generate.
 *   4. Every fixture id is unique within STYLESHEET_PAYLOADS, starts
 *      with `style-`, and is comma- and quote-free (defends the naive
 *      first-column id split below).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STYLESHEET_CSV_PATH = path.resolve(
    __dirname,
    '..',
    'test-uat',
    'stylesheet.csv'
);

describe('stylesheet UAT fixtures — sanitization', () => {
    it.each(
        STYLESHEET_PAYLOADS.map((p): [string, StylesheetScenario] => [p.id, p])
    )('%s — CSS survives getSanitizedCss with expected substrings', (_id, scenario) => {
        const sanitizedCss = getSanitizedCss(scenario.cssInput);
        for (const needle of scenario.cssExpectedSanitized.contains ?? []) {
            expect(sanitizedCss).toContain(needle);
        }
        for (const forbidden of scenario.cssExpectedSanitized.notContains ?? []) {
            expect(sanitizedCss).not.toContain(forbidden);
        }
    });

    it.each(
        STYLESHEET_PAYLOADS.map((p): [string, StylesheetScenario] => [p.id, p])
    )('%s — HTML survives getSanitizedHtmlForTesting without throwing', (_id, scenario) => {
        // Loose assertion: every scenario's HTML must round-trip
        // through the sanitizer cleanly. The CSS is the load-bearing
        // surface here; the HTML is just a host for the CSS rule to
        // apply to. Ensures we don't accidentally ship a scenario with
        // an HTML payload that itself trips the sanitizer.
        expect(() =>
            getSanitizedHtmlForTesting(scenario.htmlInput, 'html')
        ).not.toThrow();
    });
});

describe('stylesheet UAT fixtures — fixture hygiene', () => {
    it('every id is unique within STYLESHEET_PAYLOADS', () => {
        const ids = STYLESHEET_PAYLOADS.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every id starts with the `style-` prefix', () => {
        for (const p of STYLESHEET_PAYLOADS) {
            expect(p.id.startsWith('style-')).toBe(true);
        }
    });

    it('every id is comma- and quote-free (defends the naive csv split)', () => {
        for (const p of STYLESHEET_PAYLOADS) {
            expect(p.id).not.toContain(',');
            expect(p.id).not.toContain('"');
        }
    });
});

describe('stylesheet UAT fixtures — CSV sync', () => {
    let csvText: string | undefined;
    let csvDataRows: string[] | undefined;

    beforeAll(() => {
        if (fs.existsSync(STYLESHEET_CSV_PATH)) {
            csvText = fs.readFileSync(STYLESHEET_CSV_PATH, 'utf-8');
            csvDataRows = parseCsvRecords(csvText).slice(1);
        }
    });

    it('test-uat/stylesheet.csv exists', () => {
        expect(fs.existsSync(STYLESHEET_CSV_PATH)).toBe(true);
    });

    it('row count matches STYLESHEET_PAYLOADS length', () => {
        if (!csvDataRows) {
            expect(fs.existsSync(STYLESHEET_CSV_PATH)).toBe(true);
            return;
        }
        expect(csvDataRows.length).toBe(STYLESHEET_PAYLOADS.length);
    });

    it('first column of every data row matches a fixture id in order', () => {
        if (!csvDataRows) {
            expect(fs.existsSync(STYLESHEET_CSV_PATH)).toBe(true);
            return;
        }
        const csvIds = csvDataRows.map(line => line.split(',', 1)[0]);
        expect(csvIds).toEqual(STYLESHEET_PAYLOADS.map(p => p.id));
    });
});
