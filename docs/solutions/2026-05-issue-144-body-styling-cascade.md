---
title: Default body styling overridden by office-paste residue (issue #144)
date: 2026-05-07
issue: https://github.com/dm-p/powerbi-visuals-html-content/issues/144
fix-commit: TBD
---

# Default body styling overridden by office-paste residue (issue #144)

## Symptom

Users reported that the **Default body styling** properties (`fontColour`, `fontSize`, `fontFamily`, `align`) on the *contentFormatting* card responded correctly on visuals created ~12 months ago but were silently ignored on visuals added today. Both instances ran the same visual binary, were bound to the same enriched-text field, and had identical format-pane configuration.

## False lead

The reporter's initial theory was that the body-styling apply code had been removed during the April 2025 certification work and needed to be restored. **This was not the cause.** `git show` on the cert commits (`5a7e5d0`, `f6a06cf`, `b81c081`) confirmed each touched only sanitization helpers in `src/domain-utils.ts` and the allowed-attrs lists in `src/visual-constants.ts`. `resolveStyling` and `style/visual.less` were never modified by that work; the apply path was intact and runs on every `update()`.

## Root cause

The reporter's [follow-up comment](https://github.com/dm-p/powerbi-visuals-html-content/issues/144#issuecomment-4393240092) identified the actual trigger: the bound enriched-text content carried **inline `style` declarations** that arrived with content pasted from Outlook, Teams, or Word into a SharePoint enriched-text field without "paste as plain text" mode. That paste produces HTML like:

```html
<p><span style="background-color:#ffffff; color:#000000; font-family:Calibri, sans-serif; font-size:11pt;">
  ...prose...
</span></p>
```

When that HTML lands inside `#htmlContent`, the inline `style` declarations on the descendant `<span>`/`<div>` elements have higher CSS specificity than the values inherited from the inline body styling that `resolveStyling` writes onto `#htmlViewer`. The user's chosen Default body styling (e.g. `fontColour: red`) is silently overridden by the embedded `color: #000000`. "Old visuals work" because their bound content was originally pasted clean (or had the formatting cleared in SharePoint).

The sanitizer is doing the right thing — those inline styles are safe HTML (no `url()`, no `expression()`, no `javascript:`); the bug is at the visual's apply layer.

## Fix

Two-part stylesheet-only intervention scoped to `#htmlContent` descendants:

1. **`src/domain-utils.ts`** — `resolveStyling` toggles a class on the body container (`uses-default-body-styling`) when the user is in default-body mode (no custom stylesheet). The class is removed when the user supplies a custom stylesheet, so the override mechanism stays out of their way.

2. **`style/visual.less`** — adds a single rule:

   ```less
   #htmlViewer.uses-default-body-styling #htmlContent [style] {
       color: inherit !important;
       font-family: inherit !important;
       font-size: inherit !important;
       text-align: inherit !important;
   }
   ```

   The `[style]` attribute selector scopes the override to descendants that actually carry an inline `style` — descendants without inline styles (`<h1>`, `<code>`, `<strong>`, etc.) keep their normal cascade behavior. The `!important` declarations beat the embedded inline values; the `inherit` keyword pulls the body styling down via the cascade.

3. **`src/visual-constants.ts`** — added `defaultBodyStylingClass: 'uses-default-body-styling'` to `dom` so the class name is shared between the apply layer and the stylesheet selector.

The sanitizer was not modified.

## Tradeoff

Deliberate inline color/font spans in authored content (e.g. `<span style="color: red">important note</span>`) are also overridden by this rule. Users who want embedded styling preserved should supply a value via the **Custom stylesheet** setting on the format pane — that path clears the class and disables the override.

## Regression test

[test/body-styling.test.ts](../../test/body-styling.test.ts) covers:

- `resolveStyling` adds `uses-default-body-styling` in default-body mode and removes it in custom-stylesheet mode.
- The existing inline-style contract (`font-family` / `font-size` / `color` / `text-align` written to the body container) is unchanged.
- The office-paste fixtures (`lorem-office-paste-paragraph`, `lorem-office-paste-bulleted-list`, `lorem-office-paste-mixed-content`) continue to produce sanitized output that retains the inline styles — the cascade-override surface is real and the fix targets the correct case.

JSDOM's CSS engine cannot faithfully resolve `!important` + inheritance across a real DOM, so cascade-resolution itself is verified manually via the UAT page bound to `test-uat/lorem.csv`.

## Files modified

- [src/domain-utils.ts](../../src/domain-utils.ts) — class toggle in `resolveStyling`
- [src/visual-constants.ts](../../src/visual-constants.ts) — `dom.defaultBodyStylingClass` constant
- [style/visual.less](../../style/visual.less) — descendant override rule
- [test/body-styling.test.ts](../../test/body-styling.test.ts) — new regression suite
- [test/fixtures/lorem.ts](../../test/fixtures/lorem.ts) — office-paste fixtures (added in U5 prior)

## Known follow-ups

Captured during the post-fix code review walk-through. Track once an issue tracker is configured for the repo.

- **Inline `style="X !important"` defeats the cascade override.** Per CSS Cascade L4, inline `!important` outranks any author-rule `!important` regardless of selector specificity. Office-paste residue almost never carries `!important` (Outlook/Teams/Word don't emit it), so in-the-wild incidence is low. Mitigation if a real-world report hits: extend `sanitizeCss` declaration-list mode to strip `!important`. Side effect: deliberate `<span style="color: red !important">` loses its weight too. Users who want embedded styling preserved should supply a value via the Custom stylesheet setting (the override is class-gated and disables itself in custom-stylesheet mode).
- **No automated browser-cascade verification.** `test/body-styling.test.ts` covers the JS contract (class toggle, inline-style apply contract) and the LESS rule's structural shape, but not the actual `!important + inherit` cascade — JSDOM's CSS engine doesn't faithfully resolve it. A Playwright spec is technically feasible: the existing CSP harness already runs in Chromium. Cost is non-trivial (build / extract the visual's CSS, inject into a fixture page, render an office-paste fixture under `.uses-default-body-styling`, `getComputedStyle` on a descendant). Manual UAT against `test-uat/lorem.csv` remains the verification gate today.
- **SVG inner `<style>` may leak rules to the outer document scope.** A `<style>` block inside an SVG fragment can carry CSS rules whose selectors target `#htmlContent [style]` with their own `!important`. Both rules tie on specificity; cascade source-order favors the later (sanitized) `<svg><style>` rule. The CSS sanitizer already strips dangerous *values* — only specificity-equal selector contests remain. Office-paste rarely uses `<style>`. Mitigation if a real-world report hits: drop `<style>` inside SVG, or scope-prefix sanitized selectors. Both have meaningful tradeoffs.
- **`'lorem'` PayloadCategory coupling.** The lorem corpus reuses the `Payload` interface and extends `PayloadCategory` with `'lorem'`. The doc generator excludes lorem entries by call-site (concatenating only `MALICIOUS_PAYLOADS` and `CLEAN_PAYLOADS`), not by type. Misuse vector: a `category: 'lorem'` entry mistakenly added to one of the sanitization arrays would render under `Other: lorem` in `docs/sanitization-rules.md`. Documented in a 7-line comment in `corpus.ts` and acknowledged here. No type-level fix without a dedicated `LoremPayload` / `LoremCategory` split.

## Code review fixes (2026-05-07)

The post-fix code review surfaced two P0 regressions in the SVG denylist switch (commits `a59b084..48c706c`) that landed before this branch was reviewed; both were addressed in commit TBD on this branch:

1. **SVG `href` external-URL bypass on filter primitives, gradients, and patterns.** The denylist switch let `href` / `xlink:href` through on every SVG tag, but `allowedSchemesByTag` had no entries for `feImage`, `pattern`, `linearGradient`, `radialGradient`, `filter` — so `<svg><feImage href="https://attacker.example"/>` survived sanitization. Fixed by adding scheme entries (data-only or fragment-only per element) plus a default-deny for SVG tags with no entry. Corpus rows added for each.

2. **`forceKeepAttr=true` lost sanitized data:/style mutations on SVG.** DOMPurify's `forceKeepAttr` short-circuits before `setAttribute` (purify.cjs.js:1136), so when the hook mutated `attrValue` and then set `forceKeepAttr=true`, the sanitized value was never written. `<svg><rect style="...; background: url(http://evil)">` survived unchanged. Fixed by removing `forceKeepAttr=true` from the data:URI and style success returns — DOMPurify's built-in SVG attr allowlist already keeps those attrs, and the mutation now lands via the normal post-hook setAttribute path. Regression test added in `test/sanitize-pipeline-svg.test.ts`.

3. **SVG funciri values now scheme-checked.** `mask`, `clip-path`, `filter`, etc. accept `url(...)` references; previously only attribute *names* (`src`/`href`/`xlink:href`) were scheme-gated. Now the SVG branch scans value-side `url(<scheme>:...)` and rejects non-empty / non-`data` schemes. The `style` attribute is excluded from this check because the CSS sanitizer handles per-declaration url() validation with partial-survival semantics.

4. **DOMPurify hook event typed.** `hookEvent: any` replaced with `UponSanitizeAttributeHookEvent` from DOMPurify's d.ts. A typo on `forceKeepAttr` would now compile-error rather than silently regress.

5. **`background-color: transparent !important`** added to the body-styling override rule to clear embedded paste-residue backgrounds.
