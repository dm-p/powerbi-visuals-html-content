---
title: 'refactor: categorical data mapping + per-row selection identities'
type: refactor
status: approved
date: 2026-06-12
origin: docs/brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md
---

# refactor: categorical data mapping + per-row selection identities

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan unit-by-unit. Units use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `table` dataViewMapping with a categorical mapping that simulates a table (Deneb pattern), building per-row selection identities from `.withCategory()`/`.withMeasure()` chains, with the view-model contract frozen.

**Architecture:** A new adapter module (`src/categorical-table.ts`) owns the categorical→table reconstruction and identity factory; `ViewModelHandler` consumes its output with a ~15-line diff; `capabilities.json` swaps the mapping. Nothing else in `src/` changes.

**Tech Stack:** TypeScript, powerbi-visuals-api ~5.11, vitest, pbiviz.

---

## Summary

Swap the visual's dataview from `table` to `categorical` so that measure-only scenarios produce real selection identities (fixes report page tooltips, [#130](https://github.com/dm-p/powerbi-visuals-html-content/issues/130)) and roles-less metadata columns injected by calc-group dynamic format strings can no longer crash mapping (fixes [#159](https://github.com/dm-p/powerbi-visuals-html-content/issues/159)). Rendered output and the `IViewModel`/`IHtmlEntry` contract are unchanged. Four implementation units: delete a dead legacy test file, build the adapter test-first, land the mapping+view-model swap atomically, then run the full verification gate.

---

## Problem Frame

