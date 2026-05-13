---
title: Fail-closed on malformed percent-encoded data:image/svg+xml payloads
date: 2026-05-11
category: security-issues
module: powerbi-visuals-html-content
problem_type: security_issue
component: tooling
severity: high
symptoms:
  - "decodeSvgDataUriPayload returned the raw, still-percent-encoded payload string when decodeURIComponent threw"
  - "An attacker payload like `data:image/svg+xml;utf8,%3Cscript%3Ealert(1)%3C/script%3E%GG` slipped past hasDangerousSvgPayload's `/<script\\b/i` check because the regex sees `%3Cscript%3E`, not `<script>`"
  - "Sandbox-weak surfaces (older WebView2, mobile renderers, export-to-PDF) would still percent-decode and execute the inner script, while the sanitizer reported the payload as clean"
  - "Asymmetric base64 vs percent-decode failure handling — base64 branch already returned null on atob failure, percent branch did not"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - testing_framework
tags:
  - sanitization
  - svg
  - data-uri
  - percent-encoding
  - fail-closed
  - security-review
  - bypass
  - decoder-scanner-asymmetry
---

# Fail-closed on malformed percent-encoded data:image/svg+xml payloads

## Problem

`decodeSvgDataUriPayload` in [src/svg-payload-scan.ts](../../../src/svg-payload-scan.ts) is the single decode point that feeds the SVG content scanner (`hasDangerousSvgPayload`) and through it the upstream gate in [src/sanitize-pipeline.ts:752](../../../src/sanitize-pipeline.ts#L752). Its `try { decodeURIComponent(payload) } catch { return payload }` fallback returned the raw, still-encoded string on malformed `%XX` input. The downstream regex scan (`/<script\b/i`, `/<foreignObject\b/i`, `on*=` boundary check, etc.) does not percent-decode — so an attacker-supplied payload with a single trailing `%GG` could carry `%3Cscript%3E…%3C/script%3E` past every check, while a sandbox-weak rendering surface that does decode would execute the inner script.

## Symptoms

- `data:image/svg+xml;utf8,%3Cscript%3Ealert(1)%3C/script%3E%GG` and the equivalent `…%3Conload%3D…%GG` form pass `hasDangerousSvgPayload` despite carrying live script / event-handler content
- The base64 branch behaved correctly (`atob` failure → `return null` → caller rejects); the percent-decode branch silently widened the trust boundary
- No reporter-facing symptom — the bypass was found by a defense-in-depth security review of the sanitizer that landed earlier on this branch

## What Didn't Work

The pre-fix rationale for "catch → return raw payload" was a misread of the failure mode. Two assumptions were wrong:

1. **"DAX measures emit `data:image/svg+xml,<svg>...</svg>` with literal angle brackets and the catch must keep that path working."** False. `decodeURIComponent` is a no-op on unencoded ASCII; literal `<`, `>`, `=`, `'`, `"` decode cleanly without ever throwing. The `catch` block fires only on malformed `%XX` sequences, never on the DAX form. The "fallback to raw for DAX" branch was unreachable on legitimate input — its only customers were attackers.

2. **"Returning the raw payload at least gives the regex something to scan."** True for unencoded literal `<script>`. False for percent-encoded `%3Cscript%3E`, which is the form an attacker uses precisely *because* it bypasses string-literal regex scans. The decoder and the scanner have to agree on the post-decode shape; if they disagree, asymmetry equals bypass.

A test in [test/svg-payload-scan.test.ts](../../../test/svg-payload-scan.test.ts) was actively documenting the broken behavior — it asserted the function "falls back to raw payload when decodeURIComponent throws (literal angle brackets — DAX form)" using `<svg ...>%ZZ</svg>` and expected `out` to contain `%ZZ`. The fixture itself was malformed (mixed literal angles with a stray `%`), masking the contract gap.

## Solution

Three-line change in [src/svg-payload-scan.ts:88-91](../../../src/svg-payload-scan.ts#L88-L91) — replace the raw-payload fallback with `return null`:

```ts
// Before
try {
    return decodeURIComponent(payload);
} catch {
    return payload; // ← bypass primitive
}

// After
try {
    return decodeURIComponent(payload);
} catch {
    // Malformed percent-encoding (stray `%`, `%GG`, etc.) — fail
    // closed, same as the base64 path above. Returning the raw
    // still-encoded payload would let `%3Cscript%3E...` slip past
    // the caller's `/<script\b/i` regex while a downstream parser
    // (or sandbox-weak surface) still decoded and executed it.
    return null;
}
```

The caller `hasDangerousSvgPayload` already treats `decoded == null` as "dangerous, reject" ([src/svg-payload-scan.ts:135-136](../../../src/svg-payload-scan.ts#L135-L136)), so the fix needed no caller changes. Function-level JSDoc was updated to state explicitly that the percent-decode failure is fail-closed and that DAX literal-angle-bracket payloads decode cleanly without needing any fallback.

Test changes in [test/svg-payload-scan.test.ts](../../../test/svg-payload-scan.test.ts):

- Replaced the single misleading "falls back to raw payload" test with two tests that pin the actual contract: (a) DAX literal-angle-bracket form decodes cleanly to a non-null SVG, (b) malformed `%XX` returns `null`.
- One unrelated `hasDangerousSvgPayload` fixture was using `offset='0%'` inside a `;utf8,` URI — malformed per RFC 3986 and now caught by the new fail-closed contract. Updated to the correctly encoded `0%25'` form with a comment pointing at this security review.

Two regression cases added to [test-integration/csp-harness/corpus.ts](../../../test-integration/csp-harness/corpus.ts) and [test-uat/corpus.csv](../../../test-uat/corpus.csv): `data-uri-svg-malformed-percent-script` and `data-uri-svg-malformed-percent-onload`. Both share the same bypass primitive but exercise different attack vectors — `<script>` body and `onload=` attribute — and drive the full Playwright regression harness, the unit-level sanitizer string-check, and the UAT CSV.

## Why This Works

`hasDangerousSvgPayload` is the security boundary; `decodeSvgDataUriPayload` is the single decode function feeding it. The contract that has to hold across the boundary is: **if the decoder cannot produce the exact byte sequence the rendering surface will see, the scanner has no basis to clear the payload.** Returning the raw, still-encoded string violates that contract — the rendering surface percent-decodes, the scanner does not, and the gap between the two is exactly the bypass primitive an attacker exercises.

Returning `null` collapses the contract back to "decoder agrees with renderer, or we reject." This is the same contract the base64 branch already enforced via its `try { atob(payload) } catch { return null }`; the fix simply restores parity between the two branches.

The "tolerant whitespace around `base64`" branch above is a separate hardening — WHATWG mimesniff §4.4.3 strips parameter whitespace before decoding, so `data:image/svg+xml; base64,<b64>` is base64 to a browser. A strict `/;base64$/` regex would route it through `decodeURIComponent` (which returns the base64 string verbatim, missing literal-encoded `<script>`) — same class of decoder/renderer asymmetry, same fail-closed answer.

## Prevention

- **Decoder/scanner asymmetry is the bypass primitive.** Whenever a security check sits behind a decode step, the decoder and the rendering surface must agree on the post-decode shape. If they can disagree (different encoding tolerance, different failure handling, different normalization), the gap is exploitable. Audit every `try { decode(...) } catch` in security-adjacent code: the catch arm must either return the same shape as the success arm or fail closed — never return the pre-decode input.
- **Match failure handling across sibling branches.** Every encoding branch in a polymorphic decoder (`base64` vs `decodeURIComponent` here; future additions like `lz-string`, `gzip`, etc.) must use the same failure semantic. The base64 branch's `return null` was the right answer; the percent branch's `return payload` was the divergence. Code review for new decoder branches: explicitly diff the catch arms against the existing ones.
- **Test the fail-closed contract, not just the success path.** Every decoder feeding a security gate needs an explicit "malformed input returns null / rejects" test alongside the happy-path tests. The unit suite's "falls back to raw payload" assertion documented the bug as if it were the spec — the test name itself should have flagged the smell.
- **Fixture hygiene: literal `%` in `;utf8,` URIs must be `%25`.** A test fixture that smuggles malformed percent-encoding into a data-URI is no longer valid input under fail-closed semantics; it will return `null` and either invalidate or silently change the assertion. When tightening a decoder, grep test fixtures for raw `%` characters inside `data:` strings and re-encode.
- **Don't justify a relaxed decoder with a use case the decoder does not actually serve.** The "fallback to raw for DAX" rationale was load-bearing in the original commit message but provably wrong: `decodeURIComponent` never throws on the DAX form. When a fallback path's stated purpose is "preserve a working caller", verify the working caller actually exercises that path before shipping.

## Related Issues

- [docs/solutions/security-issues/sanitizer-overblocking-svg-data-uri-and-smil-2026-05-08.md](../security-issues/sanitizer-overblocking-svg-data-uri-and-smil-2026-05-08.md) — same module (`svg-payload-scan.ts`), the original re-allow of `data:image/svg+xml` that introduced the decode/scan path this fix hardens
- [docs/solutions/security-issues/dompurify-svg-denylist-forceKeepAttr-regressions-2026-05-07.md](../security-issues/dompurify-svg-denylist-forceKeepAttr-regressions-2026-05-07.md) — sibling sanitizer-bypass class, also surfaced by the multi-agent code review on this branch
- Related upstream commits on this branch (`fix/improve-sanitization-permissibility`):
  - `b34c3a1` — tighten href boundary in svg-payload-scan to mirror on* fix
  - `951bfb4` — scan SVG data: payload in funciri presentation attributes
  - `6efaf5b` — recursively scan nested data:image/svg+xml inner hrefs
  - `3d09584` — multi-agent code review (P1 bypasses + 8 P2 cleanups)
- `MAX_PAYLOAD_SCAN_DEPTH = 4` in the same file ([src/svg-payload-scan.ts](../../../src/svg-payload-scan.ts)) is the analogous fail-closed guard for nested SVG payloads — same defensive posture, applied at the recursion boundary instead of the decode boundary
