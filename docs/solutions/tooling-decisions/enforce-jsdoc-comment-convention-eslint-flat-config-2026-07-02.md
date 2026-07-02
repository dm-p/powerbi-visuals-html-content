---
title: "Enforcing a JSDoc comment convention with eslint-plugin-jsdoc under ESLint 10 flat-config"
date: 2026-07-02
category: tooling-decisions
module: eslint.config.mjs
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Adding or changing lint rules in an ESLint 9/10 flat-config (eslint.config.mjs) project"
  - "Enforcing JSDoc/doc-comment presence on top-level declarations with eslint-plugin-jsdoc"
  - "A repo still contains a legacy .eslintrc.* alongside a flat config"
  - "jsdoc/require-jsdoc fails to see a /** */ block above an export const"
  - "Establishing a codebase-wide comment style that must render on hover in VS Code"
related_components:
  - eslint.config.mjs
  - .prettierrc
  - package.json
tags:
  - eslint
  - jsdoc
  - eslint-plugin-jsdoc
  - flat-config
  - comment-convention
  - prettier
  - require-jsdoc
  - typescript
---

# Enforcing a JSDoc comment convention with eslint-plugin-jsdoc under ESLint 10 flat-config

## Context

The repo is a Power BI custom visual (TypeScript, ESLint 10 flat config, Prettier). The goal was to impose a single, machine-enforced comment convention and then put a docstring on every top-level declaration so VS Code renders hover documentation everywhere.

**The convention that was agreed:**

| Comment site | Style | Rationale |
|---|---|---|
| In-body comments (inside a function/block) | `//` (single or stacked) | Not surfaced on hover; keep them lightweight |
| Module-header comments (top of file, before imports) | `//` | Not attached to a declaration |
| **Every top-level declaration** — module-level `const`/`let`/`function`/`class`/`type`/`interface`/`enum`, exported *or not* | `/** */` JSDoc block | **Only block comments render on hover in VS Code**; `//` line comments do not |
| Non-doc asides (pointers, `eslint-disable`, section dividers) | `//` | Not documentation |

**Demarcation rule:** a `/** */` block must sit *immediately* above the declaration it documents — no blank line between them, no second block interposed. This makes orphaned/floating doc blocks (the kind a hoist/reorder refactor leaves behind) mechanically detectable rather than silently drifting. This rule was added *because* real orphaned blocks had already been found in the tree.

`*.generated.ts` and `*.d.ts` are exempt.

**Enforcement mechanism:** `eslint-plugin-jsdoc`'s `jsdoc/require-jsdoc` rule at `error`, configured *description-only* (no `@param`/`@returns` ceremony — a plain `/** text */` satisfies it), scoped strictly to top-level declaration contexts via AST selectors.

## Guidance

### The config that works

The rule is driven *entirely* by an explicit `contexts` array of AST selectors — not by the rule's built-in `require` defaults. Every top-level declaration kind is selected as a direct child of `Program`, and exported declarations are selected on the **outer** `ExportNamedDeclaration` wrapper:

```js
import powerbiVisualsConfigs from 'eslint-plugin-powerbi-visuals';
import jsdoc from 'eslint-plugin-jsdoc';

// Top-level declaration contexts (direct children of Program, exported or not).
// Exported decls are matched on the OUTER ExportNamedDeclaration (that is where a
// leading block attaches); [declaration] skips bare `export { … }` re-exports.
const topLevelDecls = [
    ...[
        'VariableDeclaration',
        'FunctionDeclaration',
        'ClassDeclaration',
        'TSTypeAliasDeclaration',
        'TSInterfaceDeclaration',
        'TSEnumDeclaration'
    ].map((d) => `Program > ${d}`),
    'Program > ExportNamedDeclaration[declaration]'
];

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        files: ['src/**/*.ts'],
        ignores: ['src/**/*.generated.ts', 'src/**/*.d.ts'],
        plugins: { jsdoc },
        rules: {
            'jsdoc/require-jsdoc': [
                'error',
                {
                    // All `require` sub-flags OFF — the top-level `contexts`
                    // are the ONLY thing that fires the rule. Otherwise nested
                    // in-body functions get flagged and top-level ones double-report.
                    require: {
                        FunctionDeclaration: false,
                        ClassDeclaration: false,
                        MethodDefinition: false,
                        ArrowFunctionExpression: false,
                        FunctionExpression: false
                    },
                    contexts: topLevelDecls
                }
            ]
        }
    },
    { ignores: ['node_modules/**', 'dist/**', /* … */ ] }
];
```

