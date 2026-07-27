---
title: "1.6-to-2.0 row spacing regression: implicit w3.css element styles lost on dependency removal"
date: 2026-07-28
category: ui-bugs
module: src/compatibility.ts
problem_type: ui_bug
component: tooling
severity: high
symptoms:
  - "Rows of image content gain ~4px of extra vertical spacing per row (inner row divs 48px -> 52px) after upgrading from 1.6 to 2.0"
  - "Reports that fit exactly under 1.6 overflow and show scrollbars in 2.0 with no report-level change"
  - "In mixed image+text rows, text sits on the image baseline instead of vertically centring against it"
  - "Generated DOM is byte-identical between versions and #htmlViewer inline styles match — no markup or settings diff"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - style/visual.less
  - src/visual.ts
  - src/template-engine.ts
  - src/view-model.ts
tags:
  [
    w3css,
    migration-regression,
    rendering-parity,
    compatibility-mode,
    css-defaults,
    line-height,
    image-vertical-align,
    persist-properties
  ]
---

# 1.6-to-2.0 row spacing regression: implicit w3.css element styles lost on dependency removal

## Problem

Content migrated verbatim from HTML Content 1.6 to 2.0 rendered with visibly
different vertical spacing and alignment even though the generated DOM was
byte-identical between versions — a purely environmental CSS regression
introduced by removing an unrelated dependency (w3-css, bundled in 1.6 for the
old landing page) during the 2.0 rewrite.

## Symptoms

- Rows of image content gained ~4px of vertical spacing per row after
  migration (inner row divs measured 48px in 1.6 vs 52px in 2.0).
- Reports that fit cleanly under 1.6 developed overflow/scrollbars in 2.0 with
  no content or layout change.
- In mixed image+text rows, text baseline-aligned against the image instead of
  vertically centring, producing a visible drop to the row's baseline.
- The generated DOM was byte-identical between versions
  (`<div class="htmlViewerEntry"><div><img height="48" ...></div></div>`), and
  `#htmlViewer` inline styles were identical (font-size 11pt) — ruling out a
  markup or formatting-settings diff.

## What Didn't Work

- **Suspected sanitizer attribute stripping** — theorized 2.0's rewritten
  sanitizer attribute policy dropped `style`/layout attributes from `<img>`.
  Wrong: `style` sits in the global `'*'` allowlist and per-tag allowlists are
  additive, so nothing was being stripped.
- **Suspected CSS declaration sanitizer** — theorized the CSS property
  sanitizer denylisted layout declarations. Wrong: it is denylist-based
  (`behavior`, `-moz-binding`, dangerous CSS functions only), so layout
  properties always survive.
- **Suspected capabilities.json migration losing properties** — theorized
  object/property renames silently dropped persisted values on migration.
  Wrong: 2.0's properties are a strict superset of 1.6's.
- **Suspected data role renames** — checked whether renamed roles broke the
  binding driving spacing. Wrong: the roles (content/sampling/tooltips) were
  unchanged.
- **Suspected dataViewMappings table→categorical change** — theorized the
  mapping change altered row grain. Wrong: that affects which rows exist, not
  the pixel height of an existing row's box.

The breakthrough came when the user captured and diffed the actual rendered
DOM from both versions and found it byte-identical, which reframed the search
from "what changed in the code" to "what changed in the rendering
environment" — leading to `"w3-css": "^4.1.0"` in 1.6's `package.json` and
`import 'w3-css/w3.css'` in 1.6's `src/visual.ts` (pulled in for the old
landing page, but applied globally to all rendered content since W3.CSS has no
scoping of its own). Fetching w3-css@4.1.0 and extracting its ~60
element-level rules confirmed `img{vertical-align:middle}`,
`html,body{line-height:1.5}`, the non-bold heading treatment,
`a{color:inherit}`, and border-box sizing as the silent 1.6 content
environment.

## Solution

Three parts, delivered as the legacy (v1.6) rendering compatibility mode
(branch `feat/legacy-rendering-compat`; brainstorm/plan links below).

**1. `style/visual.less`** — a scoped compatibility layer porting the
content-relevant subset of W3.CSS 4.1.0's element rules verbatim, gated behind
an `hc-legacy-v1` class and specificity-zeroed with `:where()`:

```less
:where(#htmlContent.hc-legacy-v1) {
    line-height: 1.5;
    box-sizing: border-box;
    *,
    *::before,
    *::after {
        box-sizing: border-box;
    }
    img {
        vertical-align: middle;
    }
    a {
        color: inherit;
    }
    // ... headings, hr, code/kbd/pre/samp, sub/sup, summary ...
}
```

**2. `src/compatibility.ts`** — `resolveCompatibility` implements the
precedence (persisted marker → session cache → data-bound heuristic) and the
marker is read raw from `dataView.metadata.objects`, not the
formatting-settings model:

```typescript
export const resolveCompatibility = (
    persisted: boolean | undefined,
    state: CompatibilityState,
    hasContentRole: boolean,
    editable: boolean
): CompatibilityResolution => {
    if (persisted !== undefined) {
        state.mode = persisted;
        state.persistAttempted = false; // re-arm: a later reset re-stamps
        return { legacyRendering: persisted, shouldPersist: false };
    }
    if (state.mode === undefined) {
        state.mode = hasContentRole; // data bound => migrated => legacy ON
    }
    return {
        legacyRendering: state.mode,
        shouldPersist: editable && !state.persistAttempted
    };
};

export const readPersistedLegacyRendering = (
    dataView: powerbi.DataView | undefined
): boolean | undefined => {
    const value = dataView?.metadata?.objects?.compatibility?.legacyRendering;
    return typeof value === 'boolean' ? value : undefined;
};
```

