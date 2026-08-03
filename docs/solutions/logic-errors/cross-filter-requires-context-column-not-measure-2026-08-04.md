---
title: "Cross-filtering fires for measures-only Context role with no selection identity"
date: 2026-08-04
category: logic-errors
module: src/view-model.ts
problem_type: logic_error
component: tooling
severity: medium
related_components:
  - src/visual-settings.ts
  - src/categorical-table.ts
  - src/interactivity/tooltips.ts
  - capabilities.json
symptoms:
  - "Cross-filter format-pane card appears and cross-filtering activates when the Context (sampling) role holds only measures, with no category/dimension field bound"
  - "Clicking rendered content toggles a 'selection' state that filters nothing meaningful, since only category columns contribute filterable data points to selection identities; measures contribute via withMeasure only"
  - "No error, warning, or console output — the feature silently misbehaves rather than failing"
root_cause: logic_error
resolution_type: code_fix
tags:
  - cross-filtering
  - context-role
  - sampling-role
  - selection-identity
  - view-model
  - measures-vs-categories
  - format-pane
  - data-roles
---

# Cross-filtering fires for measures-only Context role with no selection identity

Fixed on branch `fix/crossfilter-context-columns`, commits `4bb0843` (view-model gate) and `40d43ad` (format-pane card visibility).

## Problem

Adding a measure-only field to the "Context" data role silently enabled the visual's cross-filtering UI and click handling, but clicking never actually filtered anything — the format-pane cross-filter card appeared, selection state toggled internally, yet the host received no usable selection identity to filter by.

## Symptoms

- Format pane showed the "Cross filtering" card as soon as any field occupied Context, including a bare measure.
- Clicking rendered content toggled a selected/highlighted state in the visual with no corresponding cross-filter applied to the report.
- No error, no console warning — the feature just looked live but did nothing, making it hard to tell "it's broken" from "I set it up wrong."

## What Didn't Work

Considered and rejected (before implementation, not after a failed attempt): tightening the existing `hasGranularity` flag itself (`columns.some((c) => c.roles?.sampling)`) to exclude measures, rather than introducing a second flag. `hasGranularity` also gates tooltip/hover binding (`resolveHover` → `bindStandardTooltips`), which is a legitimate and desired use of measures in the Context role — showing a measure's value on hover has no selection-identity requirement. Redefining `hasGranularity` to be column-only would have silently broken tooltips for every report using a measure in Context, trading one bug for a regression in a working, unrelated feature. The one-flag-many-consumers shape was itself the problem to fix, not the flag's definition.

## Solution

`src/view-model.ts` — added a second, narrower flag and switched the cross-filtering gate to it, leaving `hasGranularity` untouched:

```ts
// before
const hasGranularity = columns.some((c) => c.roles?.sampling);
const hasCrossFiltering =
    hasGranularity &&
    settings.crossFilter.crossFilterCardMain.enabled.value;

// after
const hasGranularity = columns.some((c) => c.roles?.sampling);
// Cross-filtering needs a column (grouping) in the Context role;
// measures produce no useful selection identity to filter by.
const hasContextColumns = columns.some(
    (c) => c.roles?.sampling && !c.isMeasure
);
const hasCrossFiltering =
    hasContextColumns &&
    settings.crossFilter.crossFilterCardMain.enabled.value;
```

`hasContextColumns` was also added to `IViewModel` and to the default/reset view model state, and threaded through `mapDataView` alongside `hasGranularity`.

`src/visual-settings.ts` — `handlePropertyVisibility` now hides the cross-filter card unless `hasContextColumns` is true:

```ts
// before
if (viewModel.hasGranularity) {

// after
if (viewModel.hasContextColumns) {
```

Tests pin both behaviors (TDD: written and verified failing before the implementation change):

- `test/view-model.test.ts` — `hasGranularity` is `true` but `hasContextColumns`/`hasCrossFiltering` are `false` when Context holds only a measure; `hasContextColumns` becomes `true` when a plain column is present alongside a measure in Context.
- `test/visual-settings.test.ts` — "should hide crossFilter card when Context holds only measures" explicitly sets `hasGranularity = true` and `hasContextColumns = false`, asserting the card stays hidden — this is the regression-pinning case, since the old code (`if (viewModel.hasGranularity)`) would fail it.

## Why This Works

`DataViewMetadataColumn.isMeasure` is Power BI's own signal for "this field is aggregated/summarized" (true for measures and for numeric columns the host implicitly aggregates), which aligns exactly with "this field cannot contribute a *filterable* category data point." In `src/categorical-table.ts` (`mapCategoricalToTable`, ~lines 70-79), selection identities are built from both sides — `withCategory(c, i)` over `categorical.categories` and `withMeasure(v.source.queryName)` over `categorical.values` — so a measure-only Context role still yields a selectable identity (one single-aggregate-row identity, per the issue #130 rowCount-fallback rule), but that identity carries no category data points, giving the host nothing to cross-filter by. So `!c.isMeasure` on a `sampling`-role column is precisely the condition filterable-identity generation depends on, making it the correct, semantically honest gate for cross-filtering rather than an incidental proxy. Splitting into two flags — `hasGranularity` (any field, drives tooltips) and `hasContextColumns` (column only, drives cross-filtering and its format-pane visibility) — lets each consumer keep the semantics it actually needs instead of forcing one shared boolean to satisfy both.

## Prevention

- When a single boolean gate is consumed by multiple features with different underlying requirements, don't retarget the shared flag to fix one consumer — split it into consumer-specific flags (`hasGranularity` vs `hasContextColumns` here) so each keeps correct semantics independently.
- When adding any feature gated on a `GroupingOrMeasure` (or similarly dual-purpose) data role, explicitly decide and document whether measures qualify — don't assume "field present in role" is equivalent to "field usable by this feature." Check whether the feature depends on selection identity (categories only) vs. just a value (categories or measures).
- Regression-test pattern worth reusing: assert flag A is `true` while flag B is `false` in the same test case, to pin the exact scenario a naive/old implementation would get wrong (see the "hide crossFilter card when Context holds only measures" test).

## Related Issues

- [report-page-tooltip-three-gate-measure-only-2026-06-12.md](../design-patterns/report-page-tooltip-three-gate-measure-only-2026-06-12.md) — sibling gating logic on the same `sampling` role, contrasting consumer semantics (any-field for tooltips vs. `isMeasure`-filtered for cross-filter)
- [rename-data-role-sweep-all-user-facing-strings-2026-07-03.md](../conventions/rename-data-role-sweep-all-user-facing-strings-2026-07-03.md) — the Granularity→Context display-name rename (PR #182) this fix's role vocabulary depends on
- [docs/plans/2026-08-04-crossfilter-requires-context-column.md](../../plans/2026-08-04-crossfilter-requires-context-column.md) — this fix's implementation plan
- [docs/brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md](../../brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md) and [docs/plans/2026-06-12-001-categorical-data-mapping-selection-ids-plan.md](../../plans/2026-06-12-001-categorical-data-mapping-selection-ids-plan.md) — origin of `hasGranularity` and the categorical `isMeasure` metadata this fix builds on
- GitHub issue #4 (closed) — historical origin of the `sampling` data role; no open issue reported this bug (caught proactively during cross-filter UAT)
