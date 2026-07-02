---
title: "Renaming a data role display name requires a sweep of every user-facing string that names it"
category: conventions
module: powerbi-visuals-html-content
date: 2026-07-03
problem_type: convention
component: tooling
severity: low
applies_when:
  - "Renaming the display name of a data role (or any user-facing surface) in a Power BI custom visual"
  - "A field-well or feature name appears in prose inside other localized strings or docs"
  - "Verifying a display-string rename is complete before committing"
tags:
  - power-bi
  - custom-visual
  - rename-safety
  - string-resources
  - localization
  - data-roles
related_components:
  - documentation
---

# Renaming a data role display name requires a sweep of every user-facing string that names it

## Context

The `sampling` data role's display name was renamed "Granularity" → "Context" (the role now provides grouping, cross-filter identity, and tooltip/drillthrough context, so "Granularity" undersold it). The obvious edit is the role's own `Roles_Sampling` / `Roles_Sampling_Description` keys in `stringResources/en-US/resources.resjson`. But the old name also appeared *in prose* inside other user-facing strings — two cross-filter format-pane descriptions referenced "the Granularity of your dataset", and the v2 user guide told readers to bind a column to **Granularity**. Editing only the role's own keys would have shipped a format pane that tells users to configure a field well that no longer exists by that name.

## Guidance

When renaming any user-facing name (data role, object/card title, feature name) in a Power BI visual, treat the rename as a *sweep*, not an edit:

1. **Rename the owning keys** — the role's `displayNameKey`/`descriptionKey` values in the resjson (the internal role name in `capabilities.json` is contract and never changes; see the runtime-vs-persisted classification convention).
2. **Grep every locale's resjson for the old name as prose** — other strings routinely reference field wells by display name in their descriptions:

   ```
   grep -i "granularity" stringResources/**/resources.resjson
   ```

   In this case: `Objects_CrossFilter_Description` and `Objects_CrossFilter_Enabled_Description` both still said "Granularity".
3. **Grep docs and landing-page strings** — user guides walk through binding fields by display name (`docs/v2/HTML-Content-v2-Guide.md` said "put … your grouping column in **Granularity**").
4. **Confirm capabilities fallbacks are placeholders** — this repo's literal `displayName`/`description` values in `capabilities.json` are placeholder text ("Sampling", "Sampling description.") only shown if localization fails; they follow the same placeholder pattern as every other role, so they stay as-is.
5. **Leave internal identifiers alone** — `hasGranularity`, code comments, and test names are not user-facing; renaming them is optional churn, not correctness.

## Why This Matters

Stale prose references are worse than a missed rename of the primary key: the format pane ends up instructing users to use a field well that doesn't exist under that name, which reads as a product bug. Because resource strings are prose, the compiler and tests catch none of this — a case-insensitive grep for the old display name is the only guardrail. The sweep also surfaces adjacent latent defects (here, a pre-existing typo: "if Granularity if provided").

## When to Apply

- Any display-name rename in `stringResources/` (roles, objects, properties)
- Renaming user-visible feature or field-well names referenced in docs
- Reviewing someone else's rename PR for completeness

## Examples

The complete sweep for this rename touched three strings and one doc line:

```diff
- "Roles_Sampling": "Granularity",
+ "Roles_Sampling": "Context",
- "Objects_CrossFilter_Description": "... based on the Granularity of your dataset.",
+ "Objects_CrossFilter_Description": "... based on the Context of your dataset.",
- "Objects_CrossFilter_Enabled_Description": "... if Granularity if provided.",
+ "Objects_CrossFilter_Enabled_Description": "... if Context is provided.",
```

plus `docs/v2/HTML-Content-v2-Guide.md`: "put … your grouping column in **Context**."

## Related

- [Classify a rename as runtime-only vs persisted before applying it](classify-rename-runtime-vs-persisted-before-applying-2026-06-20.md) — the prerequisite gate: this sweep applies only after the rename is classified runtime-only (display strings). That doc also records this exact rename as a parked follow-up.
- [Report-page tooltips require three independent gates](../design-patterns/report-page-tooltip-three-gate-measure-only-2026-06-12.md) — why the role's new description mentions measures feeding report page tooltips.
