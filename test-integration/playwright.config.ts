import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: '**/*.spec.ts',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    // No retries: this is a deterministic security suite. A failing payload
    // must surface immediately, not be masked by a lucky retry.
    retries: 0,
    workers: 1,
    // Fail fast on pathological payloads so a single stuck test does not
    // consume the full default 30s before pointing the finger.
    timeout: 10_000,
    expect: {
        timeout: 5_000
    },
    reporter: process.env.CI ? [['github'], ['list']] : 'list',
    use: {
        baseURL: 'about:blank',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ]
});
