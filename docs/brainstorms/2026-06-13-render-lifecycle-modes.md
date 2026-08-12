---
title: Render lifecycle modes (WP-B)
date: 2026-06-13
status: approved
related_issues:
    - https://github.com/dm-p/powerbi-visuals-html-content/issues/47
---

# Render lifecycle modes (WP-B)

## Problem

[src/visual.ts:140](../../src/visual.ts#L140) runs `this.contentContainer.selectAll('*').remove()` **unconditionally on every `update()`**, before the update-type check. So every resize, view-mode toggle, and settings tweak tears down all entry DOM and rebuilds it from scratch. The `.data().join()` inside [bindVisualDataToDom](../../src/domain-utils.ts#L444) is already a keyed-join shape, but it can never retain a node because the wipe one line earlier always empties the container first. [resolveHtmlGroupElement](../../src/domain-utils.ts#L289) compounds this — it wipes and rebuilds each entry's inner content on every call.

The user-visible cost: an entry containing an inline `<iframe>` reloads on every update even when its URL and content are unchanged — losing scroll position, playback, auth state, and any in-iframe interaction whenever the report is resized, cross-filtered, or refreshed. The same DOM-state-destruction is the likely root of [#47](https://github.com/dm-p/powerbi-visuals-html-content/issues/47) (draggable state not surviving).

This is the second of three planned architectural work packages (WP-A: categorical mapping, shipped in 2.0.0; WP-B: this; WP-C: templating). The prep step it carries — extracting a rendering orchestrator from the five-responsibility `update()` — is also the seam WP-C will build on.

## Users and outcome

**Primary user:** a report author who embeds inline iframes (dashboards, videos, maps, embedded apps) or other stateful DOM in HTML measures, and a viewer interacting with that content.

**Outcome that changes for them:**

- Today: any update reloads every iframe; a resize or cross-filter interrupts whatever the viewer was doing inside it.
- After this change: with the new mode enabled, an entry's DOM (and its iframe) is preserved across updates whenever its identity and content are unchanged — so unchanged iframes don't reload. Even in the default mode, a viewport-only update (resize, view-mode) no longer tears entries down.

## Goals

1. Add a format property that selects the render lifecycle: **Rebuild** (default, current behavior) or **Reconcile** (preserve unchanged entries). Default Rebuild keeps existing reports non-breaking.
2. In Reconcile mode, an entry's DOM survives an update when its selection identity persists, its content string is unchanged, and no parse-affecting setting changed. Changed entries re-render; added/removed entries enter/exit.
3. In **both** modes, viewport-only updates (Resize / ResizeEnd / ViewMode / Style with no Data change) stop tearing down entries — fixing iframe-survival-on-resize for everyone.
4. Extract a rendering orchestrator (`src/render-orchestrator.ts`) from `Visual.update()`, reducing `update()` to Power BI lifecycle plumbing plus the error envelope.
5. Zero sanitizer-surface churn: `docs/sanitization-rules.md` and `test-uat/*.csv` untouched; the new property never reaches the sanitizer.

## Non-goals

- **Skip-when-output-identical as a separate third mode.** Subsumed by Reconcile: when nothing changed, the keyed join performs no DOM work. No user-facing third mode.
- **Vanilla-JS rewrite of the render path to drop d3.** `d3-selection` (27 KB) is pulled in transitively by `powerbi-visuals-utils-interactivityutils` for cross-filtering, so it stays in the bundle regardless; its `.data().join(key)` is the exact primitive Reconcile needs. A bundle diet (overlayscrollbars, js-beautify, formatting utils) is a separate work package.
- **Reordering optimisation beyond what identity-keying gives for free.** Identity-keyed join already retains reordered rows via `.order()`; no extra work.
- **Templating / static header-footer (#127, #138).** WP-C.
- **Highlight / interaction expansion (#153).** Out of scope.

## Approach (recommended): orchestrator + identity-keyed d3 join

A new module `src/render-orchestrator.ts` owns the render flow; `Visual.update()` keeps only lifecycle plumbing. (Alternatives rejected: imperative DOM diff with content-hash attributes — reinvents d3's keyed join with more code and test surface; whole-output short-circuit only — does nothing for the one-row-changed case the iframe scenario needs.)

### 1. Architecture: orchestrator + update classification

Extract everything inside the `try` at [visual.ts:139–222](../../src/visual.ts#L139-L222) into a `RenderOrchestrator` class that holds the container references the constructor builds today. `Visual.update()` becomes: parse settings → `renderingStarted` → `orchestrator.render(options, viewModel, settings)` → landing page → `renderingFinished`, with the existing `catch` → `renderingFailed` + status fallback unchanged.

The orchestrator's first action is to classify the update **before** mode matters:

- **Entry-affecting** = `firstRender || (options.type & VisualUpdateType.Data) || fingerprintChanged` → re-evaluate entries; mode decides how.
- **Viewport-only** = a Resize/ResizeEnd/ViewMode/Style update with no Data bit and unchanged fingerprint → skip all entry teardown and rendering; re-run only the cheap container-level resolvers (styling, scroll). This removes the unconditional wipe for both modes (Goal 3).

The settings fingerprint (below) is recomputed every update as the safety net: a settings change that somehow arrives without the Data bit is still caught, so output is never stale.

### 2. Reconcile mechanics

**Key** the join on `d.identity.getKey()` — stable per data point across updates (WP-A), collision-free for distinct rows, reorder-safe.

- **enter** (new identity) → create wrapper, render content via [resolveHtmlGroupElement](../../src/domain-utils.ts#L289).
- **update** (identity seen before) → compare new `d.content` against the content stashed on the node at last render (a d3 `.property('__renderedContent', …)` JS property — exact comparison, no hashing, no DOM bloat). Unchanged → do nothing (wrapper, rendered DOM, live iframe survive). Changed → re-render just that node and re-stash.
- **exit** (identity gone) → remove.

Correctness pivot: `resolveHtmlGroupElement` is destructive per element, so it must be called only on the enter-plus-changed subset, never the merged selection. The binding helper returns the sub-selections; the orchestrator renders selectively.

**Settings changes force a full rebuild even in Reconcile**: when format, hyperlinks, stylesheet, or body-styling change, `d.content` is identical but its rendered output differs, so the content-diff would wrongly skip. A fingerprint change degrades Reconcile to a clean rebuild — acceptable, since settings edits are interactive and rare.

**Always re-runs every entry-affecting update, both modes, on the merged selection:** container styling, the interactivity/selection bind, hover/tooltip binding, hyperlink click delegation, scroll resolution. These rebind closures capturing fresh data; they are idempotent (d3 `.on` replaces) and cheap. Reconcile's savings are specifically: skipping the container wipe, retaining unchanged DOM, and skipping parse+sanitize for unchanged entries.

**Net survival condition:** an entry's DOM (and iframe) survives exactly when its identity persists, its content string is unchanged, and no parse-affecting setting changed.

### 3. The mode property

Mirrors the existing `format` (Renderer) enumeration:

- [types.ts](../../src/types.ts): `export type RenderMode = 'rebuild' | 'reconcile';`
- [capabilities.json](../../capabilities.json) `contentFormatting.properties`: a `renderMode` enumeration with members `rebuild`, `reconcile`, structured like `format`.
- [visual-constants.ts](../../src/visual-constants.ts): `renderMode: <RenderMode>'rebuild'` default.
- [visual-settings.ts](../../src/visual-settings.ts): a `renderMode` `AutoDropdown` slice in `ContentFormattingCardBehavior`.
- [stringResources/en-US/resources.resjson](../../stringResources/en-US/resources.resjson): `Objects_ContentFormatting_RenderMode` (+ `_Description`), `Enum_RenderMode_Rebuild`, `Enum_RenderMode_Reconcile`.

User-facing labels (final): property **"Update behavior"**; `rebuild` → **"Rebuild content"** (default); `reconcile` → **"Preserve unchanged content"**.

Default `rebuild` makes the property itself non-breaking. The one deliberate behavior change for existing reports is Goal 3 (viewport-only updates no longer tear down) — a release-notes item.

### 4. Error handling & edge cases

- **All-or-nothing envelope:** any orchestrator throw (including a sanitizer edge while re-rendering one node mid-reconcile) propagates to the outer `catch` → `renderingFailed` + content wipe + status. A partial reconcile is never left on screen.
- **First render** = all enter → identical paint in both modes; only seeds the fingerprint.
- **Runtime mode switch:** `renderMode` is included in the fingerprint, so flipping the dropdown forces one clean rebuild → valid Reconcile baseline thereafter; Reconcile never inherits un-stashed nodes.
- **State-kind transitions** (populated ↔ no-data message ↔ raw textarea): the orchestrator tracks the prior render kind and forces a clean container reset on any kind change. Reconcile applies only within populated-rendered → populated-rendered.
- **Scroll-position preservation:** [resolveScrollableContent](../../src/domain-utils.ts#L315) currently reconstructs the OverlayScrollbars instance each update; the plan should reuse the existing instance (`.update()`) so a scrolled position survives a reconcile — verified empirically at implementation time.
- **Fingerprint contents:** `format`, `hyperlinks`, `showRawHtml`, `userSelect`, stylesheet text, the five default-body-styling props, and `renderMode`. Cross-filter/transparency props are excluded — dimming is applied by the interactivity layer's `renderSelection` outside the render path.
- **Duplicate-key safety:** the key assumes `identity.getKey()` is unique per row (holds for WP-A identities). If duplicates ever occur, d3 binds only the first, and Rebuild mode is the always-correct escape hatch one click away.

### 5. Testing strategy

The decisions are extracted as pure functions, isolating them from the d3/host-heavy render path (the WP-A adapter pattern):

1. **Update classifier** — `classify(type, firstRender, fingerprintChanged)` exhaustive vitest table; this test is the regression guard for the resize-teardown bug.
2. **Fingerprint** — equal/different across each contributing and non-contributing property.
3. **Content-diff** — render/skip from stashed vs new content.
4. **Key derivation** — `identity.getKey()` selection and duplicate-key fallback.
5. **DOM binding (vitest + jsdom)** — bind `[a,b,c]`, capture node references, re-bind `[a,b',c]`, assert a/c are the same element references (retained, iframe-survival proof at DOM level) and b re-rendered; `[a,c]` proves exit. jsdom already hosts d3 in existing domain-utils tests.
6. **Iframe survival (Playwright)** — render an entry with a live `<iframe src>`, observe it, push a reconcile update with unchanged content → same iframe node, no reload; content change → re-render; resize in rebuild mode → iframe survives (Goal 3). New harness use beyond the sanitizer corpus; budget a small extension.
7. **Parity = existing suite green.** Rebuild is default, so current rendering tests (lorem, hyperlinks, stylesheet, body-styling) passing unchanged is the parity proof; 746 unit + 147 integration green; `docs:check` green; zero `test-uat/*.csv` regen.
8. **Manual UAT (Power BI Desktop):** inline-iframe-with-stable-URL in reconcile across data refresh / cross-filter / resize; runtime mode switch; raw-HTML toggle; empty↔populated transitions; scroll-position survival; dev-visual/AppSource-swap caution.

## Migration and compatibility

- **Default Rebuild** = current behavior for existing reports, except viewport-only updates no longer tear down (Goal 3) — release-notes item, no property change required.
- New `renderMode` property defaults so saved reports render identically; opting into Reconcile is an explicit author choice.
- All three editions (lite, standard, standalone) inherit the property from shared capabilities.json.
- Zero sanitizer-surface churn — no `docs/sanitization-rules.md` regen, no UAT CSV regen.

## Follow-up work

- **WP-C:** templating paradigm (#127, #138), building on the orchestrator seam.
- **Bundle diet** (separate WP): overlayscrollbars / js-beautify / formatting utils are the real bundle weight; d3 is not.
- **#47** (draggable state) should be re-checked under Reconcile — the same DOM-preservation likely resolves it; confirm in UAT and close if so.