### The rules of thumb that make it correct

1. **ESLint 10 is flat-config-only.** It reads `eslint.config.mjs` and *silently ignores* a legacy `.eslintrc.*`. Do not keep both — delete the dead `.eslintrc` file so no one edits it expecting an effect. When a rule "does nothing," the first diagnostic is `npx eslint --print-config <file>` — if your rule/plugin is absent from that output, ESLint isn't loading the config you think it is.

2. **Comment attachment for exported declarations is on the outer `export` node — but only for *some* node kinds.** A `/** */` above `export function`/`class`/`interface`/`type`/`enum` is found because the plugin's node-reduction climbs to the `export` wrapper for those kinds. `VariableDeclaration` does **not** get that climb. So you must select the outer wrapper (`Program > ExportNamedDeclaration[declaration]`) to cover `export const`/`export let`; the inner-node selector (`… > VariableDeclaration`) will always report them as undocumented no matter where you put the block.

3. **Turn off the `require` defaults; drive purely from `contexts`.** `require.FunctionDeclaration` defaults to `true`, which (a) double-reports top-level functions and (b) leaks down to *nested, in-body* function declarations — directly violating the "in-body stays `//`" half of the convention. Setting every `require` sub-flag to `false` and relying only on `Program >`-anchored contexts keeps enforcement strictly top-level.

4. **Iterate with `--no-cache`.** `.eslintcache` returns stale results under flat config (already-fixed declarations still flagged; edited files appearing clean). Use `npx eslint --no-cache` (or delete `.eslintcache`) whenever you are developing or verifying the rule.

5. **Verify against the *real merged* config, not an isolated probe.** A throwaway `Linter`/fixture harness that omits `powerbiVisualsConfigs.configs.recommended` gives **false negatives** specifically on `export const`. Put test fixtures *inside* the repo so they inherit `eslint.config.mjs` end-to-end.

6. **Prettier is red repo-wide from mixed line endings, independent of your change.** `.prettierrc` here has no `endOfLine` key, so it defaults to `lf`; every CRLF file in the tree then fails `prettier --check`. To see *real* (non-EOL) drift on only the files you touched:
   ```bash
   npx prettier --config .prettierrc --end-of-line auto --check <files>
   ```
   Longer-term, add `endOfLine` to `.prettierrc` or a `.gitattributes` `* text=auto` rule to end the noise.

### Rolling this out at scale (188 declarations across 24 files)

The backfill was ~29 `//` → `/** */` conversions (preserving existing wording) plus ~159 newly authored docstrings. It ran as **9 parallel subagents**, one per file-batch, each self-verifying with `npx eslint <its files> --no-cache` until exit 0.

Two hard lessons:

- **Fix the rule config FIRST, confirm it on one file, *then* fan out.** Because the export-const selector bug (gotcha #2) was still live when agents started, one subagent "fixed" its files by splitting exports — rewriting `export const X = …` into `const X = …; export { X };` to dodge the false positive. That is a style regression that had to be reverted once the selector was corrected. A wrong rule config, fanned out to parallel agents, makes them invent divergent per-file workarounds.
- **Explicit anti-slop instruction is mandatory.** Agents were told: never write a tautological `/** The X constant. */`; a docstring must explain intent or a constraint a reader *cannot* infer from the name; and existing `//` docs must be converted preserving their wording, not reworded.

**Final verification gates (all met):** `eslint src --no-cache` → 0; `tsc --noEmit` → 0; `vitest` → 1121/1121; and `git diff` confirmed comment-only changes (no logic touched). Shipped as two commits — docs first (the blocks), then config (the rule) — so every commit is green.

## Why This Matters

- **The failure modes are all silent.** Each of the three worst gotchas produces *no error telling you what's wrong*: ESLint 10 silently ignores the legacy `.eslintrc` (your edits vanish with no message); the export-const selector reports "Missing JSDoc comment" on a declaration that *visibly has one right above it*; and `.eslintcache` reports fixed code as broken and broken code as fixed. Without knowing the mechanism, each burns hours of "why isn't my change taking effect" — and they compound, because you can hit two at once (stale cache + wrong config) and conclude your selector is wrong when it was right.

- **The export-const trap is genuinely non-obvious.** Nothing in the `require-jsdoc` docs says "variable exports attach their comment to a different node than function exports." It stems from how the plugin's comment-reduction (via `@es-joy/jsdoccomment`'s `getReducedASTNode`, which climbs to the `export` wrapper for functions/classes/interfaces/types/enums but leaves `VariableDeclaration` unchanged) interacts with where `getCommentsBefore()` looks. You only find it by observing the *asymmetry*: `export function`/`export interface`/`export type` pass, `export const`/`export let` don't — same block placement. That asymmetry is the fingerprint.

