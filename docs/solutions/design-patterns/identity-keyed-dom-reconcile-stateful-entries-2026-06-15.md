---
title: "Identity-keyed DOM reconcile to preserve stateful entries across Power BI updates"
date: 2026-06-15
category: design-patterns
module: src/render-orchestrator.ts
problem_type: design_pattern
component: tooling
severity: high
applies_when:
  - "A d3/keyed-DOM render loop wipes and rebuilds its whole node set on every update"
  - "Entries embed stateful DOM (iframes, video, drag targets) destroyed by node recreation"
  - "Each entry has a stable per-item identity that survives across updates"
  - "The host issues updates for viewport changes (resize/view-mode) with no content change"
  - "A sanitizer/output-affecting setting can change at runtime"
related_components:
  - src/domain-utils.ts
  - src/visual.ts
tags:
  - dom-reconciliation
  - d3-keyed-join
  - iframe-preservation
  - render-lifecycle
  - identity-key
  - settings-fingerprint
  - stateful-dom
---

# Identity-keyed DOM reconcile to preserve stateful entries across Power BI updates

## Context

The visual renders user HTML — including `<iframe>` embeds, video, and draggable widgets — into entry nodes. The old `Visual.update()` ran an unconditional `this.contentContainer.selectAll('*').remove()` on **every** Power BI update (resize, cross-filter, view-mode, refresh) before rebuilding all entries. Destroying an `<iframe>` element makes the browser reload its `src`, discarding scroll position, playback, auth session, and in-iframe interaction. A naive "skip if unchanged" guard is unsafe for a sanitizer-heavy certified visual, because Power BI's update type does not reliably flag formatting-only changes — so skipping could retain stale, wrongly-sanitized DOM.

## Guidance

A reusable render-lifecycle pattern in five composable steps (implemented in [src/render-orchestrator.ts](../../../src/render-orchestrator.ts), [src/domain-utils.ts](../../../src/domain-utils.ts), [src/visual.ts](../../../src/visual.ts)).

**1. Classify the update before touching DOM.** A small pure classifier decides whether entries need work at all:

```ts
// firstRender || has-Data-bit || settings-changed
return firstRender || (updateType & DATA_BIT) === DATA_BIT || fingerprintChanged;
```

Viewport-only updates (resize/view-mode: no Data bit, unchanged fingerprint) skip **all** entry teardown — only cheap container work (styling, scroll) runs. This alone stops iframe-reload-on-resize in *both* render modes.

**2. Dispatch reconcile only when safe.** Reconcile runs only when the user opted in (`renderMode === 'reconcile'`), it isn't the first render, the kind (populated vs empty/raw) is unchanged, and the fingerprint is unchanged. Otherwise: full rebuild.

**3. Identity-keyed d3 join (the core).** Key the join on each entry's *stable* identity, not its index:

```ts
const joined = container.selectAll('.entry')
    .data(data, (d) => d.identity.getKey()); // stable per data point (from the categorical mapping)
joined.exit().remove();
const entered = joined.enter().append('div').classed('entry', true);
const merged = entered.merge(joined);
merged.order(); // re-sequence retained nodes for reorders WITHOUT recreating them
```

A retained node is the *same* `HTMLDivElement` across updates, so an `<iframe>` inside it is never removed — never reloaded.

**4. Content-diff stash: render only the changed subset.** Stamp what was last rendered onto each node; re-render only entered + content-changed nodes:

```ts
const changed = joined.filter(function (d) { return this.__renderedContent !== d.content; });
const toRender = entered.merge(changed);
stampRenderedContent(toRender); // baseline stamped before the destructive render
return { merged, toRender };
```

The destructive render (`resolveHtmlGroupElement`, which wipes+rebuilds inner content) only ever sees `toRender`. **Contract:** the caller MUST render the entire `toRender` — a partial render leaves nodes stamped "rendered" that weren't.

**5. Fingerprint = the authoritative settings-change signal.** A stable `JSON.stringify` of every parse/output-affecting setting (format, hyperlinks, showRawHtml, userSelect, renderMode, stylesheet, body-styling). It exists because the host's update type doesn't reliably flag formatting changes. A fingerprint change forces a full rebuild even in reconcile mode — so reconcile can never retain stale under/over-sanitized DOM. Cross-filter/transparency settings are deliberately excluded (they only drive container CSS re-applied every update).

Plus: **opt-in via a property, default rebuild** — existing reports are byte-for-byte unchanged until the author chooses reconcile.

## Why This Matters

- **Stateful DOM survives.** Iframes/video/drag state persist across cross-filter, refresh, and resize because their nodes are retained, not recreated.
- **Safe in a sanitizer/certified context.** The fingerprint is the correctness guarantee: every setting feeding the sanitizer is in it, so any output-affecting change drops to rebuild and regenerates DOM through the sanitizer. Reconcile retains DOM *only when the sanitizer config is provably unchanged*.
- **Helps even the default mode.** The viewport-only fast path gates all entry teardown, so a pure resize/view-mode update never wipes — benefiting rebuild mode too.

## When to Apply

Apply when a keyed-DOM render loop wipes+rebuilds wholesale, entries have a stable identity, and at least some embed stateful content destroyed by recreation (iframes, media, canvas, drag, third-party widgets), especially under a host that issues content-free viewport updates.

Don't bother when entries are cheap stateless text/SVG (the join + diff overhead buys nothing), or when there's no reliable per-item key (index-based matching can't preserve state across reorders).

## Examples

**Before** — `selectAll('*').remove()` every update → every resize/cross-filter reloads all iframes.

**After** — a cross-filter update with unchanged content: keyed join retains every node, `toRender` is empty (content stash matches), `resolveHtmlGroupElement` touches nothing, `merged.order()` preserves order → iframes untouched. A resize: classifier returns viewport-only → entries never touched.

**Fingerprint forces rebuild** — user switches format html→markdown: fingerprint changes → dispatch falls through to rebuild → all entries regenerate through the sanitizer under the new setting; no retained node holds DOM from the old config.

**Two invariants to preserve when extending this:**
- The `update()` catch does a *full* container wipe — load-bearing, because the stash is advanced before the destructive render, so a mid-render throw must destroy the poisoned nodes (see [the catch comment in visual.ts](../../../src/visual.ts)).
- Hyperlink handlers bind *after* content render (`resolveHyperlinkHandling` selects existing `<a>` over the container) — binding pre-render misses freshly rendered anchors (a real regression caught in review).

## Related

- **Issues sharing this root cause (DOM destroyed every update):** [#47](https://github.com/dm-p/powerbi-visuals-html-content/issues/47) (draggable state — open; named in the brainstorm as the likely root). Historically-related symptoms now plausibly addressed by reconcile mode, worth re-checking in UAT before claiming closure: [#96](https://github.com/dm-p/powerbi-visuals-html-content/issues/96) (JS-created DOM resets on resize/refresh), [#111](https://github.com/dm-p/powerbi-visuals-html-content/issues/111) (iframe login state lost).
- **Origin docs:** [docs/brainstorms/2026-06-13-render-lifecycle-modes.md](../../brainstorms/2026-06-13-render-lifecycle-modes.md), [docs/plans/2026-06-13-001-render-lifecycle-modes-plan.md](../../plans/2026-06-13-001-render-lifecycle-modes-plan.md).
- **See also:** [esbuild/vitest const-enum trap](../tooling-decisions/esbuild-vitest-const-enum-external-dts-not-inlined-2026-06-15.md) — surfaced while unit-testing this orchestrator's update classifier; relevant the moment you write tests touching `VisualUpdateType`.
