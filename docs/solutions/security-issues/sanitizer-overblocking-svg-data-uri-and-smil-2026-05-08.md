---
title: Re-allowing data:image/svg+xml and SMIL animation with surgical attack-surface gates
date: 2026-05-08
category: security-issues
module: powerbi-visuals-html-content
problem_type: security_issue
component: tooling
severity: high
symptoms:
  - "DAX measures emitting <img src=\"data:image/svg+xml;utf8,<svg ...>\"> render as a blank image (issue #143 oechslein follow-up)"
  - "kriscs1 partial-success report after the multi-line selector fix: 'it all works except the SVG map'"
  - "Animated SVGs (animate, animateMotion, animateTransform, set) silently removed since Power BI Desktop 1.6.0.2 (issue #145 fernandodelriofigueira-ext)"
  - "SMIL-driven opacity / transform / path animations no longer play; groups with opacity='0' stay invisible because the animation that would lift them is stripped"
  - "Legitimate user content broken — only base64-encoded raster images and CSS @keyframes-based animation survive sanitization"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - dompurify
  - css-sanitizer
  - testing_framework
tags:
  - sanitization
  - svg
  - smil
  - data-uri
  - regression
  - issue-143
  - issue-145
  - permissibility
---

# Re-allowing data:image/svg+xml and SMIL animation with surgical attack-surface gates

## Problem

