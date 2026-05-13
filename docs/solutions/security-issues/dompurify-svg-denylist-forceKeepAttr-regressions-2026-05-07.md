---
title: DOMPurify SVG denylist regressions — missing per-tag schemes and forceKeepAttr lost mutations
date: 2026-05-07
category: security-issues/
module: powerbi-visuals-html-content
problem_type: security_issue
component: tooling
severity: critical
related_components:
  - sanitize-pipeline
  - visual-constants
  - csp-harness-corpus
tags:
  - dompurify
  - svg-sanitization
  - force-keep-attr
  - allowed-schemes
  - denylist
  - security-regression
  - appsource-cert
  - hook-contract
symptoms:
  - "href / xlink:href with https:// URLs on feImage, pattern, linearGradient, radialGradient, and filter SVG elements survived sanitization after allowlist-to-denylist switch"
  - "Inline style attributes containing malicious values (e.g. -moz-binding: url(...)) passed through unchanged on SVG tags despite the hook mutating attrValue, because forceKeepAttr=true short-circuited the setAttribute write-back"
  - "data:URI sanitizer mutations were silently discarded on SVG denylist-gated tags — the original unsanitized value remained on the DOM node"
  - "The equivalent HTML form (e.g. <p style=\"...\"> with the same payload) was correctly cleaned, masking the SVG regression in the existing positive-only test suite"
  - "SVG funciri values (mask, clip-path, filter url() references) had no scheme validation — name-based gating only covered src / href / xlink:href"
root_cause: wrong_api
resolution_type: code_fix
---

# DOMPurify SVG denylist regressions — missing per-tag schemes and forceKeepAttr lost mutations

## Problem

Two security regressions surfaced in code review of the SVG attribute denylist switch (commit `b2f25c1`): external `https://` URLs on SVG filter / paint-server tags (`feImage`, `pattern`, `linearGradient`, `radialGradient`, `filter`) survived sanitization unchanged — a direct AppSource certification failure (external resource fetch). Separately, inline `style` mutations made by the sanitizer hook were silently discarded on SVG tags, leaving the original unsanitized declaration on the element — a sanitizer-bypass policy violation regardless of cert.

## Symptoms

- `<svg><filter><feImage href="https://attacker.example/x.png"/></filter></svg>` — the external `https://` URL passes through `getSanitizedHtmlForTesting` intact.
- Same bypass on `<pattern href="...">`, `<linearGradient href="...">`, `<radialGradient href="...">`, `<filter href="...">`, and the `xlink:href` variants on each — any SVG tag without an `allowedSchemesByTag` entry was silently permitted.
- `<svg><rect style="fill: red; -moz-binding: url(http://evil)"/>` — the `-moz-binding` declaration survives, despite the inline-style sanitizer firing and writing a sanitized value to `hookEvent.attrValue`.
- The equivalent HTML form (`<p style="fill: red; -moz-binding: url(http://evil)">`) was correctly cleaned. The mutation landed for HTML tags but not for SVG tags — masking the SVG regression because the existing test suite was 38 positive tests + 0 negative tests.
- SVG paint-server / funciri attributes (`mask`, `clip-path`, `fill`, `stroke`, `filter`, `marker-*`, `cursor`) accepting `url(https://...)` values weren't covered by name-based gating.

## What Didn't Work