**3. `src/visual.ts`** — the marker stamp is deferred via `setTimeout(..., 0)`
so it runs strictly after the current update's
`renderingFinished`/`renderingFailed`, preserving the certified 1:1
update→rendering-event contract; `destroy()` cancels the pending timer:

```typescript
public update(options: VisualUpdateOptions) {
    // ...
    const persistPending = this.resolveCompatibilityForUpdate(options);
    // ... try { renderUpdate } catch { handleUpdateFailure } ...
    this.flushCompatibilityPersist(persistPending);
}

private flushCompatibilityPersist(pending: boolean): void {
    if (!pending) return;
    this.compatState.persistAttempted = true;
    const legacyRendering = this.compatState.mode === true;
    this.compatPersistTimer = setTimeout(() => {
        this.host.persistProperties({
            merge: [{
                objectName: 'compatibility',
                selector: null as unknown as powerbi.data.Selector,
                properties: { legacyRendering }
            }]
        });
    }, 0);
}
```

A third piece makes the default row wrapper mode-dependent —
`VisualConstants.templates.row` (legacy `<div><div>{{row}}</div></div>`) vs
`.rowModern` (`<div>{{row}}</div>`) — with an empty-string TextArea default as
the "unauthored" sentinel so an author-supplied template always wins, and the
resolved template folded into `computeRenderFingerprint` so toggling the mode
forces a rebuild.

Verified by 1168 vitest tests, including `test/w3-compat.test.ts` (compiles
the LESS in-test, asserts compiled rule shapes, and a leak test proving no
compat rule escapes the gated scope) and `test/compatibility-wiring.test.ts`
(real `Visual` + host stub + fake timers pinning persist-after-rendering-event
ordering, once-per-session, view-mode-never, destroy cancellation), plus
Desktop UAT.

## Why This Works

- **Line-box arithmetic**: at 11pt (≈14.67px) Segoe UI, the text strut's
  descent is ≈3.9px below the baseline. With UA-default
  `vertical-align: baseline`, a 48px image sits on the baseline and the strut
  descent still occupies space below it → line box ≈52px. W3.CSS's
  `img { vertical-align: middle }` centres the image on the strut midpoint, so
  the image height fully contains the strut and the line box is exactly 48px —
  what 1.6 actually rendered.
- **`:where()` preserves the cascade**: `:where(...)` contributes zero
  specificity, so the ported rules sit at the same effective specificity as
  W3.CSS's bare element selectors did in 1.6 — a user stylesheet (injected
  into `<head>` after the bundle) still wins ties by source order.
- **Raw `metadata.objects` is the only reliable marker read**: the
  formatting-settings model normalizes absent values to the schema default, so
  it cannot distinguish "never classified" from "explicitly set to the
  default". Only the raw dataView preserves `undefined`, which the
  run-the-heuristic-once contract depends on.
- **Persist must trail the rendering event**: certified visuals pair each
  `update()` 1:1 with `renderingFinished`/`renderingFailed`. Persisting inside
  the update risks the property echo re-entering before the pair closes;
  deferring to a fresh task guarantees the echo arrives as an ordinary new
  update with its own event pair.

## Prevention

- Before removing (or adding) any dependency, audit its global CSS and other
  side-effect imports — `grep -rn "^import '" src` finds bare side-effect
  imports; framework CSS with unscoped element selectors silently becomes part
  of the rendering environment for **all** content.
- When a regression shows byte-identical DOM/props but different rendered
  output, stop diffing the code and diff the environment instead: global
  stylesheets, `<head>` injection order, UA defaults, transitive framework
  CSS.
- Keep compiled-CSS assertion tests (`test/w3-compat.test.ts` style: compile
  the `.less` in-test, assert rule shapes, include a scope-leak test) for any
  style contract that is load-bearing for visual parity.
- When inspecting packaged artifacts (`dist/*.pbiviz`) select by newest
  mtime, not alphabetically — stale packages accumulate and an alphabetical
  pick can silently inspect last week's build.

## Related Issues

- Upstream design docs:
  `docs/brainstorms/2026-07-27-legacy-rendering-compatibility-mode.md`
  (decisions) and
  `docs/plans/2026-07-27-001-legacy-rendering-compatibility-mode-plan.md`
  (implementation plan).
- `docs/solutions/2026-05-issue-144-body-styling-cascade.md` — complementary
  "silent CSS cascade surprise" precedent in `#htmlContent` (pasted inline
  styles rather than a removed global stylesheet).
- `docs/solutions/conventions/classify-rename-runtime-vs-persisted-before-applying-2026-06-20.md`
  — the persisted-vs-runtime classification discipline the
  `compatibility.legacyRendering` marker design follows.
- `docs/solutions/best-practices/forced-colors-overrides-pbi-theme-backgrounds-2026-06-30.md`
  — prior art for class-gated CSS layers on `#htmlContent` (`.pbi-theme-hc`).
- GitHub issues: none found for "migration rendering" / "spacing 2.0"
  (searched via `gh`, zero matches).
