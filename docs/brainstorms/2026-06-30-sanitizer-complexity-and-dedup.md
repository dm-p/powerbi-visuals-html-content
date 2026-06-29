# Sanitizer module: complexity cleanup, relocation, and pattern-list unification

**Date:** 2026-06-30
**Status:** Design — pending review
**Branch:** `refactor/sanitizer-health`, off `2.0.0` once the dep-update work
(`chore/package-updates`) is fast-forward-merged into it. Kept separate from
the dep-update branch.

## Problem

CodeScene flags several functions in the sanitizer as overly complex, and two
sanitizer files sit at the top level of `src/` rather than inside the
`src/sanitize/` module. Separately, the dangerous-scheme/scripting-pattern
knowledge is duplicated across three to four parallel definitions in different
forms — a long-standing DRY smell.

This effort does three things, in order of decreasing safety:

1. **Relocate** the two stray sanitizer files into `src/sanitize/`.
2. **Reduce complexity** of the CodeScene-flagged functions via
   behavior-preserving extraction.
3. **Unify** the duplicated dangerous-pattern lists into a single source of
   truth (the one part that can shift security behavior — gated accordingly).

## CodeScene baseline (measured via `cs review`, 2026-06-30)

| File | Health | Headline flags |
|---|---|---|
| `sanitize/backend.certified.ts` | **5.68** | `uponSanitizeAttribute` cc=62 / 221 LoC; `recordCoreRemovals` cc=14; `afterSanitizeElements` cc=10; `getSanitizedDataUri` cc=9; `uponSanitizeElement` cc=9 |
| `visual.ts` | 8.16 | `openDiagnostics` cc=17 / 74 LoC; `update` cc=12 / 71 LoC; `buildRenderSteps` 93 LoC |
| `css-sanitizer.ts` | 8.19 | `sanitizeCss` cc=15 / 73 LoC; `hasUnsafeFunction` bumpy; `hasDangerousSelector` complex conditional |
| `svg-payload-scan.ts` | 8.63 | `hasDangerousSvgPayload` cc=14 / nesting 4; `isSafeImageDataUri` cc=10 |

`backend.certified.ts` (5.68) is the priority; everything else is already
healthy and improved opportunistically. The four lower-priority flagged files
(`splash.ts`, `render-orchestrator.ts`, `view-model.ts`, `domain-utils.ts`, all
≥ 8.95) are **out of scope**.

## Goals

- Relocate `css-sanitizer.ts` and `svg-payload-scan.ts` under `src/sanitize/`.
- Raise CodeScene health: `backend.certified.ts` 5.68 → ≥ 8; the other three
  in-scope files → ≥ 9; clear the duplication/clone flag.
- One canonical definition of the dangerous-scheme/scripting patterns.
- No reduction in what any call site detects (security may widen, never narrow).

## Non-goals

- No change to sanitizer output for any **safe** input (parts 1–2 are strictly
  behavior-preserving; part 3 may only widen detection).
- No new sanitization features or policy relaxations.
- No work on the four lower-priority flagged files.
- No edits to the dep-update chore branch; this is its own branch off `2.0.0`.

## Design

### Part 1 — Relocation (mechanical)

- `git mv src/css-sanitizer.ts → src/sanitize/css.ts` (shortened — the module
  context makes the `-sanitizer` suffix redundant)
- `git mv src/svg-payload-scan.ts → src/sanitize/svg-payload-scan.ts`

Update the import sites:

- `src/sanitize/backend.certified.ts` — `../css-sanitizer` → `./css`,
  `../svg-payload-scan` → `./svg-payload-scan`.
- `src/sanitize/css.ts` — `./svg-payload-scan` stays `./svg-payload-scan`.
- `test/svg-payload-scan.test.ts` — `../src/svg-payload-scan` →
  `../src/sanitize/svg-payload-scan`.
- Any test importing `css-sanitizer` updates to `../src/sanitize/css`.
- `src/sanitize/backend.passthrough.ts` — comment reference only.

### Part 2 — Behavior-preserving complexity extraction

**`backend.certified.ts` — the `uponSanitizeAttribute` gauntlet (cc=62).**
The hook is a linear sequence of independent guard clauses, each ending in
`dropAttr(...) + keepAttr=false + return`, plus two mutate-and-return gates
(data-URI, inline style) and a leading normalization step. Extract the decision
logic into a new module `src/sanitize/attribute-policy.ts`:

- Each gate becomes a pure function `(ctx) => Verdict`, where
  `ctx = { attrName, tagName, value, isSvgTag, allowHyperlinks }` and
  `Verdict = { action: 'drop', rule } | { action: 'keep', value } | { action: 'continue', value? }`.
- Gates, in **exactly** the current order (precedence is security-load-bearing):
  `normalizeUrlAttr` → `hyperlinkToggle` → `tagAllowlist` → `urlScheme` →
  `svgFunciri` → `smilAttributeName` → `dataUriAttr` → `styleAttr` →
  `xlinkJavascript` → `scriptingPatterns`.
- The hook becomes a thin loop: run gates in order, apply each verdict to
  `hookEvent` (`recordRemoval` + `keepAttr` / `attrValue`). It retains the
  fail-closed `try/catch` (any throw → `keepAttr = false`) and the trailing
  `if (isSvgTag) forceKeepAttr = true`.