Two legitimate Power BI authoring surfaces were being blocked wholesale by the sanitizer: `data:image/svg+xml` data URIs (used by DAX measures that emit SVG via `<img src="data:image/svg+xml;utf8,...">`) and all SMIL animation elements (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`). Both blocks were correct in principle — SVG can carry scripts; SMIL can override sanitized URL attributes — but conflated *"this surface CAN be dangerous"* with *"this surface IS dangerous in this context"*, making real-world DAX SVG measures unrenderable.

## Symptoms

- **oechslein's SVG-as-IMG output** (issue #143 follow-up, kriscs1 partial-success report after the 2026-05-07 multi-line selector fix): a DAX measure that builds an SVG and emits it as `<img src="data:image/svg+xml;utf8,<svg ...>">` rendered as a blank image. kriscs1 reported *"it all works except the SVG map."* Two surfaces blocked it: `getSanitizedDataUri`'s allowlist did not include `image/svg+xml`, and even if it had, the function required `;base64,` while DAX emits the `;utf8,` form. The CSS sanitizer had a parallel block via an explicit `if (mime === 'image/svg+xml') return false;` line.
- **fernandodelriofigueira-ext's HomeTetris animation** (issue #145): an SVG with 14 SMIL animation elements (7 `<animateTransform attributeName="transform" type="translate">` + 7 `<animate attributeName="opacity">`) never started — groups stayed at `opacity=0` forever because the animation tags were stripped during sanitization. The user reported *"animated SVGs not working since 1.6.0.2 update."*

## What Didn't Work

The prior reasoning that produced both over-broad blocks:

- **"SVG can carry scripts → block all `image/svg+xml` everywhere."** True for inline `<svg>` parsed into the DOM, but loaded via `<img>` / `<svg image href>` / `<feImage href>` / CSS `url()` the browser sandbox already neutralizes scripts, event handlers, and external resource references inside the SVG. Static sanitization was duplicating a boundary the browser already enforces.
- **"SMIL can override URL attrs at runtime → block all SMIL tags."** The `src/visual-constants.ts:100-102` comment captured this: SMIL was *"intentionally excluded — they can override sanitized URL attributes at runtime, bypassing scheme enforcement."* But the actual attack surface is `attributeName` resolving to a URL-bearing (or bulk-style, or `url(#)`-resolving) attribute. Animation that targets `opacity`, `transform`, `fill`, geometry, etc. carries no such risk.
- The 2026-05-07 multi-line selector fix unblocked the postcss-stylesheet path but did not touch either of these gates, leaving kriscs1's SVG map issue and fernandodelriofigueira-ext's animation issue unresolved. (Same diagnostic shape as the multi-line selector regression: synthetic positive tests missed both — the user's actual reporter content reproduced both in minutes.)

## Solution

### Fix A — `data:image/svg+xml` allowance

`getSanitizedDataUri` in [src/sanitize-pipeline.ts:613-665](../../../src/sanitize-pipeline.ts#L613-L665) had an allowlist of raster MIME types only and required `;base64,` unconditionally. Both gates were tightened to be MIME-conditional.

**Before:**

```ts
const safeMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/bmp'
];
if (!safeMimeTypes.includes(mimeType)) {
    return 'data:,';
}
// require ;base64, regardless of MIME
if (!/^data:[^,]*;base64,/i.test(dataUri)) {
    return 'data:,';
}
```

**After:**

```ts
const safeMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml'
];
if (!safeMimeTypes.includes(mimeType)) {
    return 'data:,';
}
// raster types require ;base64, ; SVG is text by spec and may be ;utf8,
// or url-encoded — DAX measures legitimately emit the ;utf8, form.
if (
    mimeType !== 'image/svg+xml' &&
    !/^data:[^,]*;base64,/i.test(dataUri)
) {
    return 'data:,';
}
```

The same MIME-conditional rule was applied in [src/css-sanitizer.ts:147-191](../../../src/css-sanitizer.ts#L147-L191) `isSafeImageDataUri`, and the explicit `image/svg+xml` deny line was removed.

**Before:**

```ts
const SAFE_IMAGE_MIME_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/jpg',
    'image/gif', 'image/webp', 'image/bmp'
]);
// ...
if (mime === 'image/svg+xml') return false;
if (!SAFE_IMAGE_MIME_TYPES.has(mime)) return false;
if (!/;base64,/i.test(rawUrl)) return false;
return true;
```

**After:**

```ts
const SAFE_IMAGE_MIME_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/jpg',
    'image/gif', 'image/webp', 'image/bmp',
    'image/svg+xml'
]);
// ...
// (explicit svg+xml deny line removed)
if (!SAFE_IMAGE_MIME_TYPES.has(mime)) return false;
if (mime !== 'image/svg+xml' && !/;base64,/i.test(rawUrl)) return false;
return true;
```

### Fix B — SMIL animation re-allow with `attributeName` denylist

Two enforcement layers, in [src/visual-constants.ts](../../../src/visual-constants.ts) and [src/sanitize-pipeline.ts](../../../src/sanitize-pipeline.ts).

**Layer 1 — tag allowlist + per-tag URL scheme** (visual-constants.ts):

```ts
// svgTags additions
'animate',
'animatemotion',
'animatetransform',
'set',

// allowedSchemesByTag — fragment-only ('') for each SMIL tag.
// The element's own href / xlink:href can only point at same-document
// fragments; external URLs are dropped at the existing per-tag URL gate.
animate: [''],
animatemotion: [''],
animatetransform: [''],
set: ['']
```

**Layer 2 — `attributeName` denylist** in [src/sanitize-pipeline.ts:51-93](../../../src/sanitize-pipeline.ts#L51-L93):

```ts
const SMIL_TAGS = new Set<string>([
    'animate',
    'animatemotion',
    'animatetransform',
    'set'
]);

const SMIL_ATTRIBUTE_NAME_DENYLIST = new Set<string>([
    // URL-bearing
    'href', 'xlink:href', 'src', 'srcdoc', 'srcset',
    'formaction', 'action', 'ping', 'background', 'poster',
    // bulk-style — animating style replaces the entire inline
    // declaration string, re-introducing url() declarations the
    // static sanitizer never saw
    'style',
    // url(#id)-resolving
    'cursor', 'clip-path', 'mask', 'filter',
    'marker-start', 'marker-mid', 'marker-end',
    // meta — animating attributeName itself lets the animation
    // re-target a different attribute later
    'attributename'
]);
```

The hook check at [src/sanitize-pipeline.ts:477-497](../../../src/sanitize-pipeline.ts#L477-L497):

```ts
// inside the per-attribute uponSanitizeAttribute hook
if (
    SMIL_TAGS.has(tagName) &&
    attrName === 'attributename' &&
    SMIL_ATTRIBUTE_NAME_DENYLIST.has(value.toLowerCase())
) {
    hookEvent.keepAttr = false;
    return;
}
```

This closes the well-known SMIL bypass primitive — `<a href="https://safe"><animate attributeName="href" to="javascript:alert(1)" /></a>` — where static sanitization sees `href="https://safe"` but SMIL rewrites it to `javascript:` after the DOM is live. The `attributeName` attribute is dropped, leaving the SMIL element with nothing to bind to. Animation that targets safe presentation/geometry properties (`opacity`, `transform`, `fill`, `stroke`, `cx`, `cy`, `d`, ...) is unconstrained.

### Test coverage

20 new SMIL tests in [test/sanitize-pipeline-svg.test.ts](../../../test/sanitize-pipeline-svg.test.ts) — 6 positive (opacity / transform / fill / cx / set / fragment xlink:href) and 14 negative (href / xlink:href / src / style / attributeName / clip-path / mask / filter / cursor / marker-end / external xlink:href / `javascript:` in value / `on*` handler / funciri-wrapped `javascript:`). 9 new svg+xml-data-uri tests across [test/sanitize-pipeline.test.ts](../../../test/sanitize-pipeline.test.ts) and [test/css-sanitizer.test.ts](../../../test/css-sanitizer.test.ts).

### Corpus migration

Two entries in `MALICIOUS_PAYLOADS` had flipped to positive-only `contains` assertions during these fixes — meaning the input is no longer malicious by the new policy. They were renamed and moved to `CLEAN_PAYLOADS`:

- `css-url-scheme-data-image-svg-xml-clean` (category `css-url-scheme`) → `clean-img-svg-xml-data-uri` (category `clean-baseline`)
- `svg-animate-safe-opacity` (category `svg`) → `clean-svg-animate-opacity` (category `clean-baseline`)

The other 4 MALICIOUS rows with `contains` assertions remain — they are partial-survival tests where malicious input survives partially after sanitization (input is malicious; some safe fragments survive).

### Caveat: `<svg/>` inside `<style>` body

Literal unencoded `<svg/>` inside a `<style>` element trips the HTML parser — the `<style>` tag itself gets dropped. This is the well-known reason CSS-embedded SVG always uses URL-encoded angle brackets (`%3Csvg%3E`) in production. The lorem fixture in [test/fixtures/lorem.ts](../../../test/fixtures/lorem.ts) uses the URL-encoded form, matching real-world CSS practice; the corpus comment was updated to call this out.

## Why This Works

The unifying theme: **browser-context security boundaries already cover what the sanitizer was duplicating wholesale.**

- For `data:image/svg+xml`: the browser sandbox of img-loaded SVG (also `<svg image href>`, `<feImage href>`, CSS `url()`) is the load-bearing boundary. Scripts, event handlers, and external resource references inside an image-loaded SVG do not execute. The sanitizer's job there is to keep the data URI well-formed and the MIME on a known-safe list — not to re-implement the sandbox. Inline `<svg>` parsed into the DOM is a different surface and still goes through the full DOMPurify pass.
- For SMIL: the actual attack vector is `attributeName` resolving to a URL-bearing (or bulk-style, or `url(#)`-resolving, or meta) attribute. Denylist that one attribute and the bypass closes — without losing the legitimate animation surface, which is overwhelmingly the geometry and presentation properties.

In both cases, the fix replaces a wholesale tag/MIME-level deny with a surgical gate at the actual attack point. Same pattern: identify the narrowest gate that closes the real bypass; admit everything else.

## Prevention

- **When permissibility regresses against a sanitizer, audit whether the block is wholesale or surgical.** Ask *"what is the narrowest gate that closes the actual attack?"* before reaching for tag-level or MIME-level deny. Wholesale deny is a sign the block has not yet been refined to match the threat model.
- **Pair every sanitizer-allow with a corpus row that exercises the legitimate shape AND a corresponding negative row that exercises the bypass attempt.** The 6 positive + 14 negative SMIL tests in `test/sanitize-pipeline-svg.test.ts` are the model: every safe attribute target has a positive case; every denylisted attribute name has a negative case.
- **Watch for stale tests after policy flips.** When a sanitizer rule changes from deny to allow (or vice versa), grep for assertions that mention the old behavior. Three test files needed updates this round: `security-sanitization.test.ts`, `visual-constants.test.ts`, `css-sanitizer.test.ts`.
- **When a fixture's `expectedSanitized` becomes contains-only (no `notContains`), the row's input is by definition clean and belongs in `CLEAN_PAYLOADS`, not `MALICIOUS_PAYLOADS`.** Audit during sanitizer-policy changes — two rows had drifted in this session.
- **For CSS-embedded SVG in `<style>` bodies, use URL-encoded angle brackets (`%3Csvg%3E`).** Literal unencoded `<svg/>` inside `<style>` content trips HTML parsers and the `<style>` element itself gets dropped. Well-known but worth restating in corpus comments.
- **The SMIL bypass extends beyond `attributeName="href"`.** Cover the full URL-bearing surface (`href`, `xlink:href`, `src`, `srcdoc`, `srcset`, `formaction`, `action`, `ping`, `background`, `poster`), the bulk-attribute surface (`style`), the `url(#id)`-resolving attributes (`cursor`, `clip-path`, `mask`, `filter`, `marker-start`, `marker-mid`, `marker-end`), and the meta `attributeName` itself. Anything narrower leaves a partial bypass.

## Related

- [docs/solutions/security-issues/dompurify-svg-denylist-forceKeepAttr-regressions-2026-05-07.md](dompurify-svg-denylist-forceKeepAttr-regressions-2026-05-07.md) — same-day sibling on the SVG denylist switch and the `forceKeepAttr` setAttribute short-circuit. Builds on the `allowedSchemesByTag` discipline established there; this fix layers a MIME-conditional check on top of the scheme allowlist for `data:image/svg+xml`, and adds a new policy primitive (attribute-value-conditional element gating via `SMIL_ATTRIBUTE_NAME_DENYLIST`) that previous SVG sanitizer work had no shape for.
- [docs/solutions/security-issues/css-sanitizer-multiline-selector-control-char-regression-2026-05-07.md](css-sanitizer-multiline-selector-control-char-regression-2026-05-07.md) — same diagnostic pattern: synthetic positive tests missed it, user gist reproduced it in minutes. Same prevention rule about real-reporter content vs synthetic fixtures, applied here against two more permissibility regressions on the same branch.
- [GitHub issue #143](https://github.com/dm-p/powerbi-visuals-html-content/issues/143) — original "SVGs not working" report. oechslein's comment ([#issuecomment-4397842943](https://github.com/dm-p/powerbi-visuals-html-content/issues/143#issuecomment-4397842943)) drove the `data:image/svg+xml` fix; kriscs1's "it all works except the SVG map" partial-success report ([#issuecomment-4395399972](https://github.com/dm-p/powerbi-visuals-html-content/issues/143#issuecomment-4395399972)) signaled the missing piece after the 2026-05-07 multi-line selector fix landed.
- [GitHub issue #145](https://github.com/dm-p/powerbi-visuals-html-content/issues/145) — fernandodelriofigueira-ext's "[BUG] Animated SVGs not working correctly since the new 1.6.0.2 update" — drove the SMIL re-allow with `attributeName` denylist.
- [SVG Animation specification](https://www.w3.org/TR/SVG11/animate.html) — `attributeName` and animation element semantics that the denylist is calibrated against.
