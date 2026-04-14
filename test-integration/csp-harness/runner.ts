import { Page, BrowserContext } from '@playwright/test';
import * as path from 'path';
import { pathToFileURL } from 'url';

/**
 * The CSP applied to the sandbox fixture, mirroring the real Power BI
 * custom-visual CSP captured empirically from powerbi.com (Kaspersky
 * sources stripped). Kept in sync with
 * test-integration/csp-harness/fixtures/sandbox.html and csp-policy.md.
 *
 * UPDATE PROCESS: see csp-policy.md "Update process" section.
 *
 * Note on permissiveness: this policy is deliberately loose because the
 * real Power BI sandbox is loose — it allows https://app.powerbi.com,
 * data:, and blob: broadly, with 'unsafe-inline' and 'unsafe-eval'
 * everywhere. Under this CSP, many malicious payloads will fail with
 * console errors (e.g. net::ERR_INVALID_URL for malformed data: URIs)
 * rather than with securitypolicyviolation events. The fixture listens
 * to both signals — either is treated as a cert failure.
 */
export const POWER_BI_VISUAL_CSP = [
    "default-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval'",
    "script-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval'",
    "style-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval'",
    "img-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval'",
    "connect-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval'",
    "child-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval'"
].join('; ') + ';';

export interface CspViolation {
    blockedURI: string;
    violatedDirective: string;
    effectiveDirective: string;
    sourceFile: string;
    lineNumber: number;
    columnNumber: number;
    sample: string;
}

export interface RenderResult {
    violations: CspViolation[];
    consoleErrors: string[];
    consoleWarnings: string[];
    pageErrors: string[];
    networkRequests: string[];
}

const SANDBOX_FIXTURE = pathToFileURL(
    path.resolve(__dirname, 'fixtures', 'sandbox.html')
).toString();

/**
 * Load the sandbox fixture into the page, install Playwright-level listeners,
 * and return a function that renders a payload and collects all observed
 * violations / errors / network requests.
 */
export async function createHarness(page: Page, context: BrowserContext) {
    const pageErrors: string[] = [];
    const networkRequests: string[] = [];

    page.on('pageerror', (err) => {
        pageErrors.push(err.message);
    });

    context.on('request', (request) => {
        const reqUrl = request.url();
        // Allow the sandbox fixture itself and about:blank.
        if (reqUrl === SANDBOX_FIXTURE || reqUrl === 'about:blank') return;
        // data: URIs do not generate network traffic — Playwright still
        // surfaces them as requests; we ignore them because CSP allows
        // data: img-src.
        if (reqUrl.startsWith('data:')) return;
        // Chromium automatically probes /favicon.ico on top-level file://
        // navigations. It has nothing to do with the sanitized payload and
        // would produce a false positive on every first render.
        if (reqUrl.endsWith('/favicon.ico')) return;
        networkRequests.push(reqUrl);
    });

    await page.goto(SANDBOX_FIXTURE);

    return {
        async render(html: string): Promise<RenderResult> {
            await page.evaluate(() => (window as any).__reset());
            // Reset Playwright-side accumulators
            pageErrors.length = 0;
            networkRequests.length = 0;

            await page.evaluate((payload) => {
                return (window as any).__renderPayload(payload);
            }, html);

            const collected = await page.evaluate(() => ({
                violations: (window as any).__violations,
                consoleErrors: (window as any).__consoleErrors,
                consoleWarnings: (window as any).__consoleWarnings
            }));

            return {
                violations: collected.violations || [],
                consoleErrors: collected.consoleErrors || [],
                consoleWarnings: collected.consoleWarnings || [],
                pageErrors: [...pageErrors],
                networkRequests: [...networkRequests]
            };
        }
    };
}

/**
 * Format a RenderResult as a human-readable failure message for test
 * assertions.
 */
export function formatFailure(payloadId: string, result: RenderResult): string {
    const lines: string[] = [`Payload "${payloadId}" produced unsafe output:`];
    if (result.violations.length) {
        lines.push(`  CSP violations (${result.violations.length}):`);
        for (const v of result.violations) {
            lines.push(`    - ${v.violatedDirective} blocked ${v.blockedURI}`);
        }
    }
    if (result.consoleErrors.length) {
        lines.push(`  Console errors (${result.consoleErrors.length}):`);
        for (const e of result.consoleErrors) lines.push(`    - ${e}`);
    }
    if (result.consoleWarnings.length) {
        lines.push(`  Console warnings (${result.consoleWarnings.length}):`);
        for (const w of result.consoleWarnings) lines.push(`    - ${w}`);
    }
    if (result.pageErrors.length) {
        lines.push(`  Page errors (${result.pageErrors.length}):`);
        for (const e of result.pageErrors) lines.push(`    - ${e}`);
    }
    if (result.networkRequests.length) {
        lines.push(`  Outbound network requests (${result.networkRequests.length}):`);
        for (const u of result.networkRequests) lines.push(`    - ${u}`);
    }
    return lines.join('\n');
}
