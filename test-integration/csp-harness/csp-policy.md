# Power BI Custom Visual CSP — Replica Reference

## Purpose

This file documents the Content Security Policy and iframe sandbox attributes
that the Playwright integration harness uses to simulate the Power BI certified-
visual environment. The harness is the contract — if a sanitized payload triggers
zero `securitypolicyviolation` events here, it should pass MS certification.

## Empirical CSP (from live powerbi.com inspection)

**Source:** Browser DevTools → Network tab → visual iframe response headers
**Date last checked:** 2026-03-07 (DM-P)

**How to reproduce:**

1. Open powerbi.com, sign in.
2. Open any report containing a custom visual (ideally a certified one, e.g.
   the published `powerbi-visuals-html-content` visual itself once re-certified,
   or any other certified visual from AppSource).
3. Open DevTools → Network → filter for the visual iframe URL (look for an
   iframe served from a `*.powerbi.com` or `*.analysis.windows.net` sandbox
   host).
4. Inspect Response Headers → copy the full `Content-Security-Policy` value.
5. In the Elements panel, locate the `<iframe>` element that hosts the visual
   and copy its `sandbox` attribute value verbatim.
6. Paste both below, replacing the placeholder block, and update the
   "Date last checked" line above.

Observed CSP (one directive per line for readability — real header is a
single-line value with `;` separators). Browser-environment noise (antivirus
injected sources such as `*.kaspersky-labs.com`) has been stripped so the
record is reproducible on any machine:

```text
default-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
script-src  https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
style-src   https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
img-src     https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
connect-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
child-src   https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
```

Observed sandbox attributes:

```text
allow-scripts
```

Notes on the empirical policy:

-   There is **no** `font-src`, `object-src`, `base-uri`, `form-action`, or
    `frame-src` directive — each of these falls back to `default-src`, which
    allows `https://app.powerbi.com`, `data:`, `blob:`, and the two inline
    keywords. `child-src` (deprecated in CSP3 but still honored by Chromium)
    is used instead of `frame-src`/`worker-src`.
-   The sandbox has `allow-scripts` but **not** `allow-same-origin`, so the
    visual runs in a null-origin sandbox in production.
-   `'unsafe-inline' 'unsafe-eval'` appear in `img-src`, `connect-src`, and
    `style-src` where they have no effect — these keywords are only meaningful
    for `script-src` and `style-src`. Harmless but cosmetically noisy; we
    mirror it verbatim for fidelity.
-   The sources removed during cleanup were `https://me.kis.v2.scr.kaspersky-labs.com`
    and `wss://me.kis.v2.scr.kaspersky-labs.com`, appearing in `connect-src`,
    `script-src`, `img-src`, `child-src`, and `style-src`. These are injected
    by the maintainer's local Kaspersky installation and are not part of the
    real Power BI policy.

**Harness signal implications:** the empirical policy is much more permissive
than a strict-null replica. Under this CSP, many malicious payloads will
**not** trigger a `securitypolicyviolation` event — they'll surface as
`console.error` entries instead (e.g. `net::ERR_INVALID_URL` for a malformed
`data:` URI). The fixture listens to both signals; both are treated as cert
failures. The corpus should not be tuned to "prefer CSP violations" over
"console errors" — either one means the sanitizer missed something.

This step cannot be scripted from this repository because it requires a
logged-in powerbi.com session. It is a manual pre-flight for the harness.

## Replica policy (what the harness uses)

The harness mirrors the empirical policy captured above, with Kaspersky
sources stripped. This is Option A from the design brainstorm (best-effort
replica) rather than a stricter-superset defensive baseline: false positives
would be more expensive than they're worth during a cert resubmission cycle.

**CSP:**

> **Serialization note:** the directives below are one-per-line for
> readability. When pasted into an HTTP header value or a
> `<meta http-equiv="Content-Security-Policy" content="...">` attribute,
> join them with single spaces. The `POWER_BI_VISUAL_CSP` constant in
> `test-integration/csp-harness/runner.ts` is the canonical serialized form.

```text
default-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
script-src  https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
style-src   https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
img-src     https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
connect-src https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
child-src   https://app.powerbi.com data: blob: 'unsafe-inline' 'unsafe-eval';
```

**Sandbox attributes:**

```text
allow-scripts
```

> **Sandbox-attribute caveat:** the harness fixture is loaded as a top-level
> page under Playwright, not inside a parent iframe. Iframe `sandbox`
> attributes can only be applied by a parent document, so this value is
> **documented but not enforced** by the current harness. The main signal
> (CSP violations + console errors) does not depend on sandbox enforcement
> to catch what we care about. If a future finding turns out to depend on
> sandbox enforcement specifically, the fixture would need to be restructured
> so Playwright loads a wrapper page that embeds the sanitized-content
> document in an iframe with this sandbox attribute.

### What this replica catches and what it doesn't

**Caught via `securitypolicyviolation` events:**

-   Any outbound request to a host other than `https://app.powerbi.com` —
    e.g. `<img src="https://attacker.example/x.png">`, `<link href="https://…">`,
    `url(https://…)` in CSS, `@import url(https://…)`, etc.
-   `blob:` URLs pointing at foreign origins (if such a thing is constructed).
-   `javascript:` URLs in href/src attributes — `script-src` doesn't allow
    inline javascript protocol URLs.

**Caught via `console.error` / `pageerror` events:**

-   Malformed URIs like `data:1234***qwerty` — browser emits
    `net::ERR_INVALID_URL` even though the URI is nominally allowed by the
    permissive `data:` source.
-   Invalid CSS expressions, malformed HTML parse errors, etc.
-   **This is the signal that caught the original MS cert finding** — the
    empirical CSP permits `data:` in `img-src`, so a CSP violation would not
    have fired for the reported payload. The cert review rejected it on the
    console error alone.

**Not caught by the harness (and shouldn't be):**

-   Allowed `data:image/png;base64,...` content — legitimate images.
-   Allowed `https://app.powerbi.com` requests — same-origin is permitted.
-   Inline scripts via `<script>` tags — `'unsafe-inline'` is in force.
    (These should still be rejected by the sanitizer because the allowed-tag
    list blocks `<script>` at the HTML layer, but the _CSP_ would permit them
    if they got through.)

The sanitizer's job is strictly broader than what this CSP catches, so the
corpus includes payloads (e.g. `<script>` tags, event handlers) whose
harness signal is "the sanitized output has no `<script>` substring and no
CSP/console events fire because nothing executes". That's still a valid
test — the fixture assertion covers both "nothing bad got through" and
"nothing bad was executed".

## Update process

-   **Quarterly:** review published MS docs for CSP changes. **Bump the
    "Date last checked" line above even if no changes were found** — a stale
    date makes this whole file harder to trust.
-   **Before every cert submission:** re-run the empirical inspection above and
    diff against the policy in `runner.ts` (`POWER_BI_VISUAL_CSP` constant). If
    they differ, update both the constant and this file, and re-run
    `npm run test:integration` and `npm run cert-check`.
-   **When this file changes:** update the `POWER_BI_VISUAL_CSP` constant in
    `test-integration/csp-harness/runner.ts` to match.
