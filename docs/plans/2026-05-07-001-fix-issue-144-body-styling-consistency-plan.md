---
title: 'fix: restore body styling consistency across visual instances (issue #144)'
type: fix
status: active
date: 2026-05-07
---

# fix: restore body styling consistency across visual instances (issue #144)

## Summary

Investigate and fix [issue #144](https://github.com/dm-p/powerbi-visuals-html-content/issues/144) — Default body styling (font color, size, family, alignment) is applied on visuals created ~12 months ago but not on newly added visuals running the same 1.6.0.2 build. The body-styling apply path (`resolveStyling` in [src/domain-utils.ts:45-106](src/domain-utils.ts)) is still present and still wired into `update()`, so the working hypothesis that the patch was "configured out" does not hold against the current code.

**Root cause confirmed (per [reporter follow-up comment](https://github.com/dm-p/powerbi-visuals-html-content/issues/144#issuecomment-4393240092)):** the bound enriched-text content carries inline `style="background-color:...; color:...; font-family:...; font-size:..."` declarations introduced when content is pasted into SharePoint enriched-text fields from Outlook/Teams/Word without "paste as plain text". Those inline `style` declarations on inner `<span>` and `<div>` elements win the CSS cascade against the body styling that `resolveStyling` applies to `#htmlViewer`, silently overriding the user's chosen Default body styling. "Old visuals work" because their bound content was originally pasted clean (or had clear-formatting reapplied); "new visuals don't" because the same code path now sees content with embedded styling. The sanitizer is doing its job correctly — those inline styles are safe HTML; the fix lives at the visual's apply layer.

This plan tightens around the now-known diagnosis: U1 reproduces against fixtures that match the office-paste shape, U2 is folded into U1 (analysis already proved Branch A — cascade override), U3 picks a cascade-winning approach in the visual's apply layer (CSS rule using high specificity, or selective inline-style scrubbing), U4 documents, U5 (already complete) builds the lorem CSV pipeline that supplies the office-paste fixtures.

---

## Problem Frame

A user reports that the **Default body styling** group (font family, font size, font color, text alignment) on the *contentFormatting* card responds correctly on visuals created ~12 months ago but is silently ignored on visuals added today. Both instances run the same visual binary (1.6.0.2), bind to the same enriched-text field, and have identical format-pane configuration.

The reporter's [follow-up comment](https://github.com/dm-p/powerbi-visuals-html-content/issues/144#issuecomment-4393240092) traced the trigger to inline style residue in the bound content: when text is copied from Outlook/Teams/Word and pasted into a SharePoint enriched-text field without "paste as plain text", the resulting HTML carries inline `style="background-color:#ffffff; color:#000000; font-family:Calibri; font-size:11pt;"` (and similar) declarations on the `<span>` and `<div>` elements that wrap the prose. When that content lands inside `#htmlContent`, those inline declarations have higher CSS specificity than the inherited body-styling values that `resolveStyling` sets on the parent `#htmlViewer` — so the user's chosen Default body styling is silently overridden. The reporter's workaround ("clear formatting and reapply clean text" in SharePoint) confirms the diagnosis: clean content has no inline residue, no override, body styling applies as expected.

The original "configured out" theory is unsupported by the diff (April 2025 cert commits did not touch `resolveStyling` or `style/visual.less`). The cascade-override branch (formerly hypothesis A) is now confirmed without needing a devtools session. The fix lives at the visual's apply layer; the sanitizer is correct to preserve safe inline `style` attributes.

---

## Requirements

- R1. Reproduce the bug locally against `test-uat/html-content-uat.Report` so before/after behavior is observable.
- R2. Identify the actual root cause through DOM inspection of an old vs new visual instance (computed styles, container structure, persisted properties).
- R3. Restore consistent default-body-styling behavior so font-family / font-size / font-color / text-align respond uniformly on old and new visual instances.
- R4. Add a regression test that fails before the fix and passes after, scoped to whatever surface the fix touches (vitest unit test against the styling apply path; manual UAT step for the rendered DOM check if the surface is host-cascade-only).
- R5. Do not regress the existing certification posture — sanitization, allowed tags/attrs, URL scheme rules, on* drop, and the recently-added clean-baseline SVG corpus must all continue to pass.
- R6. Establish a second test-corpus pipeline at `test-uat/lorem.csv` covering body-styling-shaped fixtures (simple text, paragraphs, headings, ordered/unordered lists, nested blocks, inline emphasis, blockquote with inner block content). The CSV must be generated from a typed source file via `npm run uat:generate` (extending the existing generator), and a vitest suite must assert each fixture's sanitized output so CSV and source can never silently drift.

---

## Scope Boundaries

- The custom stylesheet path (`shouldUseStylesheet === true`) — when the user supplies their own stylesheet, body styling defers to it by design via `resolveBodyStyle`. Behavior is correct in that branch and out of scope.
- Cross-filtering, hyperlink delegation, raw HTML output, landing page, no-data message — none are reported as affected and remain out of scope.
- Reworking the formattingSettings card layout or migrating to a new property naming scheme — out of scope unless investigation proves migration is the root cause; if it is, that becomes its own plan.
- Backporting to 1.6.0.x line — this fix lands on the current branch (`fix/improve-sanitization-permissibility`) alongside the SVG sanitization work; release strategy is a separate decision.

### Deferred to Follow-Up Work

- Wiring the new `test-uat/lorem.csv` rows into the Power BI UAT `.pbip` (binding visuals, building comparison pages): deferred to a follow-up after U5 lands the CSV. The user has indicated they will do the Power BI Desktop side themselves.
- Adding lorem fixtures specifically shaped to expose the issue #144 root cause once it is known (e.g. a long nested-list fixture if list inheritance turns out to be the broken path): folded into U2/U3 if relevant, otherwise deferred.
- Extending the lorem corpus with malicious lookalikes for cert testing — the lorem corpus is for legitimate rich text only; the existing `corpus.csv` covers attack surfaces.

---

## Context & Research

### Relevant Code and Patterns

- [src/domain-utils.ts:37-106](src/domain-utils.ts) — `shouldUseStylesheet` and `resolveStyling`. `resolveStyling` is invoked with `this.container` (the outer `#htmlViewer` div) and applies four inline styles via d3 `.style()` calls: `font-family`, `font-size`, `color`, `text-align`. Each value is wrapped in `resolveBodyStyle(useSS, prop)` which returns `null` (clearing the inline style) when a custom stylesheet is in use.
- [src/domain-utils.ts:360-361](src/domain-utils.ts) — `resolveBodyStyle = (useSS, prop) => (!useSS && prop) || null`. Returns `null` to clear the inline style when `useSS` is true. **Note for investigation:** if `prop` is empty string or zero (e.g. fontSize coerces oddly), this returns `null`, which clears the style — needs verification in the repro DOM.
- [src/visual.ts](src/visual.ts) — `update()` flow. `resolveStyling(this.styleSheetContainer, this.container, this.formattingSettings)` is called unconditionally on every successful update before content is rendered. After content render, `resolveScrollableContent(this.container.node())` wraps the container in OverlayScrollbars-injected divs.
- [src/visual.ts](src/visual.ts) constructor — DOM hierarchy: `#htmlViewer` (outer, target of `resolveStyling`) → `#htmlContent` (inner, holds the actual rendered fragment). After `resolveScrollableContent`, OverlayScrollbars wraps `#htmlViewer` with `os-host`/`os-padding`/`os-viewport`/`os-content` divs.
- [src/visual-settings.ts:111-153](src/visual-settings.ts) — `ContentFormattingCardDefaultBodyStyling` group with `fontFamily`, `fontSize`, `fontColour`, `align` slots. Defaults sourced from `VisualConstants.contentFormatting.font`.
- [src/visual-settings.ts:17-29](src/visual-settings.ts) — `handlePropertyVisibility` toggles `contentFormattingCardDefaultBodyStyling.visible` based on `showRawHtml` and `shouldUseStylesheet`. **This is a candidate root-cause area:** `visible = false` may also disable property reads in some `formattingSettings` framework versions, returning defaults instead of saved values.
- [capabilities.json](capabilities.json) `objects.contentFormatting.properties` — current property layout. Needs cross-checking against any pre-cards layout that old saved visuals might still be persisting against.
- [style/visual.less](style/visual.less) — declares `#htmlViewer { width/height/overflow }` plus the `w3-theme-*` color overrides and `html-display-*` landing classes. **No font/color reset on `#htmlViewer` or its children** — inheritance from the inline styles applied by `resolveStyling` should reach rendered content unless something between `#htmlViewer` and the content sets its own.

### Institutional Learnings

- No prior `docs/solutions/` entry for this folder. The April 2025 cert work and the in-flight sanitization permissibility branch (current) are the relevant historical context.

### External References

- April 2025 cert commits — none touched `resolveStyling` or `style/visual.less`. They modified `getStrippedAttributes` in `src/domain-utils.ts` and adjusted `src/visual-constants.ts` for allowed tags/attrs/schemes. The body-styling apply path was untouched.
- The current branch (`fix/improve-sanitization-permissibility`) has reworked `src/sanitize-pipeline.ts` and `src/visual-constants.ts` — those changes are independent of body styling but should be considered for cascade conflicts (sanitizer now strips fewer SVG attributes; HTML attribute allowlist for the body container is unchanged).

---

## Key Technical Decisions

- **Reproduce before patching.** The user's "configured out" theory does not match what the code shows. Without a reproduction we are guessing. The first unit's only output is a confirmed before/after observation pair.
- **Investigate via DOM inspection in the running visual, not via additional code reading.** The remaining unknowns (computed styles, OverlayScrollbars wrapping, persisted property values) are observable in Power BI Desktop devtools but are not derivable from static analysis.
- **Lift `resolveStyling` target only if observation proves the current target is wrong.** The current target is `this.container` (`#htmlViewer`). Two alternative targets are `this.contentContainer` (`#htmlContent`, lower in the tree, before OS wrapping) and the OS-injected `os-content` div (post-wrap). The choice depends on which wrapper actually intercepts inheritance for new visual instances.
- **Prefer a CSS-cascade fix over a code-restructure fix when both work.** If the root cause is OS injecting a div with a `font-family: inherit; color: inherit` reset that breaks inheritance, the smallest fix is a stylesheet rule in `style/visual.less` that propagates the styles down. If the root cause is property-read returning defaults for new instances, the fix is in `handlePropertyVisibility` or the formattingSettings wiring.
- **Do not change `resolveBodyStyle`'s `null`-returning behavior** — it is the contract that lets a custom stylesheet take over. Investigate but do not modify unless a defect is proven there.
- **Lorem corpus pipeline mirrors the sanitization corpus.** Source = a typed `LOREM_PAYLOADS` array exporting `Payload`-shaped entries (reuse the existing `Payload` interface for symmetry), generator = the existing `scripts/generate-uat-corpus.ts` extended to emit a second CSV, vitest = a new file iterating the array and asserting `getSanitizedHtmlForTesting(input, 'html')` matches `expectedSanitized`. Reusing the type and generator keeps the two CSVs in lockstep with one toolchain rather than two.
- **Lorem fixture source lives in `test/fixtures/lorem.ts`**, not under `test-integration/csp-harness/`. The csp-harness folder is named for CSP enforcement; lorem is rendering fidelity, not CSP. The vitest suite imports directly from `test/fixtures/`, and the generator imports it via the same relative path it already uses for `corpus.ts`.

---

## Open Questions

### Resolved During Planning

- *"Was the apply code removed in the April 2025 cert commits?"* — Resolved: No. `git show` on `5a7e5d0`, `f6a06cf`, `b81c081` confirms each touched only `src/domain-utils.ts` sanitization helpers and `src/visual-constants.ts` allowed-attrs lists, not `resolveStyling` or `style/visual.less`. The user's working theory is unsupported by the diff.
- *"What is the actual root cause?"* — Resolved by the [reporter's follow-up comment](https://github.com/dm-p/powerbi-visuals-html-content/issues/144#issuecomment-4393240092): cascade override by inline `style` residue in the bound enriched-text content (Outlook/Teams/Word paste into SharePoint without plain-text mode). Branch A from the original shortlist is the path. Branches B/C/D/E are retired without further investigation.
- *"Is the visibility toggle for `contentFormattingCardDefaultBodyStyling` blocking the apply path?"* — Resolved: No. The reporter's workaround (clear-formatting in SharePoint restores expected behavior with no other changes) proves the apply path is functioning; the override is at the cascade level only.

### Deferred to Implementation

- The exact cascade-fix shape: high-specificity stylesheet rule keyed on `#htmlContent` descendants (e.g. `#htmlContent *:not([data-keep-style]) { color: var(--html-viewer-color); ... }`) **vs.** selective inline-style scrubbing in the sanitizer's `uponSanitizeAttribute` hook for the specific properties the body styling controls (color, font-family, font-size, text-align) when their values look like office-paste defaults **vs.** a hybrid (CSS rule by default, opt-out for users who want pasted styling preserved). Decided in U3 against the office-paste fixtures in [test/fixtures/lorem.ts](test/fixtures/lorem.ts).
- Whether to expose a "respect embedded styling" toggle in the format pane so users who *want* pasted styling preserved can opt out of the override. Decision deferred to U3.
- The regression test target — most likely a vitest assertion that runs each office-paste fixture through the *full* render pipeline (sanitize + apply styling) and checks computed styles in JSDOM. JSDOM's CSS support is limited but adequate for inline-vs-inherited testing on a single attribute.

---

## Implementation Units

- U1. **Reproduce the bug against the UAT report using office-paste fixtures**

**Goal:** Demonstrate the cascade override visibly in `test-uat/html-content-uat.Report` by binding the visual to the office-paste rows from `test-uat/lorem.csv` (`lorem-office-paste-paragraph`, `lorem-office-paste-bulleted-list`, `lorem-office-paste-mixed-content`) and showing that Default body styling is overridden, alongside the clean lorem rows where it applies correctly.

**Requirements:** R1, R2

**Dependencies:** U5 (already complete — provides the office-paste rows in `lorem.csv`).

**Files:**
- Modify: `test-uat/html-content-uat.Report/definition/pages/...` — add a page binding the HTML Content visual to `lorem.csv` rows, with two side-by-side visuals: one bound to a clean lorem row (`lorem-paragraph-list-paragraph`), one bound to an office-paste row (`lorem-office-paste-mixed-content`). Both have the same non-default Default body styling configured (e.g. red fontColour, 16pt fontSize, italic alignment).
- The user has indicated they will do the Power BI Desktop side themselves; this unit's deliverable from the agent side is the CSV rows (already shipped in U5) and a written description of the binding pattern for the user to follow.

**Approach:**
- Open the UAT `.pbip` in Power BI Desktop with a local-served pbiviz dev build (`npm run start`) — the user does this step.
- Refresh the `lorem.csv` data source.
- Configure two HTML Content (lite) visuals on a fresh page:
  - Visual A bound to the `sanitizedOutput` column filtered to `id = lorem-paragraph-list-paragraph` (clean — should render in the configured fontColour).
  - Visual B bound to the same column filtered to `id = lorem-office-paste-mixed-content` (office-paste — should render in `#000000` regardless of fontColour).
- Set Default body styling to a visibly distinct color/size on both visuals (same values).
- Confirm visually that Visual A renders in the configured color and Visual B does not.
- Capture a screenshot for the issue thread.

**Patterns to follow:**
- Existing UAT comparison pages already in `test-uat/html-content-uat.Report/definition/pages/`.

**Test scenarios:**
- *Test expectation: none — manual UAT reproduction. The deliverable is a captured screenshot showing two visuals with the same Default body styling rendering differently, plus a written note confirming the office-paste row triggers the override.*

**Verification:**
- Screenshot captured. Issue #144 updated with a comment linking the reporter's diagnosis to the same fixtures now in `lorem.csv`.

---

- U2. **(Retired)** — the original "Diagnose via devtools" unit is no longer needed. The reporter's [follow-up comment](https://github.com/dm-p/powerbi-visuals-html-content/issues/144#issuecomment-4393240092) supplied the diagnosis (Branch A — cascade override by office-paste inline styles). The U-ID is preserved per the stability rule; no work to do here.

---

- U3. **Apply the cascade-winning fix in the apply layer**

**Goal:** Make the visual's Default body styling win against inline `style` declarations in the bound content (the office-paste residue identified in #144), while preserving non-conflicting embedded formatting (e.g. `<strong>`, `<em>`, color spans authored deliberately for emphasis).

**Requirements:** R3, R4, R5

**Dependencies:** U1 (or in parallel — U1's UAT page is the manual verification surface, U3's vitest test is the automated one).

**Files:**
- Modify: `style/visual.less` — add a high-specificity rule that re-asserts the four body-styling properties (`color`, `font-family`, `font-size`, `text-align`) inside `#htmlContent` so the values inherited from the inline styles `resolveStyling` sets on `#htmlViewer` win against descendant inline `style` declarations.
- Modify: `src/domain-utils.ts` — change `resolveStyling` to publish the four values as CSS custom properties on `this.container` (e.g. `.style('--html-viewer-color', value)`) in addition to (or instead of) the four direct properties. This decouples the cascade-winning rule in the stylesheet from the runtime values.
- Create: `test/body-styling.test.ts` — vitest suite that runs each `lorem-office-paste-*` fixture through the full render pipeline against a JSDOM root, configures non-default body styling values, and asserts that `getComputedStyle` on the deepest text node returns the configured values (not the embedded ones).

**Approach:**
- **Two candidate shapes — pick one in implementation:**
  - **Shape α (CSS-vars + descendant rule, recommended):** `resolveStyling` writes `--html-viewer-color`, `--html-viewer-font-family`, `--html-viewer-font-size`, `--html-viewer-text-align` on `#htmlViewer`. `style/visual.less` adds `#htmlContent, #htmlContent * { color: var(--html-viewer-color); font-family: var(--html-viewer-font-family); font-size: var(--html-viewer-font-size); text-align: var(--html-viewer-text-align); }`. The `*` selector gives the rule higher specificity than an inline `style="color:#000"` on a descendant span only when paired with `!important` — so the rule needs `!important` on each declaration, **OR** the rule matches every element that *does not* itself carry an inline `color:` / `font-family:` / etc. via `:not([style*="color:"])` — clunky and fragile. Recommendation: use `!important`. The existing `w3-theme-*` rules already use `!important`, so this is consistent with the project's stylesheet idioms.
  - **Shape β (sanitizer-side property scrubbing):** extend `src/sanitize-pipeline.ts` to strip `color`, `font-family`, `font-size`, and `background-color` from inline `style` attributes when they exactly match common office-paste defaults (`#000000`, `Calibri`, `11pt`, `#ffffff`). Pros: no `!important` in stylesheet. Cons: list of "office-paste defaults" is fragile and locale-dependent; legitimate authored content using those exact values would also be stripped; surface for cert review widens.
- Recommendation: **Shape α**. Stylesheet-only side-effect, no sanitizer changes (cert posture preserved by construction), and the user can override per-document via the existing custom-stylesheet path (`shouldUseStylesheet === true` clears the inline styles on `#htmlViewer` and the CSS-var rule in `#htmlContent` falls back to whatever the custom stylesheet specifies).
- Implement the smallest viable change. Don't refactor adjacent code in the same unit.
- Verify against the U1 repro: both visuals on the demo page render with the configured Default body styling.

**Patterns to follow:**
- Existing `w3-theme-*` rules in `style/visual.less` use `!important` consistently — match that style.
- `resolveStyling`'s existing `.style(prop, resolveBodyStyle(useSS, value))` shape — extend with `.style('--html-viewer-color', ...)` etc. without changing the `useSS`-clears-via-null contract.
- The vitest pattern in `test/sanitize-pipeline.test.ts` (`getSanitizedHtmlForTesting` helper) for the rendered-HTML assertions; extend with `getComputedStyle` reads for the cascade test.

**Test scenarios:**
- *Happy path:* configure `fontColour = #ff0000`, run `lorem-office-paste-paragraph` through the full pipeline, assert computed `color` on the `<span>` text node is `rgb(255, 0, 0)` (not `#000000`). Repeat for `lorem-office-paste-bulleted-list` (computed color on each `<li><span>` text) and `lorem-office-paste-mixed-content` (computed color on the deepest `<span>` inside the `<div>`).
- *Happy path:* configure `fontFamily = "Times New Roman"`, run the same fixtures, assert computed `font-family` matches.
- *Edge case:* with `shouldUseStylesheet === true` and a custom stylesheet that does NOT specify color, assert the embedded `color:#000000` from the office-paste content survives (the custom stylesheet path defers to the user's own rules).
- *Edge case:* run a clean lorem fixture (`lorem-paragraph-list-paragraph`) through the same pipeline with non-default body styling — confirm the body styling applies (no regression on content that never had the override problem).
- *Integration:* deepest-text-node computed-style check against every `lorem-office-paste-*` fixture, parameterised by `it.each`.

**Verification:**
- The U1 repro page (manual): both visuals render in the configured Default body styling, identically.
- `npx vitest run test/body-styling.test.ts` passes for every office-paste fixture.
- Full `npx vitest run` still passes (currently 361 after U5).
- `npm run docs:check` passes.
- No regression in sanitized output: `npm run uat:generate` produces a `corpus.csv` and `lorem.csv` byte-identical to before the fix.

---

- U4. **Document the root cause and the fix**

**Goal:** Capture the diagnosis and resolution in `docs/solutions/` so the next person hitting this class of bug has institutional context.

**Requirements:** R3 (institutional follow-through, not strictly testable)

**Dependencies:** U3.

**Files:**
- Create: `docs/solutions/2026-05-issue-144-body-styling-cascade.md` (or whichever filename matches the existing convention in that folder — confirm before writing).

**Approach:**
- One short doc with: symptom, false-lead (the "configured out" theory), actual root cause, fix surface, regression test reference.
- Cross-link from the GitHub issue when closing.

**Patterns to follow:**
- Existing `docs/solutions/` entries (if any). If folder does not yet exist, this unit creates it.

**Test scenarios:**
- *Test expectation: none — documentation.*

**Verification:**
- File exists, links to the fix commit and to issue #144.

---

- U5. **Build the lorem rich-text corpus + CSV pipeline** *(complete — landed before U1, supplies the office-paste fixtures U1/U3 exercise)*

**Goal:** Stand up a typed lorem fixture source, a vitest assertion suite, and a CSV output at `test-uat/lorem.csv` that the user can bind to a Power BI UAT `.pbip` for body-styling regression visualisation. The CSV must regenerate via `npm run uat:generate` so it never drifts from the source of truth.

**Status:** Complete. 15 fixtures shipped: 12 baseline rich-text shapes plus 3 office-paste residue rows added after the [reporter follow-up](https://github.com/dm-p/powerbi-visuals-html-content/issues/144#issuecomment-4393240092) confirmed the cascade-override root cause. 19 vitest assertions pass. `test-uat/lorem.csv` regenerates deterministically.

**Requirements:** R6.

**Dependencies:** None — independent of U1-U4. Can land first, in parallel, or last. Recommended to land first so U1's repro page can bind to lorem rows.

**Files:**
- Create: `test/fixtures/lorem.ts` — exports `LOREM_PAYLOADS: Payload[]` reusing the existing `Payload` interface from [test-integration/csp-harness/corpus.ts](test-integration/csp-harness/corpus.ts). Each entry: stable `id` (`lorem-` prefix), end-user-facing `description`, `input` (raw HTML), `expectedSanitized.contains` substring assertions, `category: 'clean-baseline'` (or a new `'lorem'` category if the existing PayloadCategory union should be extended — decide in implementation), `cspCategory: 'none'`, `source: 'baseline'`.
- Create: `test/lorem-rendering.test.ts` — vitest suite that iterates `LOREM_PAYLOADS` and asserts `getSanitizedHtmlForTesting(payload.input, 'html')` contains every string in `expectedSanitized.contains` and none in `expectedSanitized.notContains`. Mirrors the loop pattern that the existing corpus runner uses against `MALICIOUS_PAYLOADS` / `CLEAN_PAYLOADS`.
- Modify: `scripts/generate-uat-corpus.ts` — import `LOREM_PAYLOADS`, run the same `buildRows` / CSV-write logic, and write a second file at `test-uat/lorem.csv`. Keep the existing `test-uat/corpus.csv` output untouched.
- Create: `test-uat/lorem.csv` — generator output; checked in. Same column shape as `test-uat/corpus.csv` (`id,description,type,category,cspCategory,source,input,sanitizedOutput`) so consumers can use one Power BI binding pattern.
- Modify: `docs/sanitization-rules.md` — under "UAT testing with the corpus", add a paragraph that names `test-uat/lorem.csv` as the second CSV and points readers at when to use which.

**Approach:**
- Decide the category-union question first: extend `PayloadCategory` with `'lorem'` (clearest intent, but touches the corpus.ts union and any exhaustive switches over it) **OR** reuse `'clean-baseline'` (zero churn, but blurs the distinction between sanitization fixtures and rendering fixtures). Recommendation: extend with `'lorem'` and add a one-line PayloadCategory comment so the boundary is explicit.
- Author 8-12 lorem entries spanning the body-styling surface:
  - **Simple text:** one short paragraph; one long paragraph
  - **Inline emphasis nested in a paragraph:** `<p>` with `<strong>`, `<em>`, `<a>`, `<code>` inside
  - **Headings hierarchy:** `<h1>` through `<h6>` in document order
  - **Ordered list:** `<ol>` with three `<li>` items
  - **Unordered list:** `<ul>` with three `<li>` items
  - **Nested list:** `<ul>` with `<li>` containing a sub-`<ul>` two levels deep
  - **Definition list:** `<dl>` / `<dt>` / `<dd>` set
  - **Blockquote with paragraphs:** `<blockquote>` containing two `<p>` and an attribution `<cite>`
  - **Article structure:** `<article>` with `<header>`, two `<section>` blocks each with `<h2>` and `<p>`, and a `<footer>`
  - **Table with text:** `<table>` with `<caption>`, header row, two body rows
  - **Mixed paragraph + list + paragraph:** approximating the bulleted-content pattern reported in issue #144
- Each entry's `expectedSanitized.contains` should pick the structurally distinctive substrings (the tag names that survive, the text content) — stay loose where postcss/marked normalisation might touch the output, tight where the entry's whole point is verifying an element survives.
- Extend `scripts/generate-uat-corpus.ts` to call `buildRows()` for both arrays and write each CSV. Avoid duplicating the `csvField` helper — extract once, reuse twice. The script's existing JSDOM bootstrap and import order stay the same.
- Add the `npm run uat:generate` documentation update inline in `docs/sanitization-rules.md` so the workflow is one regenerate command for both corpora.
- Lorem text content: use generic placeholder copy (the actual word "lorem" or short neutral filler). Do NOT copy in real Lorem Ipsum boilerplate large enough to bloat the CSV — short, structurally meaningful samples only.

**Patterns to follow:**
- [test-integration/csp-harness/corpus.ts](test-integration/csp-harness/corpus.ts) — `Payload` interface, ID naming convention, `expectedSanitized.contains` shape, "HOW TO ADD A NEW PAYLOAD" header comment.
- [scripts/generate-uat-corpus.ts](scripts/generate-uat-corpus.ts) — JSDOM bootstrap, `csvField`, `buildRows`, write-loop. Reuse rather than fork.
- [test/sanitize-pipeline-svg.test.ts](test/sanitize-pipeline-svg.test.ts) — vitest file shape with the `getSanitizedHtmlForTesting` helper, `describe` / `it` organisation.

**Test scenarios:**
- *Happy path:* every fixture in `LOREM_PAYLOADS` passes its `expectedSanitized.contains` assertions when run through `getSanitizedHtmlForTesting(input, 'html')`. Iterating `LOREM_PAYLOADS` with `it.each` (or equivalent) drives the assertions, so adding a fixture automatically adds a test.
- *Edge case:* a fixture with `expectedSanitized.notContains` (if any are added) — assert none of those strings appear.
- *Edge case:* the generator script — running `npm run uat:generate` after a fixture change must update both `corpus.csv` and `lorem.csv`. Add an assertion in the same vitest file that the row count in `LOREM_PAYLOADS` matches (a) the fixture array length and (b) the line count in `test-uat/lorem.csv` minus the header row, so a stale CSV fails CI.
- *Integration:* deleting a fixture from `LOREM_PAYLOADS`, re-running `uat:generate`, and observing both the vitest file and `lorem.csv` reflect the deletion (manual verification step, not a test).

**Verification:**
- `npm run uat:generate` produces both `test-uat/corpus.csv` (unchanged content) and `test-uat/lorem.csv` (new file with 8-12 rows).
- `npx vitest run` includes the new `test/lorem-rendering.test.ts` and all assertions pass.
- The CSV-vs-array sync assertion catches a manually-introduced mismatch (e.g. delete one row from the CSV, re-run vitest, see it fail).
- Header row shape in `lorem.csv` matches `corpus.csv` exactly.
- Existing `docs:check` still passes.

---

## System-Wide Impact

- **Interaction graph:** `Visual.update()` → `resolveStyling` (`src/domain-utils.ts`) → d3 `.style()` on a target container. After fix, also `style/visual.less` rules referencing `#htmlContent` or CSS variables — the cascade reaches the rendered fragment from `getParsedHtmlAsDom`.
- **Error propagation:** `resolveStyling` is wrapped in `Visual.update()`'s try/catch. Errors during styling currently fall through to `renderingFailed`. The fix must not introduce new exception paths.
- **State lifecycle risks:** OverlayScrollbars wraps `#htmlViewer` AFTER `resolveStyling` runs. If the fix relies on a CSS rule against an OS-injected class, that class must exist at the time the stylesheet is parsed — the global stylesheet path is fine; an inline-style approach against an OS-injected node would have a timing issue.
- **API surface parity:** No public visual-settings or capabilities.json changes. No new properties. No migration story needed.
- **Integration coverage:** Branch A/D requires a real-DOM check (computed styles in JSDOM are limited). The vitest unit test asserts the inline-style attribute is set; real cascade verification stays manual via U1's UAT page.
- **Unchanged invariants:** Sanitizer behavior is unchanged. The HTML and SVG branches in `src/sanitize-pipeline.ts` from the in-flight permissibility work are not touched. Custom stylesheet override behavior (`shouldUseStylesheet === true` clears the inline body styles) is preserved.
- **New corpus pipeline (U5):** `scripts/generate-uat-corpus.ts` becomes a two-output generator. `npm run uat:generate` continues to be the single command that regenerates both CSVs. Adding the lorem corpus does not change `corpus.csv`'s contents; it adds a sibling file with the same column shape.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The bug does not reproduce against the UAT `.pbip` (was reported on a different report) — U1 fails. | If the UAT report cannot reproduce, ask the issue reporter to attach a minimal `.pbip`, or construct one from scratch with two visuals (one saved, file closed and reopened, then a second added in a new session). |
| The "old visual works, new visual doesn't" symptom is environmental (Power BI Desktop version-specific) and we cannot reproduce. | Match the reporter's Power BI Desktop version (2.153.910.0, April 2026). Document the exact env in the diagnosis. |
| The fix lands but a downstream user's existing custom stylesheet now conflicts with the new cascade rules. | Stay inside the existing `shouldUseStylesheet` branch logic. Test the custom-stylesheet path in U3's regression test. |
| OverlayScrollbars-injected DOM is hard to target reliably with CSS (vendor classes change across versions). | If branch A/D is chosen, prefer applying styles to `#htmlContent` directly (which we own) rather than OS-injected class names. |
| Shape α's `!important` rule wins too aggressively — it also overrides legitimately-authored color/font-family in custom emphasis spans. | The lorem corpus already covers content that uses inline emphasis tags (`<strong>`, `<em>`) but NOT inline color spans. Add a follow-up fixture if a downstream consumer reports the regression. The user can also opt-out per-document via the existing custom-stylesheet path. |
| Shape α breaks an existing custom stylesheet that relies on default-body cascade behavior. | Custom-stylesheet mode (`shouldUseStylesheet === true`) clears the inline styles on `#htmlViewer` and the CSS variables resolve to nothing — descendant `var(--html-viewer-color)` then falls back to whatever the custom stylesheet (or the browser default) provides. Verified by U3's "edge case: custom stylesheet" test scenario. |
| Lorem fixtures drift away from the CSV because someone edits one without regenerating the other. | U5's vitest CSV-vs-array sync assertion fails CI in that case. The drift cannot land silently. |
| Extending `PayloadCategory` with `'lorem'` breaks an exhaustive switch elsewhere in the codebase. | Search-and-fix during U5 implementation. The union is small and used in two places (corpus.ts itself and the doc generator); cost is low. |

---

## Documentation / Operational Notes

- After fix: regenerate `docs/sanitization-rules.md` (`npm run docs:generate`) — should produce no diff since this work doesn't touch the sanitizer corpus.
- After U5: `npm run uat:generate` produces both `test-uat/corpus.csv` and `test-uat/lorem.csv`. The user binds `lorem.csv` to a Power BI UAT page that exercises Default body styling against rich-text variations.
- The fix may justify a 1.6.0.3 patch release. Release decision is separate from this plan.
- Update the GitHub issue with the diagnosis (in the comments) and link to the fix commit when merged.
- Add a one-paragraph entry to `docs/sanitization-rules.md` (in U5) naming `lorem.csv` and pointing at when each CSV is the right tool — `corpus.csv` for sanitization regression, `lorem.csv` for rendering / styling fidelity.

---

## Sources & References

- **Issue:** [dm-p/powerbi-visuals-html-content#144](https://github.com/dm-p/powerbi-visuals-html-content/issues/144)
- **Branch:** `fix/improve-sanitization-permissibility` (current)
- **Related code:**
  - [src/domain-utils.ts](src/domain-utils.ts) — `resolveStyling`, `shouldUseStylesheet`, `resolveBodyStyle`
  - [src/visual.ts](src/visual.ts) — `update()` callsite for `resolveStyling`, constructor for container DOM hierarchy
  - [src/visual-settings.ts](src/visual-settings.ts) — `ContentFormattingCardDefaultBodyStyling` group, `handlePropertyVisibility`
  - [style/visual.less](style/visual.less) — current `#htmlViewer` rules
  - [capabilities.json](capabilities.json) — `objects.contentFormatting.properties` schema
- **April 2025 cert commits referenced by the user (verified to NOT touch the apply path):** `5a7e5d0`, `f6a06cf`, `b81c081`
