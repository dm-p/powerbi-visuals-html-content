---
title: "Classify a rename as runtime-only vs persisted before applying it"
category: conventions
module: powerbi-visuals-html-content
date: 2026-06-20
problem_type: convention
component: tooling
severity: medium
applies_when:
  - "Renaming an identifier, token, or value in a Power BI custom visual"
  - "The value might be declared in capabilities.json or the formatting model"
  - "A change must avoid breaking-regression risk against existing reports"
  - "Deciding whether a rename is a safe display change or a persisted-state change"
tags:
  - power-bi
  - custom-visual
  - rename-safety
  - capabilities-json
  - formatting-model
  - persisted-state
  - regression-prevention
  - typescript
related_components:
  - documentation
  - testing_framework
---

# Classify a rename as runtime-only vs persisted before applying it

## Context

The task arrived with a hard edge: rename the user-facing diagnostics token `standard` → `contextual`, "with no breaking regression changes against the main branch." That is two requests in one. The rename itself is trivial find-and-replace. The constraint is the real work — in a *certified Power BI custom visual*, some identifiers are free to rename and some are load-bearing in saved reports, and the cost of guessing wrong is silent: an existing report that opens months later with corrupted or dropped formatting state, with no error to trace back to the rename.

So the friction is not "how do I rename a token" — it's "how do I *prove* this particular token carries no persisted state, before I touch it." The token in question is `TooltipSource` (`'contextual' | 'manual'`), a runtime-only union used to label diagnostics events. The job was to verify that classification, then do the mechanical rename symmetrically across type, emit sites, comments, and tests.

## Guidance

A decision procedure for renaming an identifier or value in a Power BI visual without regressing saved reports:

1. **Classify the symbol — runtime-only vs persisted.** The single test: *does this name or value ever land in report metadata?* It is **persisted** if it is declared under `objects.*.properties` in `capabilities.json`, or is a formatting-model property name/value that Power BI writes into the saved `.pbix`/`.pbip`. It is **runtime-only** if it is a display string, an internal TS union, an event token, a de-dup key, or log text that lives and dies inside a single visual update cycle.

2. **Route on the classification.**
   - Runtime-only → **rename freely.** The only cost is updating call sites and tests. Nothing in a saved report references it.
   - Persisted → **renaming is a breaking change to existing reports.** Do not delete or rename the old name/value. Add the new one alongside, keep the old as a recognized alias, and migrate; the superseded value must continue to be read.

3. **Confirm completeness before committing.** Grep the whole `src/` *and* `test/` tree for the old token. Ensure the type declaration, every emit/call site, the comments, and the test assertions all move together — a rename that updates the type but misses a string-literal emit site compiles and silently emits the stale value. Beware homographs: the same word often appears in unrelated prose or as a different concept's name. Do not blanket-replace.

4. **Verify the regression claim structurally, not by inspection alone.** If the feature does not exist on the target branch (`main`), there is by construction no persisted surface to regress — the strongest possible proof. Otherwise, prove the token never reaches `capabilities.json` or saved state by tracing every use to a runtime sink.

## Why This Matters

The asymmetry is the whole point. Renaming a runtime token is free; renaming a persisted value silently corrupts or drops existing report state on upgrade — with no error at rename time and no error when the old report reopens.

The mechanism is `capabilities.json`. Power BI persists the *values* of format/object properties declared under `objects.*.properties` into the saved report file. When that report is reopened — possibly months later, possibly after the visual auto-upgrades to a new version — Power BI looks up the persisted values *by the property name/identifier that was in effect when they were saved*. Rename or remove that identifier and the lookup misses: the author's saved formatting is dropped or the property reverts to default, live, in their report. (This is why this repo's standing rule is that superseded format properties are kept and unified, never deleted or renamed — old report metadata rides along and upgrades in place.)

