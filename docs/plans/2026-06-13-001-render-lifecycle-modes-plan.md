---
title: 'feat: render lifecycle modes (orchestrator + identity-keyed reconcile)'
type: feat
status: approved
date: 2026-06-13
origin: docs/brainstorms/2026-06-13-render-lifecycle-modes.md
---

# feat: render lifecycle modes (orchestrator + identity-keyed reconcile)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan unit-by-unit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Update behavior" property that selects between Rebuild (default, current behavior) and Reconcile (preserve unchanged entries so inline iframes don't reload), extracting a render orchestrator from `Visual.update()` along the way.

**Architecture:** A new `src/render-orchestrator.ts` owns the render flow as a `RenderOrchestrator` class plus pure decision functions (fingerprint, update classifier). Reconcile uses an identity-keyed d3 join that retains unchanged entry DOM. `Visual.update()` shrinks to Power BI lifecycle plumbing.

**Tech Stack:** TypeScript, powerbi-visuals-api ~5.11, d3-selection, overlayscrollbars, vitest (jsdom), pbiviz.

---

## Summary

Today [src/visual.ts:140](../../src/visual.ts#L140) runs `this.contentContainer.selectAll('*').remove()` unconditionally on every update, so every resize/cross-filter/refresh tears down and rebuilds all entry DOM — reloading inline iframes and losing their state. This plan adds a `renderMode` format property (`rebuild` default | `reconcile`), extracts the render flow into `RenderOrchestrator`, and implements an identity-keyed reconcile that preserves an entry's DOM when its selection identity and content are unchanged. In both modes, viewport-only updates (resize/view-mode) stop tearing entries down. Six units: property plumbing → pure decisions → reconcile binding helper → orchestrator class → wire into visual → verification gate. Default Rebuild keeps existing reports non-breaking; zero sanitizer-surface churn throughout.

---

## Problem Frame

The unconditional content wipe ([visual.ts:140](../../src/visual.ts#L140)) defeats the keyed-join shape already present in [bindVisualDataToDom](../../src/domain-utils.ts#L444), and [resolveHtmlGroupElement](../../src/domain-utils.ts#L289) rebuilds each entry's inner DOM on every call. The user-visible cost is inline iframes reloading on any update. Full rationale, goals, and non-goals: [origin brainstorm](../brainstorms/2026-06-13-render-lifecycle-modes.md).

---

## Requirements

- R1. A `renderMode` enumeration property (`rebuild` | `reconcile`), default `rebuild`, in the `contentFormatting` object and the Behavior settings group, localized. *(origin: Goal 1, Section 3)*
- R2. Reconcile preserves an entry's DOM node when its `identity.getKey()` persists and its `content` is unchanged; changed entries re-render; added/removed entries enter/exit. *(origin: Goal 2, Section 2)*
- R3. In both modes, viewport-only updates (Resize/ResizeEnd/ViewMode/Style, no Data bit, unchanged fingerprint) do not tear down or re-render entries. *(origin: Goal 3, Section 1)*
- R4. A `RenderOrchestrator` owns the render flow; `Visual.update()` keeps only lifecycle plumbing and the error envelope. *(origin: Goal 4, Section 1)*
- R5. A settings change forces a full rebuild even in Reconcile (fingerprint guard). *(origin: Section 2, Section 4)*
- R6. State-kind transitions (populated ↔ no-data ↔ raw) force a clean container reset; reconcile applies only within populated-rendered. *(origin: Section 4)*
- R7. Zero sanitizer-surface churn: `docs/sanitization-rules.md` and `test-uat/*.csv` untouched. *(origin: Goal 5)*
- R8. All three editions package; existing unit + integration suites stay green. *(origin: Testing)*

---

## Scope Boundaries

- No third "skip-if-identical" mode (subsumed by reconcile).
- No vanilla-JS rewrite / d3 removal (d3-selection stays via interactivityutils).
- No templating (WP-C), no highlight/#153 work.
- No new Playwright update-cycle harness — real-browser iframe-no-reload is manual UAT (see Key Technical Decisions).
- No change to the sanitizer, `bindVisualDataToDom`'s existing signature, or `resolveHtmlGroupElement`'s behavior.

---

## Context & Research

### Relevant Code and Patterns

- [src/visual.ts:126-233](../../src/visual.ts#L126-L233) — `update()`; lines 139-222 (inside `try`) become the orchestrator body. Line 140 is the unconditional wipe to relocate into the rebuild branch. Line 144 shows the canonical Data-bit test: `powerbi.VisualUpdateType.Data === (options.type & powerbi.VisualUpdateType.Data)`.
- [src/domain-utils.ts:444-461](../../src/domain-utils.ts#L444-L461) — `bindVisualDataToDom(container, data, hasSelection)`: `.data(data).join(enter => …)`, returns merged selection. Unchanged by this plan; rebuild mode keeps using it after an explicit wipe.
- [src/domain-utils.ts:289-308](../../src/domain-utils.ts#L289-L308) — `resolveHtmlGroupElement(dataElements, format, allowHyperlinks)`: destructive per element. Reconcile calls it only on the enter-plus-changed subset.
- [src/domain-utils.ts:315-321](../../src/domain-utils.ts#L315-L321) — `resolveScrollableContent(element)`: re-invokes `OverlayScrollbars(element, …)` each update. Plan changes it to return the instance for reuse.
- [src/domain-utils.ts:470-472](../../src/domain-utils.ts#L470-L472) — `shouldDimPoint(hasSelection, isSelected)`, reused by the reconcile helper for dim-class upkeep.
- [test/domain-utils.test.ts:108-314](../../test/domain-utils.test.ts#L108-L314) — the jsdom+d3 pattern for binding tests (`new JSDOM`, `select(dom.window.document).select('#container')`). New binding tests mirror this exactly.
- [src/visual-settings.ts:56-94](../../src/visual-settings.ts#L56-L94) — `ContentFormattingCardBehavior`; `format` `AutoDropdown` at lines 61-66 is the exact template for `renderMode`.
- [capabilities.json:37-52](../../capabilities.json#L37-L52) — the `format` enumeration is the exact template for `renderMode`.
- [src/visual-constants.ts:185-205](../../src/visual-constants.ts#L185-L205) — `contentFormatting` defaults block; add `renderMode`.
- [src/types.ts](../../src/types.ts) — `RenderFormat`; add `RenderMode` beside it.

### Key API facts

- `VisualUpdateType` bit values: `Data = 2`, `Resize = 4`, `ViewMode = 8`, `Style = 16`, `ResizeEnd = 32`, `All = 62`. **`options.type` is a bitmask and can carry undocumented high bits beyond the published enum** — values of `126` and `254` are observed in the wild ([microsoft/PowerBI-visuals-tools#422](https://github.com/microsoft/PowerBI-visuals-tools/issues/422), filed by this repo's owner; `126 = All | 64`, `254 = All | 128`). Both contain the Data bit (`126 & 2 === 2`, `254 & 2 === 2`). **Never compare `options.type` by equality; always test specific bits with `&`.** The existing [visual.ts:144](../../src/visual.ts#L144) Data check already does this; the classifier must too.
- `ISelectionId.getKey(): string` is stable per data point across updates (used for selection persistence in WP-A).
- d3 `selection.data(data, keyFn)` keys the join; `.enter()`, `.exit()`, and the update selection are addressable; `selection.property(name, value)` sets `node[name]` (used for the content stash, no DOM attribute).
- vitest loads `overlayscrollbars` fine in jsdom (domain-utils.test.ts already imports the module transitively); the sanitize-pipeline split was for the Playwright harness, not vitest.

### Institutional Learnings

- `docs/solutions/design-patterns/report-page-tooltip-three-gate-measure-only-2026-06-12.md` and `docs/solutions/performance-issues/mapdataview-per-row-formatters-quadratic-selection-2026-06-12.md` document adjacent render/identity behavior; no existing solution doc covers the render lifecycle.

---

## Key Technical Decisions

- **iframe-survival proof = jsdom node-identity retention, not a Playwright reload test.** Retaining the *same DOM element reference* across a reconcile is exactly the condition under which a browser does not reload an iframe. jsdom asserts element identity cheaply and deterministically; a real-browser "iframe network did not re-fire" test would require a new update-cycle Playwright harness (the current one is sanitizer/CSP payload-driven) — disproportionate. Real-browser no-reload is covered by manual UAT.
- **Rebuild parity is preserved by relocating the wipe, not keeping it global.** The unconditional [visual.ts:140](../../src/visual.ts#L140) wipe moves into the orchestrator's rebuild branch, gated on entry-affecting. Viewport-only updates skip it (R3); rebuild-on-entry-affecting still fully rebuilds (parity).
- **`renderMode` is in the fingerprint** so a runtime mode switch forces one clean rebuild baseline; reconcile never inherits un-stashed nodes (R5 corollary).
- **Both render branches stamp `__renderedContent`** so reconcile always has a content baseline after any rebuild (avoids a one-time full re-render on the first reconcile pass).
- **Two binding functions, not one.** Keep `bindVisualDataToDom` untouched for rebuild (and its tests); add `reconcileVisualDataToDom` for the keyed path. Lower risk than overloading the existing function.
- **The fingerprint is the authoritative settings-change signal, not the update type.** Formatting/object property changes are not reliably tagged with a specific `VisualUpdateType` bit, and the type field carries undocumented high bits (126/254 — see API facts and [#422](https://github.com/microsoft/PowerBI-visuals-tools/issues/422)). So the classifier never tries to infer "settings changed" from `options.type`; it OR-s in `fingerprintChanged`, computed by diffing the parse-affecting settings every update. A bitwise Data check handles data updates; the fingerprint handles everything formatting. Non-parse-affecting settings (cross-filter transparency) are deliberately excluded from the fingerprint because `resolveContainer`/`resolveStyling` re-runs every update and applies them regardless of the render branch.

---

## Open Questions

### Resolved During Planning

- *Does any existing test drive full `Visual.update()`?* No — `CustomVisualBuilder` is unused; render path is unit-tested at the domain-utils level. So the orchestrator gets its own jsdom tests; parity is guarded by the existing domain-utils + sanitizer suites staying green.
- *Can vitest load the orchestrator (which imports overlayscrollbars)?* Yes — domain-utils.test.ts already exercises that dependency in jsdom.

### Deferred to Implementation

- *OverlayScrollbars scroll-position preservation across reconcile.* The plan reuses the instance via `.update()` (U4). Verify empirically in UAT that scroll position survives; if `.update()` is insufficient, fall back to caching scroll offset and restoring it. Does not block the iframe-survival goal.
- *Exact `renderMode` member labels.* Locked in the spec: "Update behavior" / "Rebuild content" / "Preserve unchanged content". If localization review prefers different wording, change only the resjson values.

---

## High-Level Technical Design

> *Directional guidance for review. Signatures are binding; exact bodies illustrative.*

### Pure decisions (`src/render-orchestrator.ts`)

```ts
import powerbi from 'powerbi-visuals-api';
import VisualUpdateType = powerbi.VisualUpdateType;
import { VisualFormattingSettingsModel } from './visual-settings';

/** Stable string of all parse/render-affecting settings. */
export function computeRenderFingerprint(
    settings: VisualFormattingSettingsModel
): string {
    const b = settings.contentFormatting.contentFormattingCardBehavior;
    const body = settings.contentFormatting.contentFormattingCardDefaultBodyStyling;
    return JSON.stringify([
        b.format.value,
        b.hyperlinks.value,
        b.showRawHtml.value,
        b.userSelect.value,
        b.renderMode.value,
        settings.stylesheet.stylesheetCardMain.stylesheet.value,
        body.fontFamily.value,
        body.fontSize.value,
        body.fontColour.value.value,
        body.align.value,
        body.overrideInlineStyling.value
    ]);
}

/** True when entries must be re-evaluated; false = viewport-only. */
export function isEntryAffectingUpdate(
    updateType: number,
    firstRender: boolean,
    fingerprintChanged: boolean
): boolean {
    const hasDataBit =
        (updateType & VisualUpdateType.Data) === VisualUpdateType.Data;
    return firstRender || hasDataBit || fingerprintChanged;
}
```

### Reconcile binding helper (`src/domain-utils.ts`)

```ts
export interface ReconcileResult {
    merged: Selection<HTMLDivElement, IHtmlEntry, any, any>;
    toRender: Selection<HTMLDivElement, IHtmlEntry, any, any>;
}

export function reconcileVisualDataToDom(
    container: Selection<any, any, any, any>,
    data: IHtmlEntry[],
    hasSelection: boolean
): ReconcileResult {
    const { entryClassSelector, unselectedClassSelector } = VisualConstants.dom;
    const joined = container
        .selectAll<HTMLDivElement, IHtmlEntry>(`.${entryClassSelector}`)
        .data(data, (d: IHtmlEntry) => (d.identity as ISelectionId).getKey());
    joined.exit().remove();
    const entered = joined
        .enter()
        .append('div')
        .classed(entryClassSelector, true);
    const merged = entered.merge(joined as any);
    merged.classed(unselectedClassSelector, (d) =>
        shouldDimPoint(hasSelection, d.selected)
    );
    merged.order();
    const changed = (joined as any).filter(function (
        this: HTMLDivElement & { __renderedContent?: string },
        d: IHtmlEntry
    ) {
        return this.__renderedContent !== d.content;
    });
    const toRender = entered.merge(changed);
    toRender.property('__renderedContent', (d: IHtmlEntry) => d.content);
    return { merged, toRender };
}
```

### Orchestrator dispatch (`RenderOrchestrator.render`)

```text
render(options, viewModelHandler, settings, host):
  fingerprint = computeRenderFingerprint(settings)
  changed = fingerprint !== this.lastFingerprint
  entryAffecting = isEntryAffectingUpdate(options.type, this.firstRender, changed)
  this.lastFingerprint = fingerprint

  resolveStyling(...)                       // every update, both paths
  if entryAffecting:
     if viewModel.isEmpty OR raw-mode OR kindChanged: clean reset + status/raw path
     else if mode === reconcile AND !changed AND !firstRender:
        { merged, toRender } = reconcileVisualDataToDom(content, entries, hasSelection)
        resolveHtmlGroupElement(toRender, format, hyperlinks)
     else:  // rebuild (or reconcile w/ changed fingerprint, or first render)
        content.selectAll('*').remove()
        merged = bindVisualDataToDom(content, entries, hasSelection)
        resolveHtmlGroupElement(merged, format, hyperlinks)
        merged.property('__renderedContent', d => d.content)   // baseline for later reconcile
     resolveForRawHtml(...) ; bind interactivity ; resolveHover(merged) ; this.lastKind = kind
  resolveHyperlinkHandling(...)             // every update
  this.scrollbars = resolveScrollableContent(container, this.scrollbars)  // reuse instance
  this.firstRender = false
```

---

## Implementation Units

- [ ] U1. **`renderMode` property plumbing (additive, default rebuild)**

**Goal:** Add the `RenderMode` type, capabilities enumeration, default constant, settings slice, and localization. Nothing consumes it yet.

**Requirements:** R1.

**Files:**
- Modify: `src/types.ts`
- Modify: `capabilities.json` (`contentFormatting.properties`)
- Modify: `src/visual-constants.ts` (`contentFormatting` defaults)
- Modify: `src/visual-settings.ts` (`ContentFormattingCardBehavior`)
- Modify: `stringResources/en-US/resources.resjson`
- Test: `test/visual-settings.test.ts`

- [ ] **Step 1: Write the failing test** (append to `test/visual-settings.test.ts`)

```ts
import { VisualConstants } from '../src/visual-constants';
// inside the existing ContentFormattingCardBehavior describe block:
it('exposes renderMode defaulting to rebuild', () => {
    const settings = new VisualFormattingSettingsModel();
    const behavior =
        settings.contentFormatting.contentFormattingCardBehavior;
    expect(behavior.renderMode).toBeDefined();
    expect(behavior.renderMode.value).toBe('rebuild');
    expect(behavior.renderMode.value).toBe(
        VisualConstants.contentFormatting.renderMode
    );
    expect(behavior.slices).toContain(behavior.renderMode);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/visual-settings.test.ts -t renderMode`
Expected: FAIL — `behavior.renderMode` is undefined.

- [ ] **Step 3: Add the type** — `src/types.ts`

```ts
// Valid renderer types for content
export type RenderFormat = 'html' | 'markdown';

// Render lifecycle: full rebuild each update, or reconcile unchanged entries.
export type RenderMode = 'rebuild' | 'reconcile';
```

- [ ] **Step 4: Add the default** — `src/visual-constants.ts`, in the `contentFormatting` block (after `format`), and import `RenderMode`

```ts
// at top with the existing RenderFormat import:
import { RenderFormat, RenderMode } from './types';
// inside contentFormatting: {
        format: <RenderFormat>'html',
        renderMode: <RenderMode>'rebuild',
```

- [ ] **Step 5: Add the capabilities enumeration** — `capabilities.json`, inside `contentFormatting.properties`, after `format`

```json
"renderMode": {
    "type": {
        "enumeration": [
            {
                "displayNameKey": "Enum_RenderMode_Rebuild",
                "displayName": "Rebuild content",
                "value": "rebuild"
            },
            {
                "displayNameKey": "Enum_RenderMode_Reconcile",
                "displayName": "Preserve unchanged content",
                "value": "reconcile"
            }
        ]
    }
},
```

- [ ] **Step 6: Add the settings slice** — `src/visual-settings.ts`, in `ContentFormattingCardBehavior` (after `format`, and add to `slices`)

```ts
// import at top of file alongside other imports:
// (no new import needed; AutoDropdown reads members from capabilities)
renderMode = new formattingSettings.AutoDropdown({
    name: 'renderMode',
    displayNameKey: 'Objects_ContentFormatting_RenderMode',
    descriptionKey: 'Objects_ContentFormatting_RenderMode_Description',
    value: VisualConstants.contentFormatting.renderMode
});
// add to slices array, after this.format:
slices: Array<FormattingSettingsSlice> = [
    this.format,
    this.renderMode,
    this.showRawHtml,
    this.hyperlinks,
    this.userSelect
];
```

- [ ] **Step 7: Add localization** — `stringResources/en-US/resources.resjson` (next to the `Objects_ContentFormatting_Format` keys and the format enum keys)

```json
"Objects_ContentFormatting_RenderMode": "Update behavior",
"Objects_ContentFormatting_RenderMode_Description": "Controls how the visual updates the DOM. Rebuild content redraws everything on each update. Preserve unchanged content keeps entries whose value has not changed, so embedded content such as iframes does not reload.",
"Enum_RenderMode_Rebuild": "Rebuild content",
"Enum_RenderMode_Reconcile": "Preserve unchanged content",
```

- [ ] **Step 8: Run tests + lint + format**

Run: `npx vitest run test/visual-settings.test.ts -t renderMode` → PASS
Run: `npm test` → all green
Run: `npm run eslint`
Run: `npx prettier --config .prettierrc --check src/visual-settings.ts src/visual-constants.ts src/types.ts` (format with `--write` if needed)

- [ ] **Step 9: Commit**

```bash
git add src/types.ts capabilities.json src/visual-constants.ts src/visual-settings.ts stringResources/en-US/resources.resjson test/visual-settings.test.ts
git commit -m "feat: add renderMode property (rebuild default, reconcile opt-in)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Stage files explicitly — the working tree has unrelated `test-uat/*.tmdl` WIP; never `git add -A`.)

---

- [ ] U2. **Pure decision functions: fingerprint + update classifier**

**Goal:** Create `src/render-orchestrator.ts` exporting `computeRenderFingerprint` and `isEntryAffectingUpdate` (per High-Level Technical Design), with exhaustive unit tests. No wiring yet.

**Requirements:** R3 (classifier), R5 (fingerprint).

**Files:**
- Create: `src/render-orchestrator.ts`
- Create: `test/render-orchestrator.test.ts`

- [ ] **Step 1: Write failing tests** — `test/render-orchestrator.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import powerbi from 'powerbi-visuals-api';
import {
    computeRenderFingerprint,
    isEntryAffectingUpdate
} from '../src/render-orchestrator';

const VUT = powerbi.VisualUpdateType;

const settings = (over: Record<string, unknown> = {}) =>
    ({
        contentFormatting: {
            contentFormattingCardBehavior: {
                format: { value: over.format ?? 'html' },
                hyperlinks: { value: over.hyperlinks ?? false },
                showRawHtml: { value: over.showRawHtml ?? false },
                userSelect: { value: false },
                renderMode: { value: over.renderMode ?? 'rebuild' }
            },
            contentFormattingCardDefaultBodyStyling: {
                fontFamily: { value: 'Arial' },
                fontSize: { value: 11 },
                fontColour: { value: { value: '#000' } },
                align: { value: 'left' },
                overrideInlineStyling: { value: false }
            }
        },
        stylesheet: { stylesheetCardMain: { stylesheet: { value: '' } } }
    }) as any;

describe('computeRenderFingerprint', () => {
    it('is stable for identical settings', () => {
        expect(computeRenderFingerprint(settings())).toBe(
            computeRenderFingerprint(settings())
        );
    });
    it('changes when a parse-affecting property changes', () => {
        expect(computeRenderFingerprint(settings({ format: 'markdown' }))).not.toBe(
            computeRenderFingerprint(settings())
        );
    });
    it('changes when renderMode changes (forces rebuild baseline)', () => {
        expect(
            computeRenderFingerprint(settings({ renderMode: 'reconcile' }))
        ).not.toBe(computeRenderFingerprint(settings()));
    });
});

describe('isEntryAffectingUpdate', () => {
    it('is true on first render regardless of type', () => {
        expect(isEntryAffectingUpdate(VUT.Resize, true, false)).toBe(true);
    });
    it('is true when the Data bit is set', () => {
        expect(isEntryAffectingUpdate(VUT.Data, false, false)).toBe(true);
        expect(
            isEntryAffectingUpdate(VUT.Data | VUT.Resize, false, false)
        ).toBe(true);
    });
    it('is true when the fingerprint changed without a Data bit', () => {
        expect(isEntryAffectingUpdate(VUT.Resize, false, true)).toBe(true);
    });
    it('is false for viewport-only updates (resize / view-mode)', () => {
        expect(isEntryAffectingUpdate(VUT.Resize, false, false)).toBe(false);
        expect(isEntryAffectingUpdate(VUT.ViewMode, false, false)).toBe(false);
        expect(isEntryAffectingUpdate(VUT.ResizeEnd, false, false)).toBe(false);
    });
    it('treats undocumented high-bit types (126, 254) as entry-affecting via the Data bit (#422)', () => {
        // 126 = All | 64, 254 = All | 128; both contain Data (2). Equality
        // checks would miss these — only bitwise AND is correct.
        expect(isEntryAffectingUpdate(126, false, false)).toBe(true);
        expect(isEntryAffectingUpdate(254, false, false)).toBe(true);
    });
    it('treats a high-bit-decorated viewport update (no Data bit) as viewport-only', () => {
        // Resize (4) with an undocumented high bit (64) set, but no Data bit.
        expect(isEntryAffectingUpdate(VUT.Resize | 64, false, false)).toBe(
            false
        );
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/render-orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/render-orchestrator.ts` (the two exported functions from High-Level Technical Design's "Pure decisions" block).

- [ ] **Step 4: Run to green**

Run: `npx vitest run test/render-orchestrator.test.ts` → PASS
Run: `npm run eslint` ; `npx prettier --config .prettierrc --check src/render-orchestrator.ts test/render-orchestrator.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/render-orchestrator.ts test/render-orchestrator.test.ts
git commit -m "feat: add render fingerprint and update classifier

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

- [ ] U3. **Reconcile binding helper with content stash**

**Goal:** Add `reconcileVisualDataToDom` + `ReconcileResult` to `src/domain-utils.ts` (per High-Level Technical Design), proving node-identity retention in jsdom. `bindVisualDataToDom` is untouched.

**Requirements:** R2.

**Files:**
- Modify: `src/domain-utils.ts`
- Test: `test/domain-utils.test.ts`

- [ ] **Step 1: Write failing tests** — append a describe block to `test/domain-utils.test.ts`, mirroring the existing jsdom pattern (lines 108-160)

```ts
import { reconcileVisualDataToDom } from '../src/domain-utils';

const entry = (key: string, content: string): any => ({
    content,
    identity: { getKey: () => key, equals: () => false },
    selected: false,
    tooltips: []
});

describe('reconcileVisualDataToDom', () => {
    const setup = () => {
        const dom = new JSDOM(
            '<!DOCTYPE html><body><div id="container"></div></body>'
        );
        const container = select(dom.window.document).select('#container');
        return container;
    };

    it('retains the same DOM node for an unchanged entry across updates', () => {
        const container = setup();
        reconcileVisualDataToDom(container, [entry('a', '<p>1</p>')], false);
        const firstNode = container.select('.htmlViewerEntry').node();
        // second update, same key + same content
        const { toRender } = reconcileVisualDataToDom(
            container,
            [entry('a', '<p>1</p>')],
            false
        );
        const secondNode = container.select('.htmlViewerEntry').node();
        expect(secondNode).toBe(firstNode); // same element reference = iframe survives
        expect(toRender.size()).toBe(0); // nothing to re-render
    });

    it('marks a changed entry for re-render but keeps its node', () => {
        const container = setup();
        reconcileVisualDataToDom(container, [entry('a', '<p>1</p>')], false);
        const firstNode = container.select('.htmlViewerEntry').node();
        const { toRender } = reconcileVisualDataToDom(
            container,
            [entry('a', '<p>2</p>')],
            false
        );
        expect(container.select('.htmlViewerEntry').node()).toBe(firstNode);
        expect(toRender.size()).toBe(1);
    });

    it('enters new entries and exits removed ones by identity key', () => {
        const container = setup();
        reconcileVisualDataToDom(
            container,
            [entry('a', 'A'), entry('b', 'B')],
            false
        );
        const { merged, toRender } = reconcileVisualDataToDom(
            container,
            [entry('a', 'A'), entry('c', 'C')],
            false
        );
        expect(merged.size()).toBe(2); // a retained, c entered, b exited
        expect(toRender.size()).toBe(1); // only c needs render (a unchanged)
    });

    it('toRender includes all entries on first bind (no stash yet)', () => {
        const container = setup();
        const { toRender } = reconcileVisualDataToDom(
            container,
            [entry('a', 'A'), entry('b', 'B')],
            false
        );
        expect(toRender.size()).toBe(2);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/domain-utils.test.ts -t reconcileVisualDataToDom`
Expected: FAIL — `reconcileVisualDataToDom` is not exported.

- [ ] **Step 3: Implement** — add `ReconcileResult` + `reconcileVisualDataToDom` to `src/domain-utils.ts` (exact body in High-Level Technical Design). Ensure `ISelectionId` is imported: `import ISelectionId = powerbi.visuals.ISelectionId;` (add the `powerbi` import if absent in this file).

- [ ] **Step 4: Run to green**

Run: `npx vitest run test/domain-utils.test.ts -t reconcileVisualDataToDom` → PASS
Run: `npm test` → all green
Run: `npm run eslint` ; `npx prettier --config .prettierrc --check src/domain-utils.ts test/domain-utils.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/domain-utils.ts test/domain-utils.test.ts
git commit -m "feat: add identity-keyed reconcile binding helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

- [ ] U4. **RenderOrchestrator class (classify → dispatch)**

**Goal:** Add the `RenderOrchestrator` class to `src/render-orchestrator.ts`, owning container references and the render dispatch (viewport-only / rebuild / reconcile), state-kind tracking, and scrollbar-instance reuse. Change `resolveScrollableContent` to return the instance.

**Requirements:** R3, R4, R5, R6.

**Files:**
- Modify: `src/render-orchestrator.ts`
- Modify: `src/domain-utils.ts` (`resolveScrollableContent` returns the instance)
- Test: `test/render-orchestrator.test.ts`

- [ ] **Step 1: Change `resolveScrollableContent` to return the instance** — `src/domain-utils.ts`

```ts
export function resolveScrollableContent(
    element: HTMLElement,
    existing?: OverlayScrollbars
): OverlayScrollbars {
    if (existing) {
        existing.update();
        return existing;
    }
    return OverlayScrollbars(element, {
        scrollbars: { clickScrolling: true }
    });
}
```

(Update the existing call site in `visual.ts` is handled in U5; the one existing usage there compiles with the optional second arg.)

- [ ] **Step 2: Write failing tests** — `test/render-orchestrator.test.ts`. Use a fake container + spies for the render steps. The orchestrator takes injected DOM-step dependencies so dispatch is testable without a real host. **Update the file's top import to add `vi`** (it was `import { describe, it, expect } from 'vitest';` in U2 — change to `import { describe, it, expect, vi } from 'vitest';`).

```ts
import { RenderOrchestrator } from '../src/render-orchestrator';

const VUT = powerbi.VisualUpdateType;

// Minimal fakes; the orchestrator's render steps are injected so we can
// assert which branch ran without a real Power BI host or live DOM.
const makeDeps = () => ({
    rebuild: vi.fn(),
    reconcile: vi.fn(),
    renderEmptyOrRaw: vi.fn(),
    bindInteractivity: vi.fn(),
    resolveContainer: vi.fn() // styling + hyperlinks + scroll
});

const populatedViewModel = {
    isValid: true,
    isEmpty: false,
    htmlEntries: [{ content: 'A', identity: { getKey: () => 'a' } }]
} as any;

describe('RenderOrchestrator dispatch', () => {
    it('viewport-only update does not touch entries', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        o.render(
            { type: VUT.Data } as any,
            populatedViewModel,
            settings(),
            {} as any
        ); // first render seeds state
        deps.rebuild.mockClear();
        deps.reconcile.mockClear();
        o.render(
            { type: VUT.Resize } as any,
            populatedViewModel,
            settings(),
            {} as any
        );
        expect(deps.rebuild).not.toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
        expect(deps.resolveContainer).toHaveBeenCalled(); // cheap resolvers still run
    });

    it('entry-affecting update in rebuild mode rebuilds', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        o.render(
            { type: VUT.Data } as any,
            populatedViewModel,
            settings({ renderMode: 'rebuild' }),
            {} as any
        );
        expect(deps.rebuild).toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
    });

    it('reconcile mode with unchanged fingerprint reconciles (not first render)', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        const s = settings({ renderMode: 'reconcile' });
        o.render({ type: VUT.Data } as any, populatedViewModel, s, {} as any); // first = rebuild baseline
        deps.rebuild.mockClear();
        o.render({ type: VUT.Data } as any, populatedViewModel, s, {} as any);
        expect(deps.reconcile).toHaveBeenCalled();
        expect(deps.rebuild).not.toHaveBeenCalled();
    });

    it('reconcile mode rebuilds when the fingerprint changed', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        o.render(
            { type: VUT.Data } as any,
            populatedViewModel,
            settings({ renderMode: 'reconcile' }),
            {} as any
        );
        deps.rebuild.mockClear();
        deps.reconcile.mockClear();
        o.render(
            { type: VUT.Data } as any,
            populatedViewModel,
            settings({ renderMode: 'reconcile', format: 'markdown' }),
            {} as any
        );
        expect(deps.rebuild).toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
    });

    it('empty view model takes the empty path, never reconcile', () => {
        const deps = makeDeps();
        const o = new RenderOrchestrator(deps);
        o.render(
            { type: VUT.Data } as any,
            { isValid: true, isEmpty: true, htmlEntries: [] } as any,
            settings({ renderMode: 'reconcile' }),
            {} as any
        );
        expect(deps.renderEmptyOrRaw).toHaveBeenCalled();
        expect(deps.reconcile).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/render-orchestrator.test.ts -t dispatch`
Expected: FAIL — `RenderOrchestrator` not exported.

- [ ] **Step 4: Implement `RenderOrchestrator`** — `src/render-orchestrator.ts`. The class accepts injected step functions (`rebuild`, `reconcile`, `renderEmptyOrRaw`, `bindInteractivity`, `resolveContainer`) for testability; the production wiring (U5) passes real implementations bound to the visual's containers. Dispatch follows the High-Level Technical Design pseudocode: compute fingerprint, classify, run `resolveContainer` always; on entry-affecting choose empty/raw vs rebuild vs reconcile; track `lastFingerprint`, `lastKind`, `firstRender`.

```ts
export interface RenderSteps {
    rebuild: (vm: IViewModel, settings: VisualFormattingSettingsModel) => void;
    reconcile: (vm: IViewModel, settings: VisualFormattingSettingsModel) => void;
    renderEmptyOrRaw: (vm: IViewModel, settings: VisualFormattingSettingsModel) => void;
    bindInteractivity: (vm: IViewModel) => void;
    resolveContainer: (settings: VisualFormattingSettingsModel) => void;
}

type RenderKind = 'populated' | 'empty-or-raw';

export class RenderOrchestrator {
    private firstRender = true;
    private lastFingerprint = '';
    private lastKind: RenderKind | undefined;
    constructor(private steps: RenderSteps) {}

    render(
        options: powerbi.extensibility.visual.VisualUpdateOptions,
        viewModel: IViewModel,
        settings: VisualFormattingSettingsModel,
        _host: unknown
    ): void {
        const fingerprint = computeRenderFingerprint(settings);
        const fingerprintChanged = fingerprint !== this.lastFingerprint;
        const entryAffecting = isEntryAffectingUpdate(
            options.type,
            this.firstRender,
            fingerprintChanged
        );
        this.steps.resolveContainer(settings);
        if (entryAffecting) {
            const raw =
                settings.contentFormatting.contentFormattingCardBehavior
                    .showRawHtml.value;
            const kind: RenderKind =
                viewModel.isEmpty || raw ? 'empty-or-raw' : 'populated';
            const kindChanged = kind !== this.lastKind;
            const mode =
                settings.contentFormatting.contentFormattingCardBehavior
                    .renderMode.value;
            if (kind === 'empty-or-raw') {
                this.steps.renderEmptyOrRaw(viewModel, settings);
            } else if (
                mode === 'reconcile' &&
                !fingerprintChanged &&
                !this.firstRender &&
                !kindChanged
            ) {
                this.steps.reconcile(viewModel, settings);
                this.steps.bindInteractivity(viewModel);
            } else {
                this.steps.rebuild(viewModel, settings);
                this.steps.bindInteractivity(viewModel);
            }
            this.lastKind = kind;
        }
        this.lastFingerprint = fingerprint;
        this.firstRender = false;
    }
}
```

- [ ] **Step 5: Run to green + format**

Run: `npx vitest run test/render-orchestrator.test.ts` → PASS
Run: `npm test` → green (resolveScrollableContent signature change must not break domain-utils tests; the second arg is optional)
Run: `npm run eslint` ; `npx prettier --config .prettierrc --check src/render-orchestrator.ts src/domain-utils.ts test/render-orchestrator.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/render-orchestrator.ts src/domain-utils.ts test/render-orchestrator.test.ts
git commit -m "feat: add RenderOrchestrator dispatch (viewport/rebuild/reconcile)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

- [ ] U5. **Wire the orchestrator into `Visual.update()`**

**Goal:** Construct a `RenderOrchestrator` in the visual, move the render body out of `update()`, and pass real step implementations bound to the visual's containers. `update()` keeps settings parse, lifecycle events, landing page, data-mapping gate, and the error envelope.

**Requirements:** R3, R4, R6, R7.

**Files:**
- Modify: `src/visual.ts`

**Approach:**
- In the constructor, build the orchestrator with concrete steps. The step closures call the existing functions exactly as `update()` does today, with two changes: the **rebuild** step performs the `contentContainer.selectAll('*').remove()` wipe (relocated from line 140) then `bindVisualDataToDom` + `resolveHtmlGroupElement` + stamps `__renderedContent`; the **reconcile** step calls `reconcileVisualDataToDom` + `resolveHtmlGroupElement(toRender, …)`. `resolveContainer` runs `resolveStyling`, `resolveHyperlinkHandling`, and `resolveScrollableContent(node, this.scrollbars)` (caching the returned instance). `renderEmptyOrRaw` runs the existing `updateStatus(...)` empty path and `resolveForRawHtml`.
- Delete the unconditional `this.contentContainer.selectAll('*').remove()` at line 140.
- `update()` body becomes:

```ts
public update(options: VisualUpdateOptions) {
    const { viewModel } = this.viewModelHandler;
    this.formattingSettings =
        this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            options.dataViews?.[0]
        );
    try {
        this.events.renderingStarted(options);
        if (
            powerbi.VisualUpdateType.Data ===
            (options.type & powerbi.VisualUpdateType.Data)
        ) {
            this.viewModelHandler.validateDataView(options.dataViews);
            viewModel.isValid &&
                this.viewModelHandler.mapDataView(
                    options.dataViews,
                    this.formattingSettings,
                    this.host
                );
        }
        this.formattingSettings.handlePropertyVisibility(viewModel);
        this.landingPageHandler.handleLandingPage(
            viewModel.isValid,
            this.host
        );
        if (!viewModel.isValid) {
            throw new Error('View model mapping error');
        }
        this.orchestrator.render(
            options,
            viewModel,
            this.formattingSettings,
            this.host
        );
        this.events.renderingFinished(options);
    } catch (e) {
        this.events.renderingFailed(options, e);
        this.contentContainer.selectAll('*').remove();
        this.updateStatus();
    }
}
```

**Execution note:** This unit has no new pure-unit test (it is integration wiring). Coverage comes from the existing domain-utils + sanitizer + settings suites staying green, plus the manual smoke below. Do NOT add a brittle full-`update()` test; the orchestrator dispatch is already unit-tested in U4.

**Verification:**
- Run: `npm test` → all green (no regressions in domain-utils/sanitizer/settings).
- Run: `npm run eslint` ; `npx prettier --config .prettierrc --check src/visual.ts`
- Manual smoke (`npm start`, attach in Power BI Desktop): rebuild mode renders identically to 2.0.0; resize no longer reloads an inline iframe (R3); switch to reconcile, refresh data with unchanged iframe URL → iframe does not reload; change a measure value → that entry re-renders; toggle Show Raw HTML → textarea path works; empty↔populated transitions render correctly. **Confirm the live visual is the dev build, not the AppSource swap, before trusting a negative result.**
- Confirm `git status` shows no `test-uat/*.csv` or `docs/sanitization-rules.md` changes (R7).

- [ ] **Commit**

```bash
git add src/visual.ts
git commit -m "refactor: drive rendering through RenderOrchestrator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

- [ ] U6. **Verification gate + docs**

**Goal:** Prove zero sanitizer churn and all-edition packaging; document the new module and release note.

**Requirements:** R7, R8.

**Files:**
- Modify: `AGENTS.md` (repo layout: add `render-orchestrator.ts` under `src/`)

**Approach & checks:**
1. `npm run test:all` — unit + Playwright integration + `docs:check`. Expected green, **no** `docs:check` drift.
2. `git status --porcelain` — confirm `test-uat/*.csv` and `docs/sanitization-rules.md` untouched (only the developer's pre-existing `expressions.tmdl` / `.github/hooks/` may appear).
3. `npm run package`, `npm run package-standard`, `npm run package-standalone` — all build; restore patched configs after the edition builds with `git checkout -- pbiviz.json capabilities.json config/visual.json` (the package-custom script re-serializes JSON whitespace on revert — known, pre-existing).
4. `npm run cert-check` — green.
5. Add to `AGENTS.md` repo layout, under `src/`, after `view-model.ts`:
   `  render-orchestrator.ts # update classification + rebuild/reconcile render dispatch`

**Verification:** all commands exit 0; only `AGENTS.md` shows in the diff.

- [ ] **Commit**

```bash
git add AGENTS.md
git commit -m "docs: add render-orchestrator to repo layout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## System-Wide Impact

- **Default Rebuild = current behavior**, except viewport-only updates no longer tear down entries (R3) — a deliberate, accepted change for existing reports (release-notes item).
- **New `renderMode` property** defaults so saved reports are unaffected until an author opts into reconcile.
- **`resolveScrollableContent` signature** gains an optional `existing` parameter; the only caller is the orchestrator. No other module affected.
- **`bindVisualDataToDom` and the sanitizer are untouched** — zero sanitizer-surface churn; `docs:check` and the UAT corpus stay green without regeneration.
- All three editions inherit `renderMode` from shared capabilities.json.

## Risks & Dependencies

- **Scroll-position preservation across reconcile** depends on OverlayScrollbars `.update()` retaining offset — verify in UAT; fallback is caching/restoring scroll offset in the orchestrator. Does not block iframe survival.
- **Identity-key uniqueness** — reconcile keys on `identity.getKey()`; WP-A guarantees per-row uniqueness, and Rebuild mode is the always-correct escape hatch if a report ever produces duplicate keys.
- **Real-browser iframe-no-reload is not automated** — jsdom proves node-identity retention; the actual "iframe did not refetch" is manual UAT. Accepted per Key Technical Decisions.
- **First reconcile after a rebuild** re-renders all entries once (rebuild path stamps `__renderedContent` to avoid this — verify the stamp lands in U5's rebuild step).

## Documentation / Operational Notes

- **Manual UAT (Power BI Desktop):** rebuild parity; resize-no-reload in both modes; reconcile data-refresh with stable iframe URL; measure-change re-render; runtime mode switch; raw-HTML toggle; empty↔populated transitions; scroll-position survival; dev-visual/AppSource-swap caution.
- **Release notes (2.x):** new "Update behavior" property with "Preserve unchanged content" mode for embedded/iframe content; viewport-only updates no longer reload entries even in the default mode.
- **Solution doc:** after UAT, consider capturing a `docs/solutions/` entry on the render-lifecycle pattern (the line-140-wipe root cause and the identity-keyed reconcile) — and re-check #47 (draggable state) under reconcile; close if resolved.
- Visual version bump handled by the release process, not this plan.

## Sources & References

- Origin brainstorm: [docs/brainstorms/2026-06-13-render-lifecycle-modes.md](../brainstorms/2026-06-13-render-lifecycle-modes.md)
- Related: [#47](https://github.com/dm-p/powerbi-visuals-html-content/issues/47) (draggable state — re-check under reconcile)
- WP-A (categorical mapping, shipped 2.0.0): [docs/plans/2026-06-12-001-categorical-data-mapping-selection-ids-plan.md](2026-06-12-001-categorical-data-mapping-selection-ids-plan.md)