The denylist switch itself was the right architectural move. The previous per-tag attribute allowlist was over-stripping legitimate SVG presentation attributes (`stdDeviation`, `fill-opacity`, `color-interpolation-filters`, etc. — issue #143's symptom). A denylist with URL-scheme enforcement is the correct shape for the SVG namespace.

Two faulty assumptions in the implementation made it ship with regressions.

**Assumption 1 — "the data: URI sanitizer or scriptingPatterns will catch unsafe schemes that fall through the per-tag scheme block."** The per-tag scheme lookup used `VisualConstants.allowedSchemesByTag[tagName]`. For `a`, `img`, `image`, `textpath` the table had entries. For `feImage`, `pattern`, `linearGradient`, `radialGradient`, `filter` it returned `undefined`, so the `if (schemesByTag)` block was skipped entirely. Three downstream layers all let `https://` through:

- The data: URI sanitizer only fires on `value.startsWith('data:')` — `https://` skips it.
- The `scriptingPatterns` check looks for `javascript:`, `vbscript:`, etc. — not `https:`.
- DOMPurify's `ALLOWED_URI_REGEXP` in `dpConfig` actively *permits* `https://` globally (it has to — `<a href="https://...">` is the most common legitimate URL on the visual). So DOMPurify said "yes," our hook said nothing for tags without scheme entries, and the end-of-hook `forceKeepAttr = true` kept the attribute on the node.

**Assumption 2 — "`forceKeepAttr = true` means the hook's decision wins."** DOMPurify's attribute-iteration loop short-circuits on `forceKeepAttr` *before* the post-hook `setAttribute` call. From `node_modules/dompurify/dist/purify.cjs.js` (3.4.x):

```js
// line 1205
if (hookEvent.forceKeepAttr) {
    continue;   // ← short-circuits before setAttribute
}
// ...
// line 1248
if (value !== initValue) {
    try {
        if (namespaceURI) {
            currentNode.setAttributeNS(namespaceURI, name, value);
        } else {
            currentNode.setAttribute(name, value);  // line 1254
        }
    } …
}
```

When the SVG hook mutated `attrValue` (data:URI branch, inline-style branch) and set `forceKeepAttr = true`, DOMPurify's loop `continue`-d past the `setAttribute` that would have written the mutated value back (the `value !== initValue` guard at line 1248 *would* have triggered the write — the mutation makes `value` differ from `initValue` — but the `continue` at 1205 skips the whole guarded block). The DOM node's attribute retained its **original unsanitized value**. For HTML tags `forceKeepAttr` was never set, so `setAttribute` ran normally — that's why `<p style="...">` was cleaned correctly and the regression went undetected.

**Why `forceKeepAttr` was set in the first place:** the visual's `dpConfig` deliberately omits `ALLOWED_ATTR` (so DOMPurify's built-in default attr allowlist applies, which keeps legitimate SVG presentation attrs like `stdDeviation`, `fill-opacity`, etc.). But that built-in list is *not* exhaustive across every SVG presentation attr we want to keep, so the SVG branch added `forceKeepAttr = true` as the override for the long tail. The override was correct for attrs whose value was not mutated; it was wrong for `style` / `src` / `href` / `xlink:href` on the success paths that changed `attrValue`, because those four attrs are *already* in DOMPurify's built-in SVG allowlist — they never needed the override, and adding it short-circuited their write-back.

**(session history)** This is the **second** time `forceKeepAttr` semantics have bitten this codebase. An earlier session on the same branch had already fixed a different `forceKeepAttr` issue: the assignment was being made *before* URL scheme enforcement, so `keepAttr = false` from a scheme drop was being overridden. That earlier fix deferred the assignment to *after* enforcement checks. The current bug is a related-but-distinct surface: even after the deferral, `forceKeepAttr = true` on the success-path returns still short-circuits `setAttribute` and loses mutations to `attrValue`. Two distinct semantics to remember; both subtle.

## Solution

### 1. `allowedSchemesByTag` extension + default-deny

Added the missing scheme entries so every SVG tag that may carry a URL-bearing attribute has an explicit policy. The `textpath: ['']` entry was already present pre-fix; the rest are new:

```typescript
// src/visual-constants.ts — allowedSchemesByTag additions
feimage: ['data'],          // same restriction as <image>: data: URIs only
pattern: [''],              // fragment-only (#id); empty-scheme matches #ref
lineargradient: [''],
radialgradient: [''],
filter: [''],
```

The second half of the fix is the default-deny guard in the hook. Previously the `if (schemesByTag)` block was simply skipped when the tag had no entry. Now the `else if` arm explicitly rejects:

```typescript
// src/sanitize-pipeline.ts — default-deny branch (was absent before)
if (schemesByTag) {
    const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : '';
    if (!schemesByTag.includes(scheme)) {
        hookEvent.keepAttr = false;
        return;
    }
} else if (isSvgTag) {
    hookEvent.keepAttr = false;
    return;
}
```

