---
title: Categorical data mapping + per-row selection identities (WP-A)
date: 2026-06-12
status: approved
related_issues:
    - https://github.com/dm-p/powerbi-visuals-html-content/issues/130
    - https://github.com/dm-p/powerbi-visuals-html-content/issues/153
    - https://github.com/dm-p/powerbi-visuals-html-content/issues/159
---

# Categorical data mapping + per-row selection identities (WP-A)

## Problem

The visual uses a `table` dataViewMapping ([capabilities.json:139-173](../../capabilities.json#L139-L173)) and builds selection identities with `.withTable(table, index)` ([src/view-model.ts:111-114](../../src/view-model.ts#L111-L114)). This has two structural consequences:

1. **Measure-only scenarios get no usable identity.** With a single measure and no granularity columns, the table mapping cannot produce the data-context identity that report page tooltips require, so they silently fail to appear ([#130](https://github.com/dm-p/powerbi-visuals-html-content/issues/130), currently labelled an SDK limitation). The same identity gap constrains future two-way interaction work ([#153](https://github.com/dm-p/powerbi-visuals-html-content/issues/153)).
2. **The mapping code is fragile against metadata the host injects.** Calculation groups with dynamic format strings add metadata columns that carry no `roles` object; unguarded access (`c.roles.sampling` at [src/view-model.ts:97-98](../../src/view-model.ts#L97-L98), `c.roles.content` at [src/view-model.ts:140](../../src/view-model.ts#L140)) throws, which trips the `renderingFailed` catch and the visual renders nothing ([#159](https://github.com/dm-p/powerbi-visuals-html-content/issues/159)).

Deneb demonstrates the established alternative: a categorical mapping with `GroupingOrMeasure` roles bound into both `categories` and `values`, reconstructed row-wise into a simulated table, with identities chained from `.withCategory()`/`.withMeasure()` per row.

## Users and outcome

**Primary user:** report authors who drive the visual from a single measure (a very common pattern) and expect host features — report page tooltips, cross-filtering context — to behave like they do on native visuals.

**Outcome that changes for them:**

- Today: report page tooltips on a measure-only visual never appear; calc-group dynamic format strings blank the visual when granularity is used.
- After this change: measure-only rows carry a real selection identity, so report page tooltips work; dynamic-format-string metadata cannot crash the mapping; rendered output and all existing behaviour are otherwise unchanged.

This is the first of three planned architectural work packages (WP-A: this; WP-B: render lifecycle modes; WP-C: templating). It deliberately ships **plumbing only** so the new dataview foundation is proven in isolation before later work packages build on it.

## Goals

1. Replace the `table` dataViewMapping with a categorical mapping that simulates a table (Deneb pattern), preserving all three data roles (content, sampling, tooltips) and the `max: 1` content condition.
2. Build per-row selection identities by walking categories into `.withCategory()` chains and measures into `.withMeasure()` chains. A measure-only dataview yields one row with a pure `.withMeasure()` identity — this is what fixes #130.
3. Freeze the view-model contract: `IViewModel` and `IHtmlEntry` shapes are byte-identical before and after. Consumers ([src/visual.ts](../../src/visual.ts), [src/behavior.ts](../../src/behavior.ts), [src/visual-settings.ts](../../src/visual-settings.ts)) read only `isValid`, `isEmpty`, `htmlEntries`, `hasSelection`, `hasGranularity`, `contentFormatting` — none of which change meaning.
4. Make all `roles` access null-safe and ignore roles-less metadata columns in the adapter, structurally fixing the #159 failure class.
5. Pin the row cap explicitly at `top: { count: 30000 }` — a deliberate raise from the host-default cap the implicit `top: {}` provided.
6. Existing reports render identically; all three editions (lite, standard, standalone) package cleanly from the shared capabilities.json.

## Non-goals

- **Highlight support / two-way interaction (#153).** Not planned — there is no intent to add highlight support in the foreseeable future. The categorical mapping and per-row identities happen to be the prerequisites, so the door stays open at zero extra cost, but no WP-A decision should be justified by it.
- **fetchMoreData paging.** Single fetch only; the windowed-accumulation pattern Deneb uses is out of scope.
- **Render lifecycle changes (WP-B) and templating (WP-C, #127/#138).** Separate brainstorms.
- **Free dimension/measure table layouts (#124).** Out of scope for this visual: a true 2D grid is better served by a dedicated custom visual, since shipped data roles and mappings are effectively permanent contract. (If the underlying need — composing multiple field values into row output — is ever absorbed here, the route is WP-C templating plus an *additive* data role, which is non-breaking; not a mapping change.)
- **Any sanitizer change.** `docs/sanitization-rules.md` and the `test-uat/*.csv` corpora must show zero diff; churn there means scope leaked.

## Approach (recommended): simulated-table adapter module

A new module, `src/categorical-table.ts`, owns the categorical→table reconstruction. [src/view-model.ts](../../src/view-model.ts) consumes its output and barely changes otherwise. (Alternatives considered: rewriting `mapDataView()` in place — rejected because the zip/identity logic is the fiddly part and deserves isolated unit tests, and inlining it grows `view-model.ts` toward the god-module pattern; porting Deneb's dataset layer wholesale — rejected because it carries highlight/paging/format-string machinery that the scope above excludes.)

### 1. Capabilities mapping

The `table` block is replaced with:

```json
"categorical": {
    "categories": {
        "select": [
            { "for": { "in": "sampling" } },
            { "for": { "in": "content" } }
        ],
        "dataReductionAlgorithm": { "top": { "count": 30000 } }
    },
    "values": {
        "select": [
            { "for": { "in": "content" } },
            { "for": { "in": "sampling" } },
            { "for": { "in": "tooltips" } }
        ]
    }
}
```

Both `GroupingOrMeasure` roles are bound into both buckets so Power BI routes each assigned field by what it is: grouping columns land in `categories`, measures in `values`. Conditions, `sorting.default`, and all other capabilities are unchanged. The edition build ([bin/package-custom.js](../../bin/package-custom.js)) patches only identity/privileges, so all editions inherit the mapping automatically.

Tooltip ordering may shift where a report mixes sampling columns and measures, because simulated-table column order is categories-then-values rather than role-select order. Accepted: tooltip order already depends on what Power BI sends and has no API contract (#132).

### 2. Adapter contract (`src/categorical-table.ts`)

```ts
export interface ISimulatedTable {
    columns: DataViewMetadataColumn[]; // categories first, then values
    rows: PrimitiveValue[][]; // row-major, aligned to columns
    identities: ISelectionId[]; // one per row
}
export function mapCategoricalToTable(
    categorical: DataViewCategorical | undefined,
    host: IVisualHost
): ISimulatedTable;
```

`columns`/`rows` deliberately mirror `DataViewTable`, so `getTooltipData()` and `getContentMetadataIndex()` keep their signatures.

- **Zip:** row *i* is `[...categories[*].values[i], ...values[*].values[i]]`. Measure-only → exactly one row from the single aggregates. Column-only → one row per category entry. Missing/empty categorical → empty table.
- **Identity:** per row *i*: `host.createSelectionIdBuilder()`, then `.withCategory(cat, i)` for each category column, `.withMeasure(source.queryName)` for each value column, then `.createSelectionId()`.
- **Role safety:** columns with no recognised role are excluded from the simulated table entirely; all role checks use optional chaining.

### 3. View-model integration

`ViewModelHandler` keeps its two-phase flow:

- `validateDataView()` checks `dataViews[0].categorical` + metadata exist and a content-role column is present (null-safe). Sets `isValid` as today.
- `mapDataView()` calls `mapCategoricalToTable()` once, then operates on `{ columns, rows, identities }`: `contentIndex` computed from adapter columns, `hasGranularity` via `columns.some((c) => c.roles?.sampling)`, identity lookup replaces the `.withTable()` builder call. `getTooltipData()` and `isSelected()` are untouched. Expected net diff: ~15 lines plus imports.

`contentIndex` remains on `IViewModel` but is consumed nowhere outside the handler, so its meaning shifts to "index into simulated-table columns" with no external impact.

### 4. Error handling

- Roles-less metadata columns are ignored by the adapter and can never throw (#159 fix).
- Row count derives from `categories[0]?.values.length`, falling back to 1 if only measures exist, else 0. Per-column reads are length-guarded; a malformed dataview degrades to an empty/invalid view model, which feeds the existing no-data message path instead of the silent `renderingFailed` catch.

## Migration and compatibility

- **Rendered output:** unchanged for existing reports; the view-model contract freeze plus untouched sanitizer guarantee this at the unit level, UAT confirms at the visual level.
- **Selection identities change format** (`withTable` → `withCategory`/`withMeasure`). Identities are rebuilt every update so there is no live impact, but a saved bookmark that captured a selection on this visual may restore unselected once after upgrade. Accepted as transient and self-healing; note in release notes.
- **Row cap** becomes explicit at 30,000 (deliberate raise from the implicit host default).
- **#159** is expected to be resolved by the role-safety work; the calc-group dynamic-format-string scenario becomes a permanent regression fixture either way.

## Testing & verification

1. **New `test/categorical-table.test.ts`:** mixed columns+measures, measure-only (single row, pure `.withMeasure()` identity), column-only, multiple sampling columns, roles-less column (#159 fixture), empty/undefined categorical, length-mismatch guards. Identity assertions use a mock host whose builder records the `withCategory`/`withMeasure` call sequence.
2. **`test/view-model.test.ts`:** dataview mocks rewritten from table-shaped to categorical-shaped; assertions on the view-model contract unchanged — the proof the contract is frozen. The dead `test/viewModel.spec.ts` (imports from pre-rename module paths, cannot compile) is deleted.
3. **Expected-zero diffs:** `npm run test:all` green with no `docs:check` regeneration and no `test-uat/*.csv` churn.
4. **Manual UAT (Power BI Desktop):** existing workbook scenarios; #130 repro (single measure + report page tooltip); #159 repro (calc group dynamic format string + granularity); cross-filter regression with granularity; bookmark restore behaviour; 30k cap takes effect.
5. **Packaging:** `npm run package`, `package-standard`, `package-standalone` all build; `cert-check` green.

## Follow-up work

- **WP-B:** render lifecycle modes (rebuild / join-style reconcile / skip-when-unchanged), preceded by extracting a rendering orchestrator from `Visual.update()`.
- **WP-C:** templating paradigm (#127, #138). If #124's use case is ever revisited, it would land here via an additive data role rather than a mapping change.

Highlight support (#153 receive-side) is deliberately **not** on this list: no near-term intent. This work merely keeps it possible.