- **Parallel agents amplify a wrong rule.** A misconfigured lint rule doesn't just fail once — dispatched across 9 agents, it produced a real code regression (export-splitting) that then had to be found and reverted. Getting the config right *before* fan-out is the difference between a clean comment-only diff and a polluted one.

- **The EOL noise masks real drift.** If you don't isolate line-ending failures, `prettier --check` is red on every CRLF file and you cannot tell whether *your* change introduced formatting drift. The `--end-of-line auto` flag is what lets you trust the check on a mixed-EOL repo.

## When to Apply

- **Adding `require-jsdoc` (or any AST-selector lint rule) that must cover *exported* declarations.** For **variable** declarations the leading comment attaches to the **outer** `ExportNamedDeclaration`, so select the wrapper (`Program > ExportNamedDeclaration[declaration]`), not the inner `VariableDeclaration`. Use `[declaration]` to exclude bare `export { x }` / `export type { x }` re-exports, which have nothing to document.
- **Scoping a doc/comment rule to top-level only.** Keep in-body and module-header comments as `//`; enforce `/** */` blocks *only* on top-level declarations via `Program >`-anchored `contexts`, and **disable the rule's `require` sub-flags** so built-in defaults don't leak enforcement into nested code.
- **A lint rule "does nothing."** Before touching the selector, run `npx eslint --print-config <file>` and confirm the rule/plugin actually appears. On ESLint ≥ 9/10, verify you're editing `eslint.config.mjs` and that no legacy `.eslintrc.*` is confusing your expectations — and delete the dead one.
- **Developing or verifying *any* lint rule.** Always iterate with `npx eslint --no-cache`; the flat-config cache cannot be trusted while the rule set is changing. Verify against the fully-merged repo config (fixtures *inside* the repo), never an isolated `Linter` probe that omits your shared base config.
- **Backfilling docstrings/comments across many files with parallel agents.** Land and confirm the rule config on a single file first; only then fan out. Give agents an explicit anti-tautology instruction and a "convert existing `//` docs verbatim" instruction. Gate the merge on `eslint --no-cache` = 0, `tsc --noEmit` = 0, tests green, and a `git diff` that is comment-only.
- **Running `prettier --check` on a repo with mixed line endings.** Use `npx prettier --config .prettierrc --end-of-line auto --check <files>` to isolate real drift, and consider adding an `endOfLine` setting or `.gitattributes` `* text=auto` to stop the recurring noise.

## Examples

### Example 1 — The export-const asymmetry (the core trap)

Same block placement; only the node *kind* differs. With the **inner-node** selector `Program > ExportNamedDeclaration > VariableDeclaration`:

```ts
/** Parses the raw config payload into a typed settings object. */
export function parseConfig(raw: string): Settings { /* … */ }   // ✅ passes

/** Default poll interval in milliseconds; tuned to Desktop's refresh cadence. */
export const POLL_INTERVAL_MS = 500;                             // ❌ "Missing JSDoc comment"
```

`parseConfig` passes because the plugin climbs to the `export` wrapper for functions and finds the block there. `POLL_INTERVAL_MS` fails because for a `VariableDeclaration` the plugin checks the *inner* node, calls `getCommentsBefore()` on it, and gets `[]` — the block is before `export`, i.e. attached to the outer `ExportNamedDeclaration`. **The fix** is to select the outer wrapper instead:

