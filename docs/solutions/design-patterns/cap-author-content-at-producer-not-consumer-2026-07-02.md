---
title: "Cap author-content work at the producer, not the consumer"
date: 2026-07-02
category: design-patterns
module: src/domain-utils.ts
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "A size/length cap is applied to author-supplied content that can be multi-MB per measure"
  - "The cap sits after an expensive serialize/beautify/stringify step instead of before it"
  - "Rendered DOM is serialized (getRawHtml) or console args are JSON.stringify'd before a downstream cap"
  - "Any feature reads or serializes rendered output on a hot path"
related_components:
  - src/diagnostics/console-capture.ts
tags:
  - bounds
  - dos
  - input-cap
  - serialization
  - js-beautify
  - console-capture
  - performance
---

# Cap author-content work at the producer, not the consumer

## Context

Report authors routinely bind measures that emit multi-megabyte HTML (≈2 MB per measure is normal). Several diagnostic/debug paths transform that content: serialize the live DOM to a dev-tools string, run it through `js-beautify` (`pretty()`), colorize it into span nodes, `JSON.stringify` console args, and slice it into a fixed-size snapshot for the diagnostics dialog. Each transform has a per-byte cost, and several are super-linear (beautify) or allocation-heavy (concatenate-then-slice).

The trap is placing the size cap where the bytes are *consumed*. `buildSnapshot` sliced `rawHtml` to `rawHtmlCapBytes` ([diagnostics-snapshot.ts](../../../src/diagnostics/diagnostics-snapshot.ts)), and `console-capture` sliced the final joined line to `consoleLineCap`. By the time the consumer slices, the expensive work has already run on the full uncapped input — the cap trails the cost instead of governing it.

## Guidance

Place the cap at the **producer** — the point that first materializes or transforms the large value — so it governs the expensive operation rather than trailing it.

**1. `getRawHtml` ([domain-utils.ts](../../../src/domain-utils.ts), `getRawHtml`) — cap before `pretty()`** (commit `7a31487`). The cap used to live downstream in `buildSnapshot`, so `pretty()` froze on the whole multi-MB string:

```ts
// before — beautify runs on uncapped input; the cap is downstream
const raw = `${ssFragment}${ssFragment ? ' ' : ''}${domSerialize(contentNode)}`;
return pretty(raw);

// after — truncate and skip pretty() above the cap, before beautify runs
const raw = `${ssFragment}${ssFragment ? ' ' : ''}${domSerialize(contentNode)}`;
const cap = VisualConstants.diagnostics.rawHtmlCapBytes;
if (raw.length > cap) {
    return raw.slice(0, cap);
}
return pretty(raw);
```

This matters doubly because `getRawHtml` runs on **every render** when "Show Raw HTML" is on (via `resolveForRawHtml`), not only when the dialog opens.

**2. `console-capture` `push()` ([console-capture.ts](../../../src/diagnostics/console-capture.ts)) — cap each arg as rendered, not just the join** (commit `0cf21cc`):

```ts
// before — several multi-MB args are concatenated in full, then all but cap discarded
const text = args.map(stringify).join(' ').slice(0, VisualConstants.diagnostics.consoleLineCap);

// after — cap each arg as it is rendered; join is bounded to ~N*cap
const cap = VisualConstants.diagnostics.consoleLineCap;
const text = args.map((a) => stringify(a).slice(0, cap)).join(' ').slice(0, cap);
```

**3. Document the residual honestly.** Both fixes carry an explicit `ponytail:` comment naming where a single full-size pass still survives: `getRawHtml` still materializes the walker string once (`domSerialize` builds it whole), and one huge non-string console arg is still `JSON.stringify`-d once to produce its text. These are inherent to capturing the value at all; a budget-aware serializer is a documented upgrade path, deliberately not built until measured.

The cap constants themselves live in one home — [visual-constants.ts](../../../src/visual-constants.ts) (`diagnostics` block) — and are not restated here; see the diagnostics-snapshot roundtrip doc for the full channel list.

## Why This Matters

A consumer-side cap gives false confidence: the DOM is protected, the retained buffer is bounded, the dialog renders — but the main thread already froze on the beautify pass and transient memory already spiked to the full input size. The cost that matters is the *work*, not the *retained output*, so the cap has to sit in front of the work. Moving it upstream is usually a one-line change with no behavior loss, because the truncated output was going to be sliced to the same size anyway.

## When to Apply

Apply when **all** hold:

- An input can be adversarially or accidentally large (untrusted author content, uploads, log lines, API responses).
- A transform on it is super-linear, allocation-heavy, or on a hot path (beautify/format, syntax highlight, `JSON.stringify`, full-DOM serialize, backtracking regex).
- A size cap already exists — but downstream of the transform.

The tell: "we already cap it," but the cap is a `.slice()` applied to the *result* of the expensive step. Move it to that step's input. When a residual full-size pass genuinely can't be removed without a rewrite, leave a comment naming it as a bounded, measured-if-needed upgrade path rather than pretending it's gone.

## Examples

**Done right (producer-side by construction):**

- `highlightSizeLimit: 200 * 1024` — the colorizer ([highlight-html.ts](../../../src/diagnostics/highlight-html.ts)) short-circuits above 200 KB to a single text node instead of per-token spans, so the check sits in front of the node explosion. Its scan is `indexOf`-based (never backtracking), so literal `<` in author text can't trigger super-linear runtime.
- `consoleBufferCap: 200`, `eventBufferCap: 200` (+ `eventContextItems: 3` / `eventContextCap: 80` per-event), `sanitizerEntryCap: 1000` — ring buffers that evict at capture time, bounding retained state regardless of volume.

**Done wrong → fixed:** `getRawHtml` (commit `7a31487`) and `console-capture` (commit `0cf21cc`), above.

## Related

- [powerbi-modal-dialog-diagnostics-snapshot-result-roundtrip-2026-06-19.md](../architecture-patterns/powerbi-modal-dialog-diagnostics-snapshot-result-roundtrip-2026-06-19.md) — companion doc on *which* snapshot channels to bound; this doc refines it with *where* to place each cap (producer vs consumer). Cap constants live there / in `visual-constants.ts`, not restated here.
- [show-raw-html-dev-tools-serializer-2026-05-15.md](../ui-bugs/show-raw-html-dev-tools-serializer-2026-05-15.md) — describes `getRawHtml`/`domSerialize`/`pretty()`, the producer this pattern gates.
