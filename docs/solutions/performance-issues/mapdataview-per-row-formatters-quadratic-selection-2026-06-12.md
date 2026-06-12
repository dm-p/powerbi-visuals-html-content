---
title: "mapDataView hot path: per-row formatter creation and quadratic selection scans"
date: 2026-06-12
category: performance-issues
module: src/view-model.ts
problem_type: performance_issue
component: tooling
severity: medium
symptoms:
  - "valueFormatter.create() ran for every metadata column on every row, twice per row (sampling + tooltips passes), with results discarded for non-matching columns"
  - "Selection reconciliation ran selectionId.equals() against the full previous entry list for every new row — quadratic across updates"
  - "Latent until the categorical migration raised the row cap from the host default to an explicit 30,000, multiplying both costs"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - src/categorical-table.ts
tags:
  - performance
  - view-model
  - hot-path
  - value-formatter
  - selection-id
  - getkey
  - row-cap
  - dataview
---

# mapDataView hot path: per-row formatter creation and quadratic selection scans

## Problem

`ViewModelHandler.mapDataView()` runs on every data update and maps every dataview row to an `IHtmlEntry`. Two per-row patterns were cheap at the old host-default row cap but became real liabilities when WP-A pinned the cap at 30,000: formatter construction inside the row loop, and selection reconciliation by linear identity scan.

## Symptoms

Latent — surfaced by code review when the cap raise changed the cost envelope, not by a user report:

- `getTooltipData()` created a `valueFormatter` (culture + format-string resolution) for **every** column on **every** row, and was called twice per row — worst case `2 × columns × 30,000` formatter instantiations per update, most discarded by the role check on the next line.
- `isSelected()` ran `selectionId.equals()` (structural selector comparison) against the **entire previous entry list** for every new row — up to ~900M comparisons per update across two 30k updates.

## What Didn't Work

Nothing failed in production; the rejected paths were process choices:

- **Deferring as a fast-follow ticket.** Rejected — the code was already open and under test on the same branch; "while we're working on this part of the code" beat a ticket that might never be scheduled.
- **Also rewriting the adapter's zip loop** (`src/categorical-table.ts`) from functional spreads into manual index loops. Rejected without profiling evidence: its allocations are linear and JIT-friendly, and the readability cost is real. Measure before trading clarity for micro-gains.

## Solution

**1. Hoist formatter creation out of the row loop** (commit `ae9b392`). Tooltip columns and their formatters are resolved once per update; per-row work is reduced to value extraction:

```ts
// once per update
const tooltipColumns = [
    ...this.getTooltipColumns('sampling', columns, host),
    ...this.getTooltipColumns('tooltips', columns, host)
]; // ITooltipColumn[]: { column, index, formatter }

// per row
tooltips: this.getTooltipValues(tooltipColumns, row);
```

`getTooltipColumns` filters by role **before** creating formatters, so non-matching columns cost nothing.

**2. Replace the per-row selection scan with an identity-key lookup** (commit `f9966e7`). Previously-selected identity keys are collected once into a `Set`; each row does an O(1) lookup:

```ts
// before (per row): O(previous entries) with structural equals()
const selectedDataPoint = (initialSelection || []).find((dp) =>
    selectionId.equals(<ISelectionId>dp.identity)
);

// after (once per update):
const selectedKeys = new Set(
    this.viewModel.htmlEntries
        .filter((dp) => dp.selected)
        .map((dp) => (<ISelectionId>dp.identity).getKey())
);
// after (per row): O(1), and getKey() is only invoked when a selection exists
selected: selectedKeys.size > 0 &&
    selectedKeys.has(identities[index].getKey()),
```

Behavior is preserved exactly, including the subtlety that the per-entry `selected` flag is independent of the cross-filter setting while `hasSelection` requires it. A guard test with a key-aware mock builder pins selection preservation across updates ([test/view-model.test.ts](../../../test/view-model.test.ts), "should preserve previously selected entries across updates via identity keys").

## Why This Works

- `valueFormatter.create()` resolves culture and format strings — meaningful constant work that is loop-invariant per update. Hoisting changes the cost from `O(columns × rows × 2)` to `O(matching columns)`.
- `ISelectionId.getKey()` returns a stable string for an identity, so set membership replaces structural `equals()` comparisons; reconciliation drops from `O(rows × previous entries)` to `O(rows + previously selected)`.

## Prevention

- **When raising a data cap** (`dataReductionAlgorithm` count, paging, etc.), audit the per-row work in the mapping path in the same change — cost envelopes shift silently and "fine at 1k" patterns become incidents at 30k.
- **Hoist loop invariants out of row loops**: formatters, regexes, role/column resolution, settings reads.
- **Prefer `ISelectionId.getKey()` set lookups over `equals()` scans** whenever reconciling selection state across updates.
- **Measure before micro-optimizing**: the adapter zip loop was deliberately left in readable functional style because no profile justified rewriting it. Revisit only with evidence from a real large-row report.

## Related Issues

- WP-A spec/plan: [docs/brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md](../../brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md), [docs/plans/2026-06-12-001-categorical-data-mapping-selection-ids-plan.md](../../plans/2026-06-12-001-categorical-data-mapping-selection-ids-plan.md) — the migration that raised the cap and motivated both fixes
- Same-arc learning: [report-page-tooltip-three-gate-measure-only-2026-06-12.md](../design-patterns/report-page-tooltip-three-gate-measure-only-2026-06-12.md)
- Surfaced by the pre-merge code review of branch `refactor/change-dataview` (commits `ae9b392`, `f9966e7`)