In this session the token was on the *safe* side of that line, and provably so: `TooltipSource` is a runtime-only TS union. It feeds exactly two runtime sinks in `src/diagnostics/event-recorder.ts` — a human-readable event summary (`` `${phase} · ${source}` ``) and a tooltip de-dup key (`` `${phase}|${source}|${context}` ``) — and is emitted from `src/domain-utils.ts`. It appears nowhere in `capabilities.json`, is not a formatting-model property, and is never read back from persisted metadata. The diagnostics Events feature is brand-new on `feat/diagnostics-host-events` (branched off `2.0.0`); `main` has none of it. So the regression claim held structurally: there was no persisted surface to break. The rename landed in commit `800db2a` with 115 unit tests green and zero capabilities/formatting churn.

## When to Apply

Any time you rename or remove an identifier in a Power BI visual. The procedure is cheap and the failure mode is invisible, so run the classification step even when the rename "looks like a one-liner."

Apply it with particular care when the symbol is, or might be:
- a format/object property **name** declared in `capabilities.json`;
- an enum or string **value** that a formatting property can take and persist (dropdown options, mode flags);
- anything read back from report metadata on load or upgrade.

For runtime-only symbols (display strings, internal unions, event tokens, de-dup keys, log text) the procedure resolves immediately to "rename freely" — but you still confirm completeness (step 3) so a missed string-literal emit site doesn't ship a stale value.

## Examples

**Safe — runtime-only rename (what this session did).** A TS union and its emit site. Nothing here touches a saved report, so the rename is mechanical.

```ts
// src/diagnostics/types.ts
- export type TooltipSource = 'standard' | 'manual';
+ export type TooltipSource = 'contextual' | 'manual';

// src/domain-utils.ts — the row-resolved tooltip binder
  recordTooltipEvent(
    'show',
-   'standard',
+   'contextual',
    context,
  );
- recordTooltipEvent('hide', 'standard', '');
+ recordTooltipEvent('hide', 'contextual', '');
```

The value only ever flows into a display summary (`` `${phase} · ${source}` ``) and a de-dup key (`` `${phase}|${source}|${context}` ``) in `src/diagnostics/event-recorder.ts`. Completeness still matters: the type, both emit sites, the JSDoc examples, and the `test/event-recorder.test.ts` / `test/domain-utils.test.ts` assertions all moved together — and the unrelated word "standard" in `src/domain-utils.ts` comments ("standard content formatting") and the "standard/standalone edition" name were correctly left alone, because they are homographs, not the token.

**Unsafe — renaming a persisted `capabilities.json` property value (what you must NOT do).** If the same word were a persisted property value rather than a runtime union, the safe move is the opposite of a rename: keep the old value and add the new one alongside.

```jsonc
// capabilities.json — objects.*.properties values ARE persisted into saved reports
"contentSource": {
  "type": {
    "enumeration": [
-     { "value": "standard", "displayName": "Standard" },    // never rename/remove:
+     { "value": "contextual", "displayName": "Contextual" }  // saved reports store "standard"
    ]
  }
}
```

Doing the above drops the chosen value in every existing report that saved `"standard"` — on reopen it no longer matches an enumeration member. The correct change keeps `"standard"` as a recognized (possibly hidden/legacy) value and *adds* `"contextual"`, migrating old metadata forward rather than orphaning it.

## Related

- [Report-page tooltips require three independent gates](../design-patterns/report-page-tooltip-three-gate-measure-only-2026-06-12.md) — documents a parked `capabilities.json` data-role rename ("Granularity → Context") and the UAT re-validation it triggered; a concrete worked example of this convention's persisted-rename caution.
- [Power BI modal-dialog diagnostics: snapshot-in / result-out round-trip](../architecture-patterns/powerbi-modal-dialog-diagnostics-snapshot-result-roundtrip-2026-06-19.md) — same diagnostics feature and files; covers the adjacent *capabilities-vs-formatting* persistence trap (a toggle must be declared in `capabilities.json` or it reverts each `update()`). That doc is about *declaring* persisted properties; this one is about *not renaming* them.
- [Show Raw HTML serializer encoding](../ui-bugs/show-raw-html-dev-tools-serializer-2026-05-15.md) — shares the `src/domain-utils.ts` diagnostics surface; file-locality link only.
