---
title: "Dynamic format string columns crash the visual via unguarded roles access (issue #159)"
date: 2026-06-12
category: runtime-errors
module: src/view-model.ts
problem_type: runtime_error
component: tooling
symptoms:
  - "TypeError: Cannot read properties of undefined (reading 'sampling' / 'content' / 'tooltips') when a report measure uses a dynamic format string"
  - "Crash is ordering-dependent - only reproduces when the injected roles-less column precedes the content column in metadata.columns"
  - "Granularity, content-index, and tooltip processing all assume every dataview column carries a roles object"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [dynamic-format-strings, dataview-metadata, optional-chaining, powerbi-api, view-model, typeerror]
---

# Dynamic format string columns crash the visual via unguarded roles access (issue #159)

## Problem

When a report measure uses a dynamic format string, Power BI injects an extra column into the table dataview (both `dataViews[0].table.columns` and `dataViews[0].metadata.columns`) that carries only `displayName`/`format` — no `roles` property. `ViewModelHandler` (src/view-model.ts) accessed `c.roles.<x>` unguarded at three sites, so the visual threw a TypeError and rendered an error state instead of content.

## Symptoms

- `TypeError: Cannot read properties of undefined` — `(reading 'sampling')`, `(reading 'content')`, or `(reading 'tooltips')` depending on the site hit — when the report contains a dynamic-format-string measure
- Crash location varies by column ordering: with the injected column before the content column, validation crashes at `getContentMetadataIndex`; otherwise mapping or tooltip extraction crashes later
- Reports without dynamic format strings are unaffected, making the bug look intermittent across reports

## What Didn't Work

- **Partial guarding (commit `ed3f5fc`)**: the first fix added optional chaining at only two of the three `.roles` access sites (`c.roles?.sampling` in `mapDataView`, `c.roles?.[role]` in `getTooltipData`). It appeared to work because `Array.prototype.findIndex` **short-circuits**: the remaining unguarded site, `getContentMetadataIndex`, only evaluates the roles-less column when it appears *before* the content column in `metadata.columns`. Casual testing with the content column first never tripped it. Mutation verification later proved that with this site unguarded, all three regression tests crash in `validateDataView` — the partial fix never covered orderings where the injected column comes first.

## Solution

Point-guard every `.roles` access with optional chaining (completed across commits `ed3f5fc` and `6a4274d`):

```typescript
// src/view-model.ts:97-99 — granularity check (mapDataView)
const hasGranularity = dataViews[0].table.columns.some(
    (c) => c.roles?.sampling
);

// src/view-model.ts:139-141 — content column lookup (runs first, via validateDataView)
private getContentMetadataIndex(columns: DataViewMetadataColumn[]) {
    return columns.findIndex((c) => c.roles?.content);
}

// src/view-model.ts:162 — tooltip role check (getTooltipData)
if (c.roles?.[role]) {
```

Regression tests (commit `175d71a`, test/view-model.test.ts) each include a roles-less column literal `{ displayName: 'Format', format: '0.0%' }`, placed **before** the role-bearing columns to defeat short-circuit masking:

```typescript
it('should ignore columns without roles (dynamic format strings) when locating content column', () => {
    // fixture elided — metadata.columns (order matters) is:
    //   [{ displayName: 'Format', format: '0.0%' },
    //    { roles: { content: true }, displayName: 'HTML' }]
    handler.validateDataView(dataViews);
    expect(handler.viewModel.isValid).toBe(true);
    expect(handler.viewModel.contentIndex).toBe(1);
});
```

## Why This Works

- With `?.`, an undefined `roles` evaluates to `undefined` (falsy): `some()` skips the column, `findIndex()` keeps scanning past it, and the tooltip `if` excludes it — the injected column is ignored everywhere without disturbing real columns.
- **Point-guards are the right altitude here, not boundary filtering.** Columns and row cells are positionally linked: `contentIndex` (from `findIndex` over `metadata.columns`) is consumed as `row[this.viewModel.contentIndex]`, and `getTooltipData` reads `row[i]` by column index. Filtering roles-less columns out of the columns array without transforming every row would desynchronize indices and silently read the wrong cells — worse than the crash.

## Prevention

- **Enable strict null checks.** `powerbi-visuals-api` declares `roles` optional, so under `strictNullChecks` every unguarded access is compile error TS18048 (`'c.roles' is possibly 'undefined'` — observed in IDE diagnostics when guards were reverted). `tsconfig.json` does not currently set `"strict": true`/`"strictNullChecks": true`. Note this is a small migration, not a one-flag change: the API also declares `DataView.table`, `DataViewTable.rows`, and similar surfaces optional, so enabling the flag will surface (legitimate) errors beyond `roles` that need fixing alongside.
- **Audit the whole pattern when guarding it.** The incomplete first fix guarded two of three sites. Before committing a guard, grep for every access of the property chain (e.g. `\.roles[.\[]`) in the affected scope.
- **Fixture the hostile data shape, worst-case ordering first.** Dataview fixtures should include a roles-less column positioned before role-bearing columns, since `findIndex`/`some` short-circuiting can mask unguarded sites otherwise. Prefer typing fixtures as `powerbi.DataView[]` over `any[]` — `roles` is optional in the API, so the roles-less column is representable without casts and the compiler then catches fixture drift.
- **Mutation-verify backfilled tests.** When tests are written after the fix exists, revert one guard at a time, confirm the targeted test fails with the expected TypeError at the exact line, then restore. This proved each of the three tests catches its specific guard (and that the partial fix was insufficient).
- When verifying a fix like this in UAT, remember Power BI can swap a dev/test visual back to the AppSource version on report re-open — a "fix isn't applying" report may be a stale visual, not a regression. (auto memory [claude])

## Related Issues

- GitHub issue #159 (dynamic format string support); fix branch `fix/dynamic-format-guard`, commits `ed3f5fc`, `6a4274d`, `175d71a`
- [docs/solutions/security-issues/dompurify-svg-denylist-forceKeepAttr-regressions-2026-05-07.md](../security-issues/dompurify-svg-denylist-forceKeepAttr-regressions-2026-05-07.md) — same fail-closed/defensive-guard philosophy applied at the sanitizer layer