- A `continue` verdict carrying a `value` updates both `ctx.value` and
  `hookEvent.attrValue` — preserving the current early write-back after NFKC
  normalization.

All DOMPurify side-effects (`recordRemoval`, `keepAttr`, `attrValue`,
`forceKeepAttr`) stay in the hook; only pure decision logic moves out.

Also extract, in the same file: `recordCoreRemovals` (cc=14 — simplify the
`removed`-entry type-narrowing branches into a small helper),
`getSanitizedDataUri` (cc=9), and minor structure in `afterSanitizeElements`
(cc=10) / `uponSanitizeElement` (cc=9).

**`css-sanitizer.ts`**

- `hasDangerousSelector`: extract the C0-control-character loop into
  `hasForbiddenControlChar(selector): boolean` — clears the complex-conditional
  flag and names the intent.
- `sanitizeCss` (cc=15 / 73 LoC): extract the three walk phases
  (`walkAtRules` / `walkRules` / `walkDecls`) and the per-mode serialization
  (declaration-list unwrap vs stylesheet `toString`) into named helpers; the
  body becomes a short orchestrator.

**`svg-payload-scan.ts`**

- `hasDangerousSvgPayload` (cc=14 / nesting 4): extract the inner-href scan
  loop into `hasDangerousInnerHref(decoded, depth): boolean`, flattening the
  depth-4 nesting. Recursion contract unchanged.
- `isSafeImageDataUri` (cc=10): extract the MIME/encoding parse into a helper.

**`visual.ts`**

- `openDiagnostics` (cc=17 / 74 LoC), `update` (cc=12 / 71 LoC),
  `buildRenderSteps` (93 LoC): extract cohesive sub-steps into private methods.
  No behavior change.

### Part 3 — Pattern-list unification (can widen detection; gated)

**Single source of truth:** new `src/sanitize/dangerous-patterns.ts` exporting
the canonical dangerous-scheme set **once**: `javascript:`, `vbscript:`,
`livescript:`, `mocha:`, `data:text/html`, `data:text/javascript`,
`data:application/javascript`, `data:application/x-javascript`.

**Derive each call-site form from the core**, layering context-specific extras
*explicitly* (never silently dropping a pattern):

| Call site | Form | Core + explicit extras |
|---|---|---|
| Attribute substring scan (`backend.certified.ts`) | substrings | core + spaced (`javascript :`) and control-char variants **generated** from the core (replaces hand-enumerated `scriptingPatterns`) |
| CSS value scan (`DANGEROUS_SCHEME_PATTERNS`) | regex | core + `data:image` |
| CSS final pass (`DEFENSE_IN_DEPTH_PATTERNS`) | regex | core + `@import` / `@font-face` / `@namespace` + `expression(` / `-moz-binding` / `behavior:` / `progid:` |

**Backward compatibility:** `VisualConstants.scriptingPatterns` and the two
css-sanitizer arrays become thin derivations (or re-exports) of the canonical
source, so existing imports and the `security-*.test.ts` references keep
resolving.

**Dead-code resolution:** `VisualConstants.cssDangerousPatterns` is currently
unreferenced in `src/` (the postcss pipeline replaced it) but is still asserted
by three test files. **Promote it into the canonical source** so it becomes the
live single source of truth the sanitizer derives from — its existing tests
keep working and become meaningful again. (`cssDangerousPatterns` is an internal
constant, not a persisted format property, so this is safe.) The canonical
`src/sanitize/dangerous-patterns.ts` and `VisualConstants.cssDangerousPatterns`
must agree by construction (one re-exports / derives from the other) rather than
drifting as two hand-maintained copies.

## Verification protocol

**Parts 1–2 (behavior-preserving)** — after **each file**: `npm test` (973) +
`npm run package` (ts-loader type-check). After the **full pass**:
`npm run docs:check` (corpus in sync) + `npm run test:integration` (147,
real browser). `cs review` before/after each file to record the health delta.

**Part 3 (may widen detection)** — additionally:

- **Superset assertion test:** for each original list, assert every pattern it
  previously caught is still caught at its call site after unification
  (detection may only widen, never narrow).
- **Hand-review** the `docs:check` corpus diff — any output change must be a
  *stricter* drop, justified and recorded, never a newly-admitted payload.
- Run `security-sanitization` + `security-xss-prevention` suites explicitly.
- `cs review` to confirm the duplication/clone flag clears.

## Risks

- **Gauntlet reordering.** The attribute gates have security-load-bearing
  precedence (e.g. hyperlink toggle before the per-tag allowlist). Extraction
  must preserve order exactly; the gate sequence is asserted by the existing
  corpus + integration tests.
- **NFKC write-back timing.** Normalization currently writes `hookEvent.attrValue`
  mid-hook; the loop must replicate that so downstream DOMPurify sees the
  normalized value. Covered by the Unicode-obfuscation corpus cases.
- **Unification narrowing detection.** The superset assertion + corpus diff
  review are the guard. If reconciling forms proves to risk a narrowing, fall
  back to keeping that list separate and DRYing only the safe subset.

## Sequencing

One branch off `2.0.0`, commits in design order: (1) relocation,
(2a–2d) per-file extraction, (3) unification. Each commit independently green.
Plan to follow via the writing-plans skill.
