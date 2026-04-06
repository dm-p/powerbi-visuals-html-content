# Power BI Custom Visual CSP — Replica Reference

## Purpose

This file documents the Content Security Policy and iframe sandbox attributes
that the Playwright integration harness uses to simulate the Power BI certified-
visual environment. The harness is the contract — if a sanitized payload triggers
zero `securitypolicyviolation` events here, it should pass MS certification.

## Published CSP (from Microsoft documentation)

**Sources consulted:**

- https://learn.microsoft.com/en-us/power-bi/developer/visuals/custom-visual-develop-tutorial (returned HTTP 404 — page no longer exists)
- https://learn.microsoft.com/en-us/power-bi/developer/visuals/develop-power-bi-visuals (fetched successfully — overview page only, no CSP or sandbox information)
- https://learn.microsoft.com/en-us/power-bi/developer/visuals/power-bi-custom-visuals-faq (fetched successfully — certification/organizational FAQ, no CSP or sandbox information)
- https://learn.microsoft.com/en-us/power-bi/developer/visuals/sandbox-environment (redirected to `develop-circle-card` tutorial — no CSP or sandbox attribute text found)

**Date last checked:** 2026-04-07

**Finding:** Microsoft's published documentation does not specify a concrete
Content Security Policy for custom visuals as of this date. None of the four
pages above contain a `Content-Security-Policy` header value, a list of CSP
directives, or an enumeration of the iframe `sandbox` token set applied to
certified visuals in production. The certification FAQ describes the review
process (code review, static analysis, XSS testing, data-leakage checks) but
does not publish the runtime CSP that enforces those requirements.

The Replica policy below is a strict-superset starting point; empirical
inspection of the live powerbi.com iframe headers is required before first
harness run and must be captured in the "Empirical CSP" section below by the
repository maintainer.

## Empirical CSP (from live powerbi.com inspection)

**Source:** Browser DevTools → Network tab → visual iframe response headers
**Date last checked:** _TBD — not yet captured_
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

> ⚠ **PLACEHOLDER — NOT YET CAPTURED.** Do not treat the harness as a
> certification gate until these values are filled in by a maintainer with
> a logged-in powerbi.com session.

```text
<PLACEHOLDER — maintainer must paste the observed CSP header here>
<PLACEHOLDER — maintainer must paste the observed sandbox attribute here>
```

This step cannot be scripted from this repository because it requires a
logged-in powerbi.com session. It is a manual pre-flight for the harness.

## Replica policy (what the harness uses)

The harness uses the **stricter** of published vs empirical wherever they differ.
Until the empirical values are captured, the harness uses the strict-superset
starting point below — chosen to exercise every directive the sanitizer in
`src/domPurify.ts` could plausibly trip over.

**CSP:**

> **Serialization note:** the directives below are one-per-line for
> readability. When pasted into an HTTP header value or a
> `<meta http-equiv="Content-Security-Policy" content="...">` attribute,
> join them with single spaces. The `POWER_BI_VISUAL_CSP` constant in
> `test-integration/csp-harness/runner.ts` is the canonical serialized form.

```text
default-src 'none';
script-src 'unsafe-inline' 'unsafe-eval';
style-src 'unsafe-inline';
img-src data:;
font-src 'none';
connect-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
```

**Sandbox attributes:**

```
allow-scripts allow-same-origin
```

Rationale for the starting point:

- `default-src 'none'` — deny-by-default; any resource type not explicitly
  allowed below is blocked and will emit a `securitypolicyviolation` event.
- `script-src 'unsafe-inline' 'unsafe-eval'` — Power BI visuals historically
  execute inline script and use `eval`-like constructs (D3, templating). The
  HTML-content visual specifically runs inline `<script>` blocks from the
  sanitized payload, so the replica must permit them to match production.
- `style-src 'unsafe-inline'` — inline `style="..."` attributes and `<style>`
  blocks are the primary styling vector for HTML content payloads.
- `img-src data:` — base64 data URIs are the only image source the sanitizer
  currently allows (see `allowedSchemes` in `src/domPurify.ts`); `http(s):` is
  deliberately excluded to catch regressions.
- `font-src 'none'`, `connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`,
  `base-uri 'none'`, `form-action 'none'` — close every remaining exfiltration
  and navigation vector. If a sanitized payload somehow smuggles in a
  `<link rel="stylesheet" href="http://evil">`, a fetch, a nested iframe, an
  `<object>`, a `<base href>`, or a form POST, the harness will surface it as
  a violation.

## Update process

- **Quarterly:** review published MS docs for CSP changes. **Bump the
  "Date last checked" line above even if no changes were found** — a stale
  date makes this whole file harder to trust.
- **Before every cert submission:** re-run the empirical inspection above and
  diff against the policy in `runner.ts` (`POWER_BI_VISUAL_CSP` constant). If
  they differ, update both the constant and this file, and re-run
  `npm run test:integration` and `npm run cert-check`.
- **When this file changes:** update the `POWER_BI_VISUAL_CSP` constant in
  `test-integration/csp-harness/runner.ts` to match.