```js
'Program > ExportNamedDeclaration[declaration]'   // covers export const/let AND the others
```

After this, both declarations pass. Non-exported declarations keep their direct `Program > <NodeType>` selectors.

### Example 2 — `require` defaults leaking into in-body code

With `require.FunctionDeclaration` left at its default `true`:

```ts
/** Builds the sanitizer allow-list from the current formatting model. */
export function buildAllowList(model: FormatModel): AllowList {
    // helper — intentionally undocumented per the // convention
    function normalize(tag: string): string {          // ❌ flagged "Missing JSDoc comment"
        return tag.trim().toLowerCase();
    }
    // …
}
```

The nested `normalize` gets flagged, violating "in-body stays `//`". Setting every `require` sub-flag to `false` and driving purely from the `Program >`-anchored `contexts` fixes it — nested declarations are no longer matched, and top-level ones stop double-reporting.

### Example 3 — Diagnosing "the rule does nothing"

```bash
# ESLint 10 loaded eslint.config.mjs but you were editing .eslintrc.mjs.
# Confirm what the rule actually resolves to for a real file:
npx eslint --print-config src/visual.ts | grep -A3 "require-jsdoc"
# → key absent  ⇒ the config you edited is not the one ESLint reads.
# Fix: put the rule in eslint.config.mjs; delete the dead .eslintrc.mjs.
```

### Example 4 — The style regression a wrong rule provoked

A subagent, hitting the still-live export-const false positive, "fixed" its files like this to make the block attach to a bare declaration the inner selector *would* see:

```ts
// ❌ regression introduced to dodge the selector bug — had to be reverted
/** Default poll interval in milliseconds. */
const POLL_INTERVAL_MS = 500;
export { POLL_INTERVAL_MS };
```

Once the selector was corrected to `Program > ExportNamedDeclaration[declaration]`, this was reverted back to the idiomatic `export const POLL_INTERVAL_MS = 500;` with the docstring directly above the `export`. Lesson: a wrong rule config, fanned out to parallel agents, manufactures real diffs you then have to unwind.

### Example 5 — Anti-slop: what a docstring must (not) say

```ts
// ❌ tautological — adds nothing a reader can't get from the name
/** The max content length constant. */
const MAX_CONTENT_LENGTH = 2_000_000;

// ✅ explains the constraint / intent a reader cannot infer
/**
 * Upper bound on rendered HTML we serialize back for diagnostics. Authors push
 * multi-MB content (~2 MB per measure); anything larger is truncated to keep the
 * postMessage payload and the sandboxed iframe responsive.
 */
const MAX_CONTENT_LENGTH = 2_000_000;
```

### Example 6 — Isolating real Prettier drift on a mixed-EOL repo

```bash
# .prettierrc has no endOfLine key → defaults to lf → every CRLF file fails.
# This flag makes the check ignore EOL and surface only real formatting drift:
npx prettier --config .prettierrc --end-of-line auto --check src/visual.ts src/sanitize/css.ts
# Longer-term: add "endOfLine" to .prettierrc, or a .gitattributes `* text=auto`.
```

## Related

- [../tooling-decisions/esbuild-vitest-const-enum-external-dts-not-inlined-2026-06-15.md](./esbuild-vitest-const-enum-external-dts-not-inlined-2026-06-15.md) — sibling toolchain-layer learning (the other case where a JS/TS tooling layer misbehaves because of how it reads/handles an external declaration). Together these are the two toolchain-config learnings for this repo.
- [../conventions/regenerate-sanitizer-derived-artifacts-2026-06-30.md](../conventions/regenerate-sanitizer-derived-artifacts-2026-06-30.md) — same prevention shape as the `.eslintcache` gotcha: a stale/ungated derived state passes CI silently unless a gate enforces it.
- [../developer-experience/edition-bootstrap-generated-files-2026-06-24.md](../developer-experience/edition-bootstrap-generated-files-2026-06-24.md) — related npm-lifecycle / generated-state wiring and the "a skipped step fails confusingly" flavour.
- GitHub issues: none found (`gh issue list --search "eslint jsdoc" / "prettier line endings"` returned no matches at time of writing).