### 2. `forceKeepAttr` removal from mutation success paths

Before (both the data:URI branch and the inline-style branch for SVG):

```typescript
// ❌ BEFORE — setAttribute short-circuits; unsanitized value stays on node
hookEvent.attrValue = sanitized;
if (isSvgTag) hookEvent.forceKeepAttr = true;
return;
```

After — `forceKeepAttr` removed from both mutation success paths:

```typescript
// ✅ AFTER — DOMPurify's post-hook setAttribute writes the sanitized value
hookEvent.attrValue = sanitized;
return;
```

The single remaining `forceKeepAttr = true` site is at the very end of the hook — the fall-through path for SVG presentation attrs that passed all checks and were *not* mutated. That usage is correct (DOMPurify's built-in allowlist would otherwise strip `stdDeviation`, `fill-opacity`, etc.).

### 3. SVG funciri value-side scheme check

SVG presentation attributes such as `mask`, `clip-path`, `filter`, `marker-start`, `fill`, `stroke`, `cursor` accept `url(...)` functional references. Name-based gating cannot catch these. A value-side regex now scans for an embedded scheme in any `url()` token on SVG attributes (excluding `style`, which is handled per-declaration by `sanitizeCss`):

```typescript
if (isSvgTag && attrName !== 'style') {
    const funciriScheme = value.match(
        /url\(\s*["']?([a-z][a-z0-9+.\-]*)\s*:/i
    );
    if (funciriScheme) {
        const fScheme = funciriScheme[1].toLowerCase();
        if (fScheme !== 'data') {
            // fragment-only (#id) has no scheme → no match → passes
            hookEvent.keepAttr = false;
            return;
        }
    }
}
```

`fill="url(#gradient)"` produces no regex match (no scheme token before `:`), so it passes — the fragment-only legitimate case.

### 4. Typed hook event

Imported `UponSanitizeAttributeHookEvent` from DOMPurify's `.d.ts`. The hook callback signature is now typed, so a name typo on `forceKeepAttr` becomes a compile error instead of a silent no-op:

```typescript
// DOMPurifyType is aliased so it doesn't collide with the
// `import * as DOMPurifyNs` namespace import on the line above.
import type {
    DOMPurify as DOMPurifyType,
    Config,
    UponSanitizeAttributeHookEvent
} from 'dompurify';

purify.addHook(
    'uponSanitizeAttribute',
    (
        currentNode: Element,
        hookEvent: UponSanitizeAttributeHookEvent,
        _config: Config  // third hook param per d.ts; unused but typed for accuracy
    ) => { … }
);
```

Caveat: the type only catches *name* typos. `forceKeepAttr` is `boolean | undefined` in the d.ts, so an explicit `undefined` assignment compiles silently. Don't rely on the type to catch logic errors that produce `undefined`.

## Why This Works

**Default-deny is the correct failsafe shape for a security boundary.** A missing `allowedSchemesByTag` entry used to be indistinguishable from "no scheme restriction needed." Now it is treated as "no scheme policy defined → deny." Future SVG tags added to `allowedTags` without a corresponding scheme entry fail safely instead of leaking URLs.

**Removing `forceKeepAttr` from mutation paths respects DOMPurify's contract.** DOMPurify's built-in SVG attr allowlist already includes `src`, `href`, `xlink:href`, and `style`. When the hook mutates `attrValue` and returns *without* setting `forceKeepAttr`, DOMPurify's loop reaches the `setAttribute(name, value)` call and writes the sanitized value back. The override (`forceKeepAttr = true`) was only ever needed for SVG presentation attrs that are *not* in DOMPurify's default allowlist (e.g. `stdDeviation`, `fill-opacity`) — that single remaining site is still correct.

**The funciri value-side check closes the cross-attribute attack surface.** Name-based gating secures `href` / `src` / `xlink:href`. Value-based gating secures every other attribute that can embed a URL via `url(scheme:...)`. Together they cover the full SVG URL surface that the denylist model opens up.

## Prevention

- **Audit every tag in the affected namespace when switching attribute policies.** When a per-tag allowlist is replaced with a denylist, enumerate every tag that can carry a URL-bearing attribute and verify it has a corresponding `allowedSchemesByTag` entry. Code-review checklist item: *"does every tag in `svgTags` that accepts `href` / `src` / `xlink:href` appear in `allowedSchemesByTag`?"*
- **DOMPurify hook contract: mutation and `forceKeepAttr` are mutually exclusive.** When `hookEvent.attrValue` is mutated, do NOT set `forceKeepAttr = true`. DOMPurify's `continue` at the `forceKeepAttr` check short-circuits before `setAttribute`, discarding the mutation entirely. Use `forceKeepAttr = true` only on code paths that leave `attrValue` unchanged. Document this constraint at the hook entry point so reviewers can spot violations by inspection. (See "What Didn't Work" for the prior `forceKeepAttr` regression on this codebase — two distinct gotchas, both subtle.)
- **Pair every drop code path with a negative test.** Pre-fix the SVG test suite had 38 positive tests asserting what survives and zero negative tests asserting what is dropped. Regressions on the security enforcement paths were invisible. Every `hookEvent.keepAttr = false` return site should have at least one corpus row that asserts the attribute (or element) is absent from the sanitized output.
- **Pair every `allowedSchemesByTag` entry with a corpus row asserting the drop.** The table entry declares the policy; the corpus row proves the policy is enforced. When the entry is missing, the corpus row would catch the gap before merge.
- **Type the third-party hook contract.** The DOMPurify d.ts ships `UponSanitizeAttributeHookEvent`, `Config`, and the `DOMPurify` interface. Typed bindings turn name typos into compile errors. (Caveat: `forceKeepAttr` is `boolean | undefined`, so explicit `undefined` assignment still compiles silently — typing helps with names, not all logic.)
- **Future hardening — type `allowedSchemesByTag` against the SVG tag union.** The current `Record<string, string[]>` shape is permissive: a missing entry only fails at runtime via the new default-deny. Typing it against a mapped type over `typeof svgTags[number]` would turn a missing entry into a compile-time error, catching the gap before merge instead of needing a corpus row to detect it.
- **Future hardening — named regex capture groups.** The funciri scheme check uses positional groups (`funciriScheme[1]`). Named groups (`(?<scheme>...)`) survive regex edits that shift group numbering and self-document at the call site. Low-impact ergonomic improvement.

## Related

- [docs/sanitization-rules.md](../../sanitization-rules.md) — the user-facing sanitization rule reference. Updated alongside this fix with the new `allowedSchemesByTag` entries and the funciri scheme-check paragraph.
- [docs/solutions/security-issues/css-sanitizer-multiline-selector-control-char-regression-2026-05-07.md](css-sanitizer-multiline-selector-control-char-regression-2026-05-07.md) — same-day sibling. Different bug (multi-line selectors silently dropped by an over-broad `0x00-0x1F` control-char check) but **shares the synthetic-fixture blind-spot meta-learning** with this doc's "Pair every drop code path with a negative test" prevention bullet — both regressions slipped through positive-only / single-line tests and only surfaced when real reporter content was diffed against sanitized output.
- [docs/solutions/security-issues/sanitizer-overblocking-svg-data-uri-and-smil-2026-05-08.md](sanitizer-overblocking-svg-data-uri-and-smil-2026-05-08.md) — next-day follow-up on the same branch. Layers a MIME-conditional check on top of the `allowedSchemesByTag` discipline established here (re-allows `data:image/svg+xml` when not base64) and adds a new policy primitive (attribute-value-conditional element gating via `SMIL_ATTRIBUTE_NAME_DENYLIST`) to re-allow SMIL animation. Same theme: replace wholesale tag/MIME deny with a surgical gate at the actual attack point.
- [docs/solutions/2026-05-issue-144-body-styling-cascade.md](../2026-05-issue-144-body-styling-cascade.md) — same-day, same-branch solution doc. **Different concern** (CSS cascade override for office-paste residue, not sanitizer behavior). Listed for branch context.
- DOMPurify source — `node_modules/dompurify/dist/purify.cjs.js:1136` is the `forceKeepAttr` short-circuit; `:1185` is the `setAttribute` that gets skipped.
