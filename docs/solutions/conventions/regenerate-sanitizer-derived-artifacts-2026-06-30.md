---
title: Regenerate all sanitizer-derived artifacts when sanitizer output changes
date: 2026-06-30
category: conventions
module: sanitizer / generated artifacts
problem_type: convention
component: development_workflow
severity: medium
applies_when:
  - Editing the certified sanitizer (src/sanitize/) or its attribute/element policy
  - Changing test-integration/csp-harness/corpus.ts (the source corpus)
  - Any change that alters sanitized HTML/CSS output
tags: [sanitizer, codegen, uat-corpus, regeneration, docs-generation, derived-artifacts]
---

# Regenerate all sanitizer-derived artifacts when sanitizer output changes

## Context

A change to the certified sanitizer's behavior produces output that several
**generated** files mirror. When the on\*-handler element-drop fix changed
`<marquee onstart>x</marquee>` output (empty → `x` → empty again), the docs
were regenerated but the UAT corpus was **not**, so it had to be fixed up in a
separate follow-up commit (`a6dfee0 tests: sync UAT corpus with reversion`).

The trap: `npm run docs:check` guards `docs/sanitization-rules.md` in CI, but
the UAT CSVs in `test-uat/` have **no equivalent check** in the unit or
integration runs. A stale UAT corpus passes `npm test` and
`npm run test:integration` and only surfaces during UAT or PR review.

## Guidance

When a change alters what the sanitizer emits, regenerate **both** artifact
sets and commit them with the code change:

```bash
npm run docs:generate   # -> docs/sanitization-rules.md   (verify: npm run docs:check)
npm run uat:generate    # -> test-uat/{corpus,lorem,hyperlinks,stylesheet}.csv
```

Both generators run the live sanitizer (`getSanitizedHtmlForTesting`) over
`test-integration/csp-harness/corpus.ts`, so their output tracks the code.
`scripts/generate-uat-corpus.ts` even says so in its header: *"Re-run whenever
any source corpus or the sanitizer changes."* — but nothing enforces it.

Derived artifacts that depend on sanitizer output:

| Artifact | Generator | Guarded in CI? |
|---|---|---|
| `docs/sanitization-rules.md` | `npm run docs:generate` | Yes — `docs:check` (in `test:all`) |
| `test-uat/corpus.csv` | `npm run uat:generate` | **No** |
| `test-uat/lorem.csv` | `npm run uat:generate` | **No** |
| `test-uat/hyperlinks.csv` | `npm run uat:generate` | **No** |
| `test-uat/stylesheet.csv` | `npm run uat:generate` | **No** |

## Why This Matters

The UAT CSVs are the corpus a human runs through Power BI Desktop to confirm
real-world rendering. If they drift from the actual sanitizer output, the UAT
exercise validates stale expectations — the worst kind of green, because it
looks like coverage. Because no automated check catches the drift, the
discipline has to live in the workflow, not the test suite.

## When to Apply

- Any edit under `src/sanitize/` that can change emitted HTML/CSS.
- Any edit to `test-integration/csp-harness/corpus.ts` (adds/removes/retunes a
  payload).
- Reverting or re-tuning a sanitizer behavior (the regen has to follow the
  revert too — that's exactly what was missed here).

## Examples

The split that prompted this learning:

- `e9f7bdd fix: restore whole-subtree drop for event-handler elements` —
  changed sanitizer output and regenerated `docs/sanitization-rules.md`.
- `a6dfee0 tests: sync UAT corpus with reversion` — the **missed** UAT-corpus
  regen, done separately afterward.

Both should have been one commit. Going forward, run `docs:generate` and
`uat:generate` together whenever sanitizer output moves.

Possible guardrail (future): add a `uat:check` script mirroring `docs:check`
(generate to a temp dir, diff against the committed CSVs, fail on drift) and
wire it into `test:all`, so the discipline is enforced rather than remembered.

## Related

- `docs/brainstorms/2026-06-30-sanitizer-complexity-and-dedup.md` — sanitizer
  refactor spec (touches the same generated-artifact surface).
- `scripts/generate-uat-corpus.ts` / `scripts/generate-sanitization-docs.ts` —
  the two generators.
