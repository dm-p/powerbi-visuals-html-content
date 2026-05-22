import './setup-dom';
import { test, expect } from '@playwright/test';
import { createHarness, formatFailure, RenderResult } from './csp-harness/runner';
import { MALICIOUS_PAYLOADS, CLEAN_PAYLOADS } from './csp-harness/corpus';
import { LOREM_PAYLOADS } from '../test/fixtures/lorem';
import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';

// Sanity: assert ids are unique across all corpus arrays (sanitization
// + lorem). Catches copy-paste duplicates that the corpus's structural
// type checking can't. Includes LOREM_PAYLOADS so a `lorem-foo` id
// can't collide with a malicious or clean entry, per the rule
// documented in test/fixtures/lorem.ts.
const allIds = [
    ...MALICIOUS_PAYLOADS,
    ...CLEAN_PAYLOADS,
    ...LOREM_PAYLOADS
].map(p => p.id);
const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
if (dupes.length > 0) {
    throw new Error(`Duplicate payload ids in corpus: ${dupes.join(', ')}`);
}

function expectClean(payloadId: string, result: RenderResult) {
    const failure = formatFailure(payloadId, result);
    expect(result.violations, failure).toHaveLength(0);
    expect(result.consoleErrors, failure).toHaveLength(0);
    expect(result.consoleWarnings, failure).toHaveLength(0);
    expect(result.pageErrors, failure).toHaveLength(0);
    expect(result.networkRequests, failure).toHaveLength(0);
}

test.describe('CSP regression — malicious payloads', () => {
    for (const payload of MALICIOUS_PAYLOADS) {
        test(`payload ${payload.id}: ${payload.description}`, async ({ page, context }) => {
            const harness = await createHarness(page, context);
            // Honor the payload's optional sanitizeOptions so toggle-on
            // entries exercise the allowHyperlinks=true path through the
            // CSP sandbox. Default (undefined) keeps the harness at the
            // fail-closed posture matching production defaults.
            const sanitized = getSanitizedHtmlForTesting(
                payload.input,
                'html',
                payload.sanitizeOptions
            );

            if (payload.expectedSanitized.notContains) {
                for (const needle of payload.expectedSanitized.notContains) {
                    expect(sanitized, `payload ${payload.id} sanitizer string check`)
                        .not.toContain(needle);
                }
            }
            if (payload.expectedSanitized.contains) {
                for (const needle of payload.expectedSanitized.contains) {
                    expect(sanitized, `payload ${payload.id} sanitizer string check`)
                        .toContain(needle);
                }
            }

            const result = await harness.render(sanitized);
            expectClean(payload.id, result);
        });
    }
});

test.describe('CSP regression — clean baselines', () => {
    for (const payload of CLEAN_PAYLOADS) {
        test(`baseline ${payload.id}: ${payload.description}`, async ({ page, context }) => {
            const harness = await createHarness(page, context);
            // Honor the payload's optional sanitizeOptions so toggle-on
            // entries exercise the allowHyperlinks=true path through the
            // CSP sandbox. Default (undefined) keeps the harness at the
            // fail-closed posture matching production defaults.
            const sanitized = getSanitizedHtmlForTesting(
                payload.input,
                'html',
                payload.sanitizeOptions
            );

            if (payload.expectedSanitized.notContains) {
                for (const needle of payload.expectedSanitized.notContains) {
                    expect(sanitized).not.toContain(needle);
                }
            }
            if (payload.expectedSanitized.contains) {
                for (const needle of payload.expectedSanitized.contains) {
                    expect(sanitized).toContain(needle);
                }
            }

            const result = await harness.render(sanitized);
            expectClean(payload.id, result);
        });
    }
});
