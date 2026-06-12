---
title: "Report-page tooltips require three independent gates (issue #130)"
date: 2026-06-12
category: design-patterns
module: src/domain-utils.ts
problem_type: design_pattern
component: tooling
severity: medium
related_components:
  - capabilities.json
  - src/categorical-table.ts
  - src/view-model.ts
applies_when:
  - "Visual is configured with a single measure and no category/dimension fields"
  - "User expects Power BI report-page (canvas) tooltips to appear on hover"
  - "No field is bound to the Granularity (sampling) or Tooltips data roles"
  - "Changing the tooltips block in capabilities.json"
symptoms:
  - "Report-page tooltip never appears on hover, regardless of tooltip page configuration; no error, no console output"
  - "Default tooltip also never appears when the visual has no Granularity or Tooltips role fields"
  - "Tooltip works after adding any field to the Granularity or Tooltips role — even a duplicate of the content measure"
tags:
  - tooltips
  - report-page-tooltips
  - measure-only
  - selection-id
  - capabilities
  - data-roles
  - issue-130
  - categorical-mapping
---

# Report-page tooltips require three independent gates (issue #130)

## Context

During UAT of the categorical dataview migration (WP-A, branch `refactor/change-dataview`), the long-standing report that report-page tooltips never appear on a measure-only visual ([#130](https://github.com/dm-p/powerbi-visuals-html-content/issues/130), previously labeled an SDK limitation) turned out to be **three independent gates**, each of which silences the tooltip with no error or console indication. No single fix is sufficient; all three must be open simultaneously.

## Guidance

### Gate 1 — Identity

`tooltipService.show()` needs a selection identity so the host can resolve the hovered data point's context. Under the old `table` dataViewMapping, measure-only dataviews had no usable identity. **Fixed** by the categorical mapping: [src/categorical-table.ts](../../../src/categorical-table.ts) builds per-row `.withCategory()`/`.withMeasure()` chains, so measure-only rows carry a pure `.withMeasure()` identity.

### Gate 2 — Report-page matching is scoped by `tooltips.roles`

The optional `roles` property in the capabilities `tooltips` block "instructs what data roles are bound to the selected tooltip option in the fields well" ([SDK docs](https://learn.microsoft.com/en-us/power-bi/developer/visuals/add-tooltips)). This visual declares:

```json
"tooltips": {
    "supportedTypes": { "default": true, "canvas": true },
    "supportEnhancedTooltips": true,
    "roles": ["tooltips"]
}
```

So **only fields in the Tooltips bucket participate in report-page tooltip matching**. UAT confirmed: a measure in the content role alone never matches a tooltip page; the same measure also placed in the Tooltips role matches; with the `roles` property removed entirely, a field in the Granularity (sampling) role also matches. Deneb (same author) omits `roles` entirely, though that approach has its own issues. **Removing `roles` here is decision-pending — not committed** (see the spec addendum link below).

### Gate 3 — Hover binding is opt-in by design

`bindStandardTooltips` ([src/domain-utils.ts](../../../src/domain-utils.ts)) only ever calls `tooltipService.show()` when there is something to show:

```ts
dataElements.on('mouseover mousemove', (event, d) => {
    // ...
    if (hasGranularity || d.tooltips.length > 0) {
        tooltipService.show({
            coordinates: [event.clientX, event.clientY],
            isTouchEvent: true,
            dataItems: d.tooltips,
            identities: [d.identity]
        });
    }
});
```

A content-only visual has `hasGranularity === false` and empty `d.tooltips`, so `show()` never fires — which blocks report-page tooltips too, since they ride on the same call. Hard-coding the gate open was tested and works for #130, **but was rejected**: hover would then always produce a tooltip, and when no tooltip page is configured and `dataItems` is empty the host renders a blank panel. The Power BI host provides **no API for a visual to detect whether a report-page tooltip is configured**, so an unconditional `show()` cannot be made smart. Opt-in via role membership is the only blank-safe design.

### How users satisfy all three gates

Add at least one field — even the same content measure again — to the **Tooltips** role (or **Granularity**, if the gate-2 `roles` scoping is removed). That simultaneously opens gate 3 (`d.tooltips.length > 0`) and gives gate 2 a field to match; gate 1 is structural since the categorical migration. The host shows the report-page tooltip when one is configured and falls back to the default tooltip otherwise.

## Why This Matters

- **Diagnosis difficulty**: "tooltip doesn't show" is one symptom with three independent causes, all failing silently. Fixing one gate and re-testing still shows failure, which misleads investigators into doubting the fix (this is exactly how #130 stayed labeled an SDK limitation).
- **The no-host-API constraint** forces the opt-in design at gate 3. Proposals to "just always show the tooltip" must answer how blank panels will be avoided without host introspection — currently they cannot be.
- **Certification context**: HTML Content is a certified visual; blank tooltip panels on hover are an unacceptable UI artifact, so gate 3 is a constraint, not a preference.

## When to Apply

- Debugging any "tooltip doesn't appear" report — walk the three gates in order before assuming an SDK limitation.
- Editing the `tooltips` block in capabilities.json — re-validate the UAT matrix below afterwards.
- Evaluating feature requests for unconditional tooltips — rejected unless a host API for tooltip-page detection appears.
- UAT of tooltip behavior with dev builds — before concluding a fix "isn't applying" after a report re-open, check whether Power BI has swapped the dev visual for the AppSource version; this is the most common false negative in dev-build UAT. (auto memory [claude])
- Onboarding contributors to the tooltip subsystem — this model is not documented in the SDK and is not visible from any single file.

## Examples — UAT validation matrix

All combinations validated by the owner in Power BI Desktop (2026-06-12):

| Field configuration | Gate 1 | Gate 2 | Gate 3 | Result |
| --- | --- | --- | --- | --- |
| Measure in content role only | open (categorical) | closed (no Tooltips-role field) | closed (no granularity, empty tooltips) | No tooltip of any kind |
| Measure in content + Tooltips roles | open | open | open | Report-page tooltip works; default tooltip fallback |
| Measure in content + Granularity roles, `roles` removed from capabilities | open | open | open | Report-page tooltip works |
| Gate 3 hard-coded open (experiment only) | open | open | open (unconditional) | Works when a tooltip page is configured; blank panel when not — rejected |

## Related

- [#130 Report Page Tooltips](https://github.com/dm-p/powerbi-visuals-html-content/issues/130) (this problem) · [#132 Tooltip order](https://github.com/dm-p/powerbi-visuals-html-content/issues/132) (separate SDK limitation, same subsystem) · [#61 tooltips only show on first hover](https://github.com/dm-p/powerbi-visuals-html-content/issues/61) (historical, closed)
- Spec + UAT addendum: [docs/brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md](../../brainstorms/2026-06-12-categorical-data-mapping-selection-ids.md) — records the decision-pending status of the gate-2 capabilities change and the parked "Granularity → Context" rename
- Implementation plan: [docs/plans/2026-06-12-001-categorical-data-mapping-selection-ids-plan.md](../../plans/2026-06-12-001-categorical-data-mapping-selection-ids-plan.md)
- Neighbouring failure mode in the same code area: [dynamic-format-string-columns-missing-roles-2026-06-12.md](../runtime-errors/dynamic-format-string-columns-missing-roles-2026-06-12.md) (#159 — crash via unguarded roles access; distinct root cause)
