---
title: "esbuild/vitest does not inline a const enum from an external .d.ts — use literals + a test shim"
date: 2026-06-15
category: tooling-decisions
module: src/render-orchestrator.ts
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - "Referencing a powerbi-visuals-api const enum (VisualUpdateType, etc.) in code that vitest executes"
  - "Any TS project where esbuild/vitest transforms tests but webpack builds production"
  - "Writing bitwise flag checks or routing against VisualUpdateType in unit-tested code"
  - "A test errors with 'Cannot read properties of undefined' on an enum member, or a bitwise check quietly returns 0"
symptoms:
  - "TypeError: Cannot read properties of undefined (reading 'Data') when a test references powerbi.VisualUpdateType.Data"
  - "A bitwise expression (updateType & VisualUpdateType.Data) evaluates to 0 for all inputs under vitest"
  - "Compiles under tsc and works in the webpack production build; fails only under vitest"
root_cause: missing_tooling
resolution_type: code_fix
related_components:
  - src/visual.ts
  - test/render-orchestrator.test.ts
tags:
  - const-enum
  - esbuild
  - vitest
  - powerbi-visuals-api
  - bitwise
  - visual-update-type
  - webpack-vs-esbuild
---

# esbuild/vitest does not inline a const enum from an external .d.ts — use literals + a test shim

## Context

WP-B added a pure classifier `isEntryAffectingUpdate(updateType, firstRender, fingerprintChanged)` in [src/render-orchestrator.ts](../../../src/render-orchestrator.ts) that bitwise-tests whether a Power BI `update()` carries a data change: `(updateType & VisualUpdateType.Data) === VisualUpdateType.Data`. Referencing `VisualUpdateType.Data` from `powerbi-visuals-api` broke the unit tests while production was unaffected — because vitest (esbuild) and the pbiviz build (webpack) handle TypeScript `const enum` from external packages differently.

## Guidance

**Never reference a `powerbi-visuals-api` const-enum member in code that runs under esbuild/vitest. Use a documented numeric literal in the implementation and a local value-object shim in tests.**

### Why

`VisualUpdateType` is declared `const enum` in `node_modules/powerbi-visuals-api/src/visuals-api.d.ts` (~line 23). A `const enum` has no runtime object — the compiler is meant to substitute each member with its literal value inline.

- **webpack** (pbiviz production build) inlines correctly via `tsc`, so production code like [src/visual.ts](../../../src/visual.ts) `powerbi.VisualUpdateType.Data === (options.type & powerbi.VisualUpdateType.Data)` has always worked and is *not* affected.
- **esbuild** (vitest's transformer, running with `isolatedModules` semantics) does **not** inline external const-enum members. At test runtime `powerbi.VisualUpdateType` is `undefined` (the type was erased and no runtime object exists). Depending on the reference form the result is either a thrown `TypeError` (`powerbi.VisualUpdateType.Data` → reading `.Data` of `undefined`) or, where the member lands in a bitwise op against an already-`undefined` value, a silent coercion to `0`. Both forms are wrong; the thrown-TypeError form is the common one and is how this was caught (a red test the author could mistake for a logic bug).

### Fixed implementation — [src/render-orchestrator.ts](../../../src/render-orchestrator.ts)

```ts
/**
 * VisualUpdateType.Data = 1 << 1 = 2.
 * Defined as a const enum in powerbi-visuals-api, which esbuild/vitest does
 * not inline from external declaration files, so we use the literal value.
 */
const DATA_BIT = 1 << 1; // 2

const hasDataBit = (updateType & DATA_BIT) === DATA_BIT;
```

### Fixed test shim — [test/render-orchestrator.test.ts](../../../test/render-orchestrator.test.ts)

```ts
// VisualUpdateType is a const enum esbuild/vitest can't inline from an
// external .d.ts, so mirror the literal values the tests use.
const VUT = {
    Data: 1 << 1,     // 2
    Resize: 1 << 2,   // 4
    ViewMode: 1 << 3, // 8
    Style: 1 << 4,    // 16
    ResizeEnd: 1 << 5 // 32
} as const;
```

Literals were verified against `visuals-api.d.ts`. Keep them in sync if the API ever renumbers (these bit positions are long-stable).

## Why This Matters

The failure is **test-only**: the identical reference works in the webpack production build, so a developer can be misled in either direction — a red unit test wrongly blamed on the classifier's own logic, or (in the bitwise-coercion form) a green test asserting against `0`-derived garbage. Neither symptom points at the build-tool divergence, which is the actual cause. Because production is fine, it can also slip to where only the missing test coverage would have caught it.

**Bitwise-AND, not equality (corollary, issue #422).** Independently of the const-enum trap, comparing update types with `===` is wrong: the host emits undocumented composite update types `126` (`0b1111110`) and `254` (`0b11111110`) in the wild ([microsoft/PowerBI-visuals-tools#422](https://github.com/microsoft/PowerBI-visuals-tools/issues/422), filed by this repo's owner — note it's an *upstream tools* issue, not this repo). Both contain the Data bit (`2`), so `(updateType & DATA_BIT) === DATA_BIT` catches them while `=== VisualUpdateType.Data` would not. Also note `VisualUpdateType.All` is **510** in this API version (it gained `FormattingSubSelectionChange=64`, `FormatModeChange=128`, `FilterOptionsChange=256`), not the commonly cited 62.

## When to Apply

- Referencing `VisualUpdateType` or any other `const enum` from `powerbi-visuals-api` (grep `visuals-api.d.ts` for `const enum`) in code exercised by vitest.
- Writing update-type routing, guards, or classifiers, or asserting update-type values in tests.
- It technically doesn't apply to production-only paths (webpack inlines), but production code accretes test coverage over time — prefer literals everywhere and document their source.

## Examples

```ts
// BROKEN under vitest — VisualUpdateType.Data is undefined at esbuild runtime
import VisualUpdateType = powerbi.VisualUpdateType;
const hasData = (updateType & VisualUpdateType.Data) === VisualUpdateType.Data;
// and in tests: powerbi.VisualUpdateType.Data → TypeError (reading 'Data' of undefined)

// CORRECT — literal in impl, value-shim in tests
const DATA_BIT = 1 << 1; // VisualUpdateType.Data = 2
const hasData = (updateType & DATA_BIT) === DATA_BIT;

// Composite host types (#422) — caught by AND, missed by equality:
expect(isEntryAffectingUpdate(126, false, false)).toBe(true);  // has Data bit
expect(isEntryAffectingUpdate(254, false, false)).toBe(true);  // has Data bit
expect(isEntryAffectingUpdate(VUT.Resize | 64, false, false)).toBe(false); // no Data bit
```

## Related

- Surfaced during WP-B (render lifecycle modes): commits `05950c4` (literal workaround) and `4823774` (corrected the comment's bit math). Plan: [docs/plans/2026-06-13-001-render-lifecycle-modes-plan.md](../../plans/2026-06-13-001-render-lifecycle-modes-plan.md) (API-facts section documents the same trap).
- Upstream reference: [microsoft/PowerBI-visuals-tools#422](https://github.com/microsoft/PowerBI-visuals-tools/issues/422) — undocumented composite `VisualUpdateType` values (126/254; `All=510`).
- No related in-repo issues; this is the library's first toolchain-layer (build-environment) learning, distinct from the runtime/visual-logic docs.