The `table` mapping ([capabilities.json:139-173](../../capabilities.json#L139-L173)) plus `.withTable(table, index)` identities ([src/view-model.ts:111-114](../../src/view-model.ts#L111-L114)) cannot give measure-only dataviews a usable data-context identity, and unguarded `c.roles.*` access ([src/view-model.ts:97-98](../../src/view-model.ts#L97-L98), [src/view-model.ts:140](../../src/view-model.ts#L140)) throws on roles-less metadata columns. Full rationale, goals, and non-goals: [origin brainstorm](../brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md).

---

## Requirements

- R1. Categorical mapping with content/sampling bound into both `categories` and `values`, tooltips into `values`; `max: 1` content condition and `sorting.default` retained; `top: { count: 30000 }` explicit. *(origin: Goals 1, 5)*
- R2. Per-row identities: `.withCategory(cat, i)` per category column, `.withMeasure(queryName)` per value column. Measure-only → one row, pure `.withMeasure()` identity. *(origin: Goals 2)*
- R3. `IViewModel`/`IHtmlEntry` shapes byte-identical; consumers (`visual.ts`, `behavior.ts`, `visual-settings.ts`) unaffected. *(origin: Goals 3)*
- R4. All `roles` access null-safe; adapter excludes columns with no recognised role. *(origin: Goals 4)*
- R5. Zero sanitizer-surface churn: `docs:check` passes without regeneration; `test-uat/*.csv` untouched. *(origin: Non-goals)*
- R6. All three editions package from the shared capabilities.json. *(origin: Goals 6)*

---

## Scope Boundaries

- No highlight support, no `supportsHighlight` capability flag (#153 explicitly not planned).
- No fetchMoreData paging; single fetch.
- No render-lifecycle (WP-B) or templating (WP-C) work.
- No sanitizer changes of any kind.
- `visual.ts` is not modified — `validateDataView`/`mapDataView` call order and the view-model contract make the swap invisible to it.

---

## Context & Research

### Relevant Code and Patterns

- [src/view-model.ts](../../src/view-model.ts) — the only file in `src/` that touches `dataViews[0].table` (verified by grep). `validateDataView` sets `isValid` + provisional `contentIndex` from `metadata.columns`; `mapDataView` builds `htmlEntries`.
- [src/visual.ts:152-158](../../src/visual.ts#L152-L158) — call order: `validateDataView(options.dataViews)` then `viewModel.isValid && mapDataView(...)`, only on Data-type updates. Unchanged.
- [test/view-model.test.ts](../../test/view-model.test.ts) — existing vitest patterns: inline `dataViews: any[]` mocks, `mockHost` with `createSelectionIdBuilder`, `mockSettings` with `crossFilter`/`contentFormatting`. The mocks gain `categorical` instead of `table`; the builder mock gains `withCategory`/`withMeasure`.
- [bin/package-custom.js](../../bin/package-custom.js) + [config/package.json](../../config/package.json) — edition builds patch identity/privileges only; the base `dataViewMappings` is shared by all editions.
- Deneb (`deneb-viz/deneb`, same author) — reference for the dual-binding categorical pattern: a `GroupingOrMeasure` role selected into both `categories` and `values`; Power BI routes grouping columns to categories and measures to values.

### Institutional Learnings

- `docs/solutions/` has no entries on dataview mapping; existing entries are sanitizer-rule and display-layer regressions. Not applicable here, which is itself a signal: this is the first structural dataview change since the docs convention began — capture a solution doc if #159's root cause confirms during UAT.

### Key API facts (powerbi-visuals-api ~5.11)

- `DataViewCategorical` = `{ categories?: DataViewCategoryColumn[]; values?: DataViewValueColumns }`. Each category/value column has `source: DataViewMetadataColumn` and `values: PrimitiveValue[]`, index-aligned across columns.
- With no grouping columns, each measure's `values` array has exactly one aggregate entry.
- `ISelectionIdBuilder.withCategory(category: DataViewCategoryColumn, index: number)` and `.withMeasure(measureId: string)` both return the builder (chainable); `measureId` is the column's `queryName`.
- `DataViewTableRow` is `PrimitiveValue[]`, so the simulated rows satisfy `getTooltipData`'s existing signature.

---

## Key Technical Decisions

- **Adapter module over in-place rewrite:** the zip/identity logic is the fiddly part and gets isolated unit tests with plain mock dataviews; `view-model.ts` stays small. (Origin "Approach" section; alternatives rejected there.)
- **`contentIndex` has two phases, both handler-internal:** `validateDataView` keeps setting it from `metadata.columns` (null-safe) so validity semantics and existing validate-stage tests survive nearly verbatim; `mapDataView` recomputes it against the simulated-table columns, which is the index space `htmlEntries` mapping actually uses. Nothing outside the handler reads `contentIndex` (verified by grep), so the two-phase meaning is invisible.
- **Defensive degradation lands on the no-data path:** if the adapter yields no content column despite a valid metadata check, `mapDataView` produces zero entries → `isEmpty: true` → the visual shows the no-data message instead of throwing into `renderingFailed`.
- **Role recognition = non-empty `roles` object:** a column whose `source.roles` is missing or `{}` is excluded from the simulated table. This is what makes calc-group dynamic-format-string columns inert.
- **`withMeasure` only when `queryName` exists:** a value column without a `queryName` contributes data but is skipped in the identity chain rather than passing `undefined` into the API.

---

## Open Questions

### Resolved During Planning

- *Does anything besides `view-model.ts` consume the table dataview or `contentIndex`?* No — grep-verified; `visual.ts` reads only `isValid`/`isEmpty`/`htmlEntries`/`hasSelection`/`hasGranularity`/`contentFormatting`.
- *Do validate-stage tests survive?* Yes, with mocks gaining a `categorical` key in place of `table`; `contentIndex` assertions at validate stage still index `metadata.columns`.

### Deferred to Implementation

- *Dual-binding routing in practice:* the `for...in` of a `GroupingOrMeasure` role into both buckets is the Deneb pattern, but verify early with `pbiviz start` against a live report (U3 verification) that a column in **Granularity** lands in `categories` and a measure in **Values** lands in `values`. If routing misbehaves, the fallback is explicit per-role `bind` entries — adjust mapping, not architecture.
- *Row order parity with the old table mapping:* expected identical (same query, same sort). Confirm during U3 smoke / U4 UAT with a multi-row granularity report.

---

## High-Level Technical Design

> *Directional guidance for review. The implementing agent should treat signatures and behaviours as binding, exact statements as illustrative.*

### Capabilities mapping (exact target state)

```json
"dataViewMappings": [
    {
        "conditions": [{ "content": { "max": 1 } }],
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
    }
]
```

### Adapter (`src/categorical-table.ts`)

```ts
import powerbi from 'powerbi-visuals-api';
import DataViewCategorical = powerbi.DataViewCategorical;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.visuals.ISelectionId;

export interface ISimulatedTable {
    columns: DataViewMetadataColumn[]; // categories first, then values
    rows: PrimitiveValue[][]; // row-major, aligned to columns
    identities: ISelectionId[]; // one per row
}

const hasRecognisedRole = (source: DataViewMetadataColumn | undefined) =>
    !!source?.roles && Object.keys(source.roles).length > 0;

const valueAt = (values: PrimitiveValue[] | undefined, index: number) =>
    values && index < values.length ? values[index] : null;

export function mapCategoricalToTable(
    categorical: DataViewCategorical | undefined,
    host: IVisualHost
): ISimulatedTable {
    const categories = (categorical?.categories ?? []).filter((c) =>
        hasRecognisedRole(c.source)
    );
    const values = Array.from(categorical?.values ?? []).filter((v) =>
        hasRecognisedRole(v.source)
    );
    const rowCount =
        categories[0]?.values?.length ?? (values.length > 0 ? 1 : 0);
    const columns = [
        ...categories.map((c) => c.source),
        ...values.map((v) => v.source)
    ];
    const rows: PrimitiveValue[][] = [];
    const identities: ISelectionId[] = [];
    for (let i = 0; i < rowCount; i++) {
        rows.push([
            ...categories.map((c) => valueAt(c.values, i)),
            ...values.map((v) => valueAt(v.values, i))
        ]);
        let builder = host.createSelectionIdBuilder();
        categories.forEach((c) => {
            builder = builder.withCategory(c, i);
        });
        values.forEach((v) => {
            if (v.source.queryName) {
                builder = builder.withMeasure(v.source.queryName);
            }
        });
        identities.push(builder.createSelectionId());
    }
    return { columns, rows, identities };
}
```

### View-model integration (target diff shape)

`validateDataView`: `dataViews[0].table` → `dataViews[0].categorical` in the basic check; `getContentMetadataIndex` becomes null-safe (`c.roles?.content`).

`mapDataView` (replacing the `dataViews[0].table` destructure and `.withTable()` builder):

```ts
const { columns, rows, identities } = mapCategoricalToTable(
    dataViews[0].categorical,
    host
);
this.viewModel.contentIndex = this.getContentMetadataIndex(columns);
const contentIndex = this.viewModel.contentIndex;
const hasGranularity = columns.some((c) => c.roles?.sampling);
// ... hasCrossFiltering / initialSelection / hasSelection unchanged ...
const htmlEntries: IHtmlEntry[] =
    contentIndex > -1
        ? rows.map((row, index) => {
              const value = row[contentIndex];
              return {
                  content: value ? value.toString() : '',
                  identity: identities[index],
                  selected: this.isSelected(initialSelection, identities[index]),
                  tooltips: [
                      ...this.getTooltipData('sampling', columns, row, host),
                      ...this.getTooltipData('tooltips', columns, row, host)
                  ]
              };
          })
        : [];
// ... assignments unchanged, except:
this.viewModel.isEmpty = htmlEntries.length === 0;
```

`getTooltipData` keeps its signature; its role check becomes `c.roles?.[role]`. `isSelected` is untouched.

---

## Implementation Units

- [ ] U1. **Remove the dead legacy test file**

**Goal:** Delete [test/viewModel.spec.ts](../../test/viewModel.spec.ts), which imports from pre-rename module paths (`'../src/ViewModel'`, `'../src/VisualSettings'`) that no longer exist and cannot compile.

**Requirements:** Hygiene precursor to R3 (its assertions duplicate `view-model.test.ts` against a module that is being modified).

**Dependencies:** None.

**Files:**
- Delete: `test/viewModel.spec.ts`

**Approach:** `git rm test/viewModel.spec.ts`. Grep for `viewModel.spec` references in configs (vitest.config.ts, tsconfig.json) — none expected.

**Verification:** `npm test` green; `npm run eslint` green.

**Commit:** `tests: remove dead viewModel.spec.ts (pre-rename module paths)`

---

- [ ] U2. **Build the simulated-table adapter, test-first**

**Goal:** Create `src/categorical-table.ts` exporting `ISimulatedTable` and `mapCategoricalToTable` per the design above, with full unit coverage in a new `test/categorical-table.test.ts`.

**Requirements:** R2, R4.

**Dependencies:** None (pure addition; nothing consumes it yet).

**Files:**
- Create: `src/categorical-table.ts`
- Create: `test/categorical-table.test.ts`

**Execution note:** Test-first. Write the scenarios below as failing tests against the design contract, run them to confirm they fail (module not found), then implement until green. The adapter has a clean input/output contract; every behaviour is specifiable up front.

**Test scaffolding (use this recording builder):**

```ts
import { describe, it, expect } from 'vitest';
import { mapCategoricalToTable } from '../src/categorical-table';

interface IRecordedCall {
    method: 'withCategory' | 'withMeasure';
    args: unknown[];
}

const createRecordingBuilder = () => {
    const calls: IRecordedCall[] = [];
    const builder: any = {
        withCategory: (...args: unknown[]) => {
            calls.push({ method: 'withCategory', args });
            return builder;
        },
        withMeasure: (...args: unknown[]) => {
            calls.push({ method: 'withMeasure', args });
            return builder;
        },
        createSelectionId: () => ({ calls, equals: () => false })
    };
    return builder;
};

const mockHost = {
    createSelectionIdBuilder: () => createRecordingBuilder(),
    locale: 'en-US'
} as any;

const categoryCol = (
    roles: Record<string, boolean>,
    displayName: string,
    queryName: string,
    values: unknown[]
) => ({ source: { roles, displayName, queryName }, values });
```

Identity assertions read back `(identity as any).calls` to verify the chain, e.g. measure-only: `[{ method: 'withMeasure', args: ['mq'] }]`; one category + one measure at row 1: `[{ method: 'withCategory', args: [catCol, 1] }, { method: 'withMeasure', args: ['mq'] }]`.

**Test scenarios:**
- *Happy path:* one sampling category (3 values) + one content measure → 3 rows of `[category, measure]`; `columns` is `[catSource, valSource]`; identity *i* chains `withCategory(cat, i)` then `withMeasure(queryName)`.
- *Happy path:* measure-only (content measure, no categories) → exactly 1 row containing the single aggregate; identity is a pure `withMeasure` chain. **This is the #130 case.**
- *Happy path:* column-only (content as grouping column, no measures) → one row per category entry; identities are pure `withCategory` chains.
- *Happy path:* multiple sampling columns + content measure + tooltip measure → row zip order is categories-then-values; identity chains every category then every measure.
- *Edge case (#159 fixture):* a value column whose `source` has no `roles` key (calc-group dynamic-format-string shape) is excluded from `columns`, `rows`, and identity chains — and does not throw.
- *Edge case:* a column with `roles: {}` (empty object) is likewise excluded.
- *Edge case:* `undefined` categorical → `{ columns: [], rows: [], identities: [] }`.
- *Edge case:* categorical with empty `categories` and empty `values` arrays → empty result.
- *Edge case:* length mismatch (category with 3 values, measure with 2) → rows 0-2 exist; the missing measure cell is `null`; no throw.
- *Edge case:* value column without `queryName` contributes its cell values but adds no `withMeasure` call.

**Verification:** `npm test` green (new file + whole suite); `npm run eslint`; `npm run prettier-check`.

**Commit:** `feat: add categorical simulated-table adapter`

---

- [ ] U3. **Swap the mapping: capabilities + view-model + test mocks (atomic)**

**Goal:** Replace the `table` block in [capabilities.json](../../capabilities.json) with the categorical mapping (exact JSON in High-Level Technical Design), rewire `ViewModelHandler` to consume `mapCategoricalToTable`, and rewrite the dataview mocks in [test/view-model.test.ts](../../test/view-model.test.ts) from table-shaped to categorical-shaped.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** U2.

**Files:**
- Modify: `capabilities.json` (dataViewMappings block only)
- Modify: `src/view-model.ts` (`validateDataView`, `mapDataView`, `getContentMetadataIndex`, `getTooltipData` role check; import the adapter)
- Modify: `test/view-model.test.ts` (mocks + the mockHost builder; assertions stay except as noted)

**Approach:**
1. Rewrite `test/view-model.test.ts` mocks first (tests go red against current code): every `table: { columns, rows }` mock becomes a `categorical` mock; `mockHost`'s builder gains `withCategory`/`withMeasure` (reuse U2's recording builder shape). Example translation of the "should map rows to htmlEntries when valid" fixture — content as a grouping column:

```ts
const dataViews: any[] = [
    {
        metadata: {
            columns: [
                {
                    roles: { content: true },
                    displayName: 'HTML',
                    queryName: 'q0'
                }
            ]
        },
        categorical: {
            categories: [
                {
                    source: {
                        roles: { content: true },
                        displayName: 'HTML',
                        queryName: 'q0'
                    },
                    values: ['<p>Test 1</p>', '<p>Test 2</p>']
                }
            ]
        }
    }
];
```

   Add two new mapDataView tests: measure-only content (categorical with `values` only → 1 entry, identity chain is pure `withMeasure`) and the #159 fixture (extra roles-less value column present → mapping succeeds, entry count unchanged).
2. Implement the `view-model.ts` changes per the target diff shape in High-Level Technical Design.
3. Swap the `dataViewMappings` block in capabilities.json.
4. Validate-stage tests keep their `contentIndex` assertions (still indexing `metadata.columns`). Map-stage `contentIndex` reflects simulated-table order; no existing test asserts it post-map, so no assertion semantics change — if any new test asserts it, index categories-then-values.

**Assertion-freeze rule (R3):** existing `expect(...)` lines on `htmlEntries` content/length, `isEmpty`, `hasGranularity`, `hasCrossFiltering`, `isValid` must not change — only the mock *inputs* change shape. That is the executable proof the contract is frozen.

**Verification:**
- `npm test` green; `npm run eslint`; `npm run prettier-check`.
- `git diff capabilities.json` shows only the dataViewMappings block changed.
- Live smoke (manual, recommended before commit): `npm start`, attach to a dev report in Power BI Desktop; confirm (a) column in Granularity + measure in Values renders rows as before, (b) measure-only renders, (c) a calc-group dynamic format string on the page no longer blanks the visual.

**Commit:** `feat: move dataview mapping from table to categorical with per-row identities`

---

- [ ] U4. **Full verification gate + docs touch-up**

**Goal:** Prove R5/R6 and update agent-facing docs for the new module.

**Requirements:** R5, R6.

**Dependencies:** U3.

**Files:**
- Modify: `AGENTS.md` (repo layout: add `categorical-table.ts  # categorical dataview → simulated table + selection identities` under `src/`)

**Approach & checks:**
1. `npm run test:all` — unit + integration + `docs:check`. Expected: green with **no** regeneration prompt from `docs:check`.
2. `git status` — confirm `test-uat/*.csv` and `docs/sanitization-rules.md` are untouched (R5; churn means scope leaked).
3. `npm run package`, `npm run package-standard`, `npm run package-standalone` — all three `.pbiviz` artifacts build (R6).
4. `npm run cert-check` — green.
5. Update AGENTS.md repo layout.

**Verification:** all commands above exit 0; only AGENTS.md shows in the diff.

**Commit:** `docs: add categorical-table adapter to repo layout`

---

## System-Wide Impact

- **Selection identity format changes** (`withTable` → `withCategory`/`withMeasure`). No live impact (identities rebuilt every update); saved bookmarks that captured a selection on this visual may restore unselected once after upgrade. Release-notes line required (see Documentation / Operational Notes).
- **Row cap** becomes explicit 30,000 (deliberate raise from implicit host default).
- **Tooltip ordering** may shift where reports mix sampling columns and measures (simulated order is categories-then-values). Accepted per #132 — no ordering API exists.
- All three editions inherit the mapping from shared capabilities.json; no edition-specific work.

---

## Risks & Dependencies

- **Dual-binding routing** (`GroupingOrMeasure` role in both buckets) is pattern-proven in Deneb but must be smoke-tested live early (U3 verification). Fallback: explicit per-role bind entries in the mapping — no architectural change.
- **Row-order parity** with the old table mapping is expected but unproven until U3 smoke / UAT. If order differs, investigate the query sort before touching code; `sorting.default` is unchanged.
- **#159 confirmation** requires a calc-group repro workbook (UAT). If the roles-less-column hypothesis is wrong, the adapter still hardens the path, but the issue stays open — do not close it on assumption.

---

## Documentation / Operational Notes

- **Manual UAT (Power BI Desktop, post-U4):** existing UAT workbook scenarios pass; #130 repro (single measure + report page tooltip appears); #159 repro (calc group dynamic format string + granularity renders); cross-filter with granularity still filters/dims correctly; bookmark restore checked (expect possible one-time selection reset); large-granularity report confirms the 30k cap.
- **Release notes:** one line on the bookmark selection-reset possibility; one line on #130 report-page-tooltip support.
- **Solution doc:** after #159 confirms fixed in UAT, capture `docs/solutions/runtime-errors/dynamic-format-string-columns-missing-roles-2026-06-12.md` (root cause: roles-less metadata columns + unguarded roles access; fix: adapter role-filter + null-safe access).
- Visual version bump (`pbiviz.json`) is handled by the release process, not this plan.

---

## Sources & References

- Origin brainstorm: [docs/brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md](../brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md)
- Issues: [#130](https://github.com/dm-p/powerbi-visuals-html-content/issues/130), [#153](https://github.com/dm-p/powerbi-visuals-html-content/issues/153), [#159](https://github.com/dm-p/powerbi-visuals-html-content/issues/159), [#132](https://github.com/dm-p/powerbi-visuals-html-content/issues/132)
- Reference implementation: Deneb (`deneb-viz/deneb`) capabilities.json — dual-binding categorical pattern, window reduction, per-row identity chains.
