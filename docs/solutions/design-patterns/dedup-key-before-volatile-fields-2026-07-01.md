---
title: "Compute the dedup key before attaching volatile fields to a deduplicated event log"
date: 2026-07-01
category: design-patterns
module: src/diagnostics/event-recorder.ts
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "A diagnostics/event log de-duplicates consecutive identical entries by a derived key"
  - "You want to attach a per-event field that changes on every firing (pointer coords, timestamps, scroll offset)"
  - "The event fires on a high-frequency handler (mousemove, scroll, resize)"
related_components:
  - src/diagnostics/host-events.ts
  - src/interactivity/tooltips.ts
  - src/interactivity/behavior.ts
tags:
  - dedup
  - event-log
  - diagnostics
  - mousemove
  - tooltip
  - ring-buffer
---

# Compute the dedup key before attaching volatile fields to a deduplicated event log

## Context

The diagnostics Events tab records host events (tooltip show/hide, cross-filter, context-menu) into a bounded ring buffer. Decision 9/10 de-duplication collapses *consecutive identical* tooltip events so a single hover doesn't spam the log — the dedup key is `${phase}|${source}|${context}`.

We wanted to add pointer coordinates (`@ (x,y)`) to tooltip **show** events. Tooltip show fires on `mouseover mousemove`, so the handler runs on every pixel of movement over the same data row.

## Guidance

Keep volatile, per-firing fields **out of the dedup key**. Compute the key from the stable identity of the event, check/skip on it, and only *then* stamp the volatile field onto the stored record.

```ts
const key = `${phase}|${source}|${context}`;   // stable identity — no coords
if (key === lastTooltipKey) return;            // dedup decision happens here
lastTooltipKey = key;
// Coords prefix the context on show only; hide carries no context. The
// key (above) excludes coords so mousemove jitter still de-dups.
const coords = phase === 'show' ? `${eventCoords(event)} ` : '';
push({ ts: Date.now(), type: 'tooltip', summary: `${phase} · ${source}`,
       context: `${coords}${context}` || undefined });
```

The coordinate formatter itself lives in the diagnostics layer (`host-events.ts`, alongside `tooltipContext`), not in `interactivity/tooltips` — so the recorder imports *downward* into diagnostics rather than the recorder reaching up into interactivity.

## Why This Matters

Had coords gone into the dedup key, every mousemove would produce a unique key, the dedup would never fire, and a single hover would flood the bounded buffer with near-identical entries — evicting genuinely distinct events and defeating the whole feature. The buffer is dev-only, so this fails quietly: no crash, just a useless log. The first recorded entry keeps its coords; subsequent jitter collapses into it, which is exactly what a human reading the log wants.

The same split applies to any "derived display value that changes every firing" — timestamps, scroll position, cursor coords. Identity decides dedup; presentation is layered on after.

## When to Apply

- Adding a high-cardinality or per-firing field to any deduplicated/throttled log
- The producing handler is high-frequency (mousemove, scroll, resize, pointermove)
- The dedup is by value-equality of a composed key rather than by object identity

## Examples

Lock the design in with a test that passes **different** coords through two otherwise-identical shows and asserts they still collapse — it fails the moment someone folds coords into the key:

```ts
it('collapses consecutive identical shows even when coords differ', () => {
    recordTooltipEvent(ev(10, 20), 'show', 'contextual', 'A');
    recordTooltipEvent(ev(99, 88), 'show', 'contextual', 'A');
    expect(snapshot()).toHaveLength(1);
});
```

## Related

- [identity-keyed-dom-reconcile-stateful-entries](identity-keyed-dom-reconcile-stateful-entries-2026-06-15.md) — the inverse case: there, stable identity *preserves* DOM across updates; here, stable identity *collapses* log entries.
- PR #177 (`refactor/diagnostics-nomenclature`) — introduced `eventCoords()` and renamed the `drill` host-event to `context-menu`.
