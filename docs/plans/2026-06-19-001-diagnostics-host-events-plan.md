---
title: 'feat: diagnostics host-event log + tooltip dismissal + frozen headers'
type: feat
status: approved
date: 2026-06-19
origin: docs/brainstorms/2026-06-19-diagnostics-host-events.md
---

# feat: diagnostics host-event log + tooltip dismissal + frozen headers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan unit-by-unit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped diagnostics dialog with an **Events** tab that logs visual host events — `update` (type + viewMode + dataView shape), `cross-filter`, `tooltip` (show/hide, both binding paths, de-duplicated), and `drill` (context-menu request) — captured only while diagnostics is armed; plus an always-on **tooltip dismissal** on cross-filter/drill, and **frozen** pivot tabs and per-tab headers so only tab bodies scroll.

**Architecture:** A passive `event-recorder` module (a bounded ring buffer that is a no-op unless armed) mirrors the existing `console-capture`. Spread-out call sites — `visual.ts` `update()`, `behavior.ts` interaction handlers, `domain-utils.ts` tooltip binders — call `recordEvent`/`recordTooltipEvent`; they never import dialog/UI code. The visual arms the recorder on the same `diagActive` gate it already uses for console capture, adds `events` to the bounded snapshot, and renders an Events tab in the existing `renderPanel`. A narrow `hideTooltip` callback threaded into `behavior.ts` dismisses the active tooltip on cross-filter/drill (always-on, independent of diagnostics). The dialog's tabs are restructured into `[fixed header] + [scrolling body]` via flexbox.

**Tech Stack:** TypeScript, powerbi-visuals-api 5.11.0 (`VisualUpdateType`, `VisualUpdateOptions`, `IVisualHost.tooltipService`, `TooltipShowOptions`), d3-selection, vitest (jsdom), pbiviz. Builds on the shipped `src/diagnostics/*` modules.

---

## Summary

The diagnostics dialog (merged #165) surfaces sanitizer removals, console output, and processed raw HTML, but nothing about the visual's own interaction with the Power BI host. This plan adds a fourth tab — **Events** — fed by a passive `event-recorder` that records `update`/`cross-filter`/`tooltip`/`drill` events (with bounded context sourced from the row's already-formatted `d.tooltips`) **only when diagnostics is armed**, exactly the zero-cost-when-off posture of the existing sanitizer sink and console tee. Two adjacent fixes ride along: an **always-on tooltip dismissal** so a hover tooltip no longer lingers over the context menu or after a cross-filter (via a narrow `hideTooltip` callback into `behavior.ts`), and **frozen dialog headers** so the pivot tabs and each tab's banner/controls stay fixed while only the body scrolls. Ten units: types/constants → pure formatters → recorder → Events tab → frozen headers → tooltip dismissal → cross-filter/drill instrumentation → tooltip instrumentation → visual wiring + labels → verification gate. The sanitizer ruleset and `capabilities.json` are untouched throughout.

---

## Problem Frame

Host interactions (`update`, selection/cross-filter, tooltip show/hide, context-menu/drill) happen invisibly, and Power BI Desktop has no dev tools to observe them — so an author debugging why the visual re-rendered, whether a cross-filter fired, or what a tooltip carried has no record. Two adjacent issues surface alongside: a hover tooltip is **not** dismissed when the author clicks (cross-filter) or right-clicks (context-menu/drill) — the handlers in [behavior.ts](../../src/behavior.ts) never call `tooltipService.hide` — and the dialog's whole tab panel scrolls, so a tab's controls scroll out of view when the body overflows. Full rationale and the ten key decisions: [origin brainstorm](../brainstorms/2026-06-19-diagnostics-host-events.md).

---

## Requirements

- R1. A passive `event-recorder` records `HostEvent { ts, type, summary, context? }` into a bounded ring buffer; `recordEvent`/`recordTooltipEvent` are **no-ops unless armed**. The visual arms it on the existing `diagActive` gate (toggle ON + `allowModalDialog` + edit mode). *(origin: Decision 2)*
- R2. Four event sources at existing hook points: `update` (`visual.ts` `update()`), `cross-filter` + `drill` (`behavior.ts`), `tooltip` (`domain-utils.ts`, **both** `bindStandardTooltips` and `bindManualTooltips`). *(origin: Decision 4, 10)*
- R3. Context is "rich but bounded", sourced from `d.tooltips` (already-formatted field=value) — first-N items, each capped, with `(+k more)`; never raw `ISelectionId` or dataView internals. *(origin: Decision 3)*
- R4. Tooltip `show` de-duplication: a tooltip event records only when its `(phase, source, context)` differs from the **last recorded tooltip event**; an intervening `hide` (or different point/source) re-enables an identical `show`; an intervening non-tooltip event does not. Only `tooltip` is de-duplicated. *(origin: Decision 9, 10)*
- R5. A structured **Events** tab in `renderPanel` after Console, present in all editions: `time · type · context` rows, a **Clear** button, and per-type filter checkboxes (`update`/`cross-filter`/`tooltip`/`drill`, default all on). *(origin: Decision 1, 7)*
- R6. **Always-on tooltip dismissal:** a `hideTooltip` callback in `IHtmlBehaviorOptions`, called on cross-filter click, clear-catcher click, and context-menu — independent of `diagActive`. The programmatic hide is **not** logged as a `tooltip` event. *(origin: Decision 5)*
- R7. **Frozen headers:** the pivot tab bar and each tab's banner/controls stay fixed; only the body scrolls. `activate()` sets the active panel to `display: flex`. *(origin: Decision 6)*
- R8. All in-dialog strings localized via the snapshot (`DiagnosticsLabels` + `Diagnostics_*` resjson keys); the recorder buffer is iframe-scoped and bounded (`eventBufferCap`). *(origin: Decision 8)*
- R9. **Zero sanitizer-rule churn** (`npm run docs:check` green), no `capabilities.json` change, `"privileges": []` stays, all three editions package, existing suites stay green. *(origin: brainstorm Goals 6-7)*

---

## Scope Boundaries

- No logging of host-side outcomes the visual can't observe — `drill` logs the **context-menu request**, not drillthrough navigation.
- No persistence/telemetry — the buffer is in-memory, session-only, sent nowhere.
- No verbosity toggle — fixed caps, no per-event verbosity control.
- No raw selection identities / dataView internals in context — `d.tooltips` only.
- No tooltip rework beyond dismissal — existing hover/show logic untouched.
- No change to the sanitizer ruleset, `capabilities.json`, data roles, or privileges.

---

## Context & Research

### Relevant code and patterns

- [src/diagnostics/console-capture.ts](../../src/diagnostics/console-capture.ts) — the **template** for the recorder: a module-level bounded ring buffer with `install`/`snapshot`/`clear`/`resetForTests` and a `push` that caps. The recorder mirrors this but is armed/disarmed (not install-once) and has `recordEvent`/`recordTooltipEvent` instead of a console patch.
- [src/diagnostics/diagnostics-sink.ts](../../src/diagnostics/diagnostics-sink.ts) — the **armed-flag** pattern (`armed` boolean, `recordRemoval` no-op unless armed, self-guarded `try/catch`). The recorder uses the same no-op-unless-armed discipline.
- [src/diagnostics/diagnostics-dialog.ts](../../src/diagnostics/diagnostics-dialog.ts) — `renderPanel(host, snapshot, callbacks)`, the `tabs` array (Raw HTML, optional Sanitizer, Console), `consoleTab(s, callbacks)` (the **exact template** for `eventsTab`: a `.hc-console-toolbar` with a `.hc-clear` button + filter checkboxes, and a `.hc-console-lines` body), `PanelCallbacks` (`onTabChange`/`onClearConsole`/`onLaunchDoc`), and `activate(id)` which toggles `o.body.style.display = on ? 'block' : 'none'` (→ `'flex'` in U5). The `el(tag, cls?, text?)` helper builds nodes (no innerHTML).
- [src/diagnostics/diagnostics-snapshot.ts](../../src/diagnostics/diagnostics-snapshot.ts) — `buildSnapshot(input)` (add `events`), `shouldShowDiagnosticsIcon`, `setIconVisibility`.
- [src/diagnostics/types.ts](../../src/diagnostics/types.ts) — `ConsoleEntry`, `DiagnosticsLabels`, `DiagnosticsSnapshot` (add `HostEvent`/`HostEventType`, labels, `events`).
- [src/behavior.ts](../../src/behavior.ts) — `IHtmlBehaviorOptions` (add `hideTooltip`), `handleSelectionClick` (line 68), `bindClearCatcher` click (98-105), `handleContextMenu` (80-88). The datum `d: IHtmlEntry` carries `tooltips: VisualTooltipDataItem[]` ({ displayName, value }).
- [src/domain-utils.ts:537-642](../../src/domain-utils.ts#L537-L642) — `resolveHover` → `bindStandardTooltips` (rows; `d.tooltips` + `[d.identity]`; show on `mouseover mousemove`, hide on `mouseout`) and `bindManualTooltips` (author `.manualTooltipSelector` elements; `dataItems` parsed from `data-*`; same events).
- [src/visual.ts:206-258](../../src/visual.ts#L206-L258) — `diagActive` computed once per `update()`; `installConsoleCapture()` when active; `beginCapture()`/`endCapture()` bracket the render. **This is where the recorder is armed and the `update` event recorded.** `openDiagnostics()` (≈487-547) assembles the snapshot and reads `result.resultState` (add `events` + `clearEvents`). `diagnosticsLabels()` resolves the `Diagnostics_*` keys (add the new keys). `bindInteractivity` builds the behavior options (wire `hideTooltip`).
- [src/visual-constants.ts:256-268](../../src/visual-constants.ts#L256-L268) — the `diagnostics` constant block (add `eventBufferCap`, `eventContextItems`, `eventContextCap`).
- [stringResources/en-US/resources.resjson](../../stringResources/en-US/resources.resjson) — the `Diagnostics_*` keys block (≈26-47); add the Events keys after `Diagnostics_RawBannerSanitized`.
- [style/visual.less](../../style/visual.less) — the `.hc-diagnostics` block (≈188-305): `.hc-tabbar`, `.hc-panels`, `.hc-console-toolbar`/`.hc-clear`/`.hc-filter`, `.hc-log`/`.hc-time`. Reuse for events; add the frozen-header flex layout.
- [test/diagnostics-wiring.test.ts](../../test/diagnostics-wiring.test.ts) — constructs the `Visual` directly with a host stub + a file-local `vi.mock('powerbi-visuals-utils-interactivityutils', …)`. The pattern for any test that needs a `Visual` instance.

### Key API facts

- **`VisualUpdateType`** is a bitflag enum on `powerbi.VisualUpdateType` (`Data`, `Resize`, `ResizeEnd`, `ViewMode`, `Style`, `All`, …). Decode by testing `type & powerbi.VisualUpdateType.X` and joining the matched names — reference the enum members, never hard-coded numbers (the existing code uses `powerbi.VisualUpdateType.Data`).
- **`options.viewMode`** — `View=0`, `Edit=1`, `InFocusEdit=2` (use literals; it's a const enum).
- **`host.tooltipService.hide(options: TooltipHideOptions)`** — `{ immediately: boolean, isTouchEvent: boolean }`. Used by `domain-utils` already (`{ immediately: true, isTouchEvent: true }`); the dismissal uses `{ immediately: true, isTouchEvent: false }`.
- **`IHtmlEntry.tooltips: VisualTooltipDataItem[]`** — each `{ displayName, value }`, already value-formatted by the view model. The context source for cross-filter/drill/standard-tooltip. For `bindManualTooltips`, the equivalent `dataItems` array is built locally from `data-*` attributes.

### Institutional learnings

- [powerbi-visual-runtime-gotchas] (auto memory) — the dialog runs in a sandboxed iframe with only `IDialogHost` (no `IVisualHost`); strings must be localized in the visual and passed in the snapshot. Honored by R8.
- [visual-handles-multi-mb-content] (auto memory) — bound anything that serializes rendered output. Honored by R3/R8 (capped context, ring buffer).
- The shipped diagnostics modules already embody the passive-sink + snapshot/result round-trip + pure-DOM patterns; this plan extends, not reinvents.

---

## Key Technical Decisions

- **Recorder mirrors `console-capture`, armed like the sink.** A module-level ring buffer with a `setArmed(boolean)` flag (set from `diagActive` each `update()`), so events accumulate across updates (like console output) but recording is inert in view mode and when the toggle is off. `recordEvent`/`recordTooltipEvent` are self-guarded no-ops when disarmed.
- **`d.tooltips` is the single context source.** Reusing the already-formatted, already-author-visible tooltip items means the Events tab exposes nothing new and needs no identity serialization. A pure `formatTooltipItems(items, n, cap)` produces the bounded `field=value (+k more)` string for every event type that has a point.
- **Tooltip dedup lives in the recorder.** `recordTooltipEvent(phase, source, context)` holds a `lastTooltipKey` and drops a record whose `(phase, source, context)` equals it; resets on `clear`. This keeps the dedup rule in one tested place and off the hot mousemove path's call sites.
- **`hideTooltip` is a callback, not a service.** `behavior.ts` stays free of the tooltip API; the visual supplies `() => host.tooltipService.hide(...)`. The dismissal is always-on; the `recordEvent` at the same site is gated.
- **Frozen headers via flexbox, `display: flex` on activate.** Each tab becomes a column flex of `[header]+[body]`; `.hc-panels` is `flex:1; min-height:0` so the body scrolls instead of growing the dialog. `activate()` switches the active panel to `flex` (was `block`).
- **Pure helpers carry the tests.** The modal and real host events can't run in jsdom, so the tested contract is the pure pieces — `describeUpdateType`, `formatTooltipItems`, the recorder (incl. dedup), `eventsTab`/`renderPanel`, and the `behavior.ts` handlers via spies. End-to-end is UAT.

---

## Open Questions

### Resolved during planning

- *Separate tab vs 5th console level?* Separate **Events** tab (structured columns + own filter), settled in brainstorm.
- *Does drill need new wiring?* No — `behavior.ts` `bindContextMenu`/`handleContextMenu` already exists; instrument it.
- *Does the recorder reset per render like the sink?* No — it accumulates across updates like the console; armed/disarmed by `diagActive`, emptied only by Clear.

### Deferred to implementation / UAT

- *Default `eventBufferCap` and whether `tooltip`'s filter should default off* — tune in UAT against a chatty hover surface.
- *`d.tooltips` empty / null datum* — fall back to a generic label (`background`, `cleared`); finalized in U7/U8.
- *Frozen-header height chain* — the flex scroll needs a definite height from the modal's fixed surface down to `.hc-diagnostics`; verified in Desktop + Service UAT.
- *Tooltip-hide timing vs the context menu on right-click* — confirm the hover tooltip dismisses before/around the menu appearing; UAT.

---

## High-Level Technical Design

```
visual.ts update():
  diagActive = shouldShowDiagnosticsIcon(enableDiagnostics, allowModalDialog, editMode)
  eventRecorder.setArmed(diagActive)
  if (diagActive) recordEvent('update', describeUpdateType(options.type) + viewMode + dataView shape)
  …render…
  icon click → buildSnapshot({ …, events: eventRecorder.snapshot() }) → openModalDialog
  on close → result.clearEvents ? eventRecorder.clear()

behavior.ts:
  handleSelectionClick → hideTooltip(); recordEvent('cross-filter', tooltips(d) | 'cleared')
  bindClearCatcher click → hideTooltip(); recordEvent('cross-filter', 'cleared')
  handleContextMenu → hideTooltip(); recordEvent('drill', tooltips(d) | 'background' + x,y)

domain-utils.ts resolveHover:
  bindStandardTooltips show/hide → recordTooltipEvent(phase, 'standard', tooltips(d))
  bindManualTooltips  show/hide → recordTooltipEvent(phase, 'manual',  tooltips(dataItems))

diagnostics-dialog.ts renderPanel:
  tabs: [Raw HTML] [Sanitizer?] [Console] [Events]   ← Events always present
  each tab = [fixed header] + [scrolling .hc-tab-body];  activate → display:flex
  eventsTab: toolbar(Clear + type filters) + rows(time · type · context)
```

---

## Implementation Units

> Run `npm test` for fast feedback per unit; `npm run test:all` is the final gate (U10). Commit after each unit. Stage files explicitly — never `git add -A`/`.`/`-u`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Leave user WIP (`test-uat/.../expressions.tmdl`, `.github/hooks/`, `docs/v2/`) untouched.

### Unit 1: Types and constants

**Files:**
- Modify: `src/diagnostics/types.ts`
- Modify: `src/visual-constants.ts:256-268` (the `diagnostics` block)
- Test: `test/visual-constants.test.ts`

- [ ] **Step 1: Write the failing test** (append to `test/visual-constants.test.ts`)

```ts
it('exposes bounded host-event caps', () => {
    const d = VisualConstants.diagnostics;
    expect(d.eventBufferCap).toBeGreaterThan(0);
    expect(d.eventContextItems).toBeGreaterThan(0);
    expect(d.eventContextCap).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`undefined` caps)

Run: `npx vitest run test/visual-constants.test.ts`
Expected: FAIL (`eventBufferCap` is undefined).

- [ ] **Step 3: Add the constants** to the `diagnostics` block in `src/visual-constants.ts` (after `highlightSizeLimit`)

```ts
        // Host-event log (Events tab): ring-buffer size, and per-event context
        // bounds (first N tooltip items, each value capped to eventContextCap).
        eventBufferCap: 200,
        eventContextItems: 3,
        eventContextCap: 80,
```

- [ ] **Step 4: Add the types** to `src/diagnostics/types.ts`

```ts
export type HostEventType = 'update' | 'cross-filter' | 'tooltip' | 'drill';
export type TooltipPhase = 'show' | 'hide';
export type TooltipSource = 'standard' | 'manual';

/** One captured visual-host event for the diagnostics Events tab. */
export interface HostEvent {
    /** Unix epoch ms (Date.now()). */
    ts: number;
    type: HostEventType;
    /** Short headline, e.g. "type=Data+Resize, viewMode=Edit" or "show · standard". */
    summary: string;
    /** Optional bounded detail, e.g. 'Employee[FullName]="A. Smith" (+1 more)'. */
    context?: string;
}
```

  Extend `DiagnosticsLabels` with the Events labels:

```ts
    // Events tab.
    tabEvents: string;
    eventsEmpty: string;
    colTime: string;
    colEvent: string;
    colContext: string;
    eventsClear: string;
    /** Per-type filter labels. */
    evtUpdate: string;
    evtCrossFilter: string;
    evtTooltip: string;
    evtDrill: string;
```

  Add `events` to `DiagnosticsSnapshot`:

```ts
    /** Captured visual host events (update/cross-filter/tooltip/drill). */
    events: HostEvent[];
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx vitest run test/visual-constants.test.ts`
Expected: PASS. (TypeScript consumers of `DiagnosticsSnapshot`/`DiagnosticsLabels` now require the new fields — that surfaces in U3/U4/U9 where they're populated; the type file itself compiles.)

- [ ] **Step 6: Commit**

```bash
git add src/diagnostics/types.ts src/visual-constants.ts test/visual-constants.test.ts
git commit -m "feat: host-event types + bounded caps for the diagnostics Events tab"
```

---

### Unit 2: Pure event formatters

**Files:**
- Create: `src/diagnostics/host-events.ts`
- Test: `test/host-events.test.ts`

- [ ] **Step 1: Write the failing test** (`test/host-events.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { describeUpdateType, formatTooltipItems } from '../src/diagnostics/host-events';
import powerbi from 'powerbi-visuals-api';

describe('describeUpdateType', () => {
    it('joins the set flag names with +', () => {
        const t =
            powerbi.VisualUpdateType.Data | powerbi.VisualUpdateType.Resize;
        expect(describeUpdateType(t)).toBe('Data+Resize');
    });
    it('falls back to the numeric value when no known flag matches', () => {
        expect(describeUpdateType(0)).toBe('0');
    });
});

describe('formatTooltipItems', () => {
    const items = [
        { displayName: 'Employee[FullName]', value: 'A. Smith' },
        { displayName: 'Sales', value: '100' },
        { displayName: 'Region', value: 'East' },
        { displayName: 'Qty', value: '4' }
    ];
    it('formats field=value, first N, with a (+k more) marker', () => {
        expect(formatTooltipItems(items, 2, 80)).toBe(
            'Employee[FullName]="A. Smith", Sales="100" (+2 more)'
        );
    });
    it('caps each value length', () => {
        const long = [{ displayName: 'k', value: 'x'.repeat(200) }];
        const out = formatTooltipItems(long, 3, 10);
        expect(out).toContain('k="xxxxxxxxxx…"');
    });
    it('returns empty string for no items', () => {
        expect(formatTooltipItems([], 3, 80)).toBe('');
    });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `npx vitest run test/host-events.test.ts`
Expected: FAIL (cannot find `../src/diagnostics/host-events`).

- [ ] **Step 3: Implement** `src/diagnostics/host-events.ts`

```ts
/**
 * Pure formatters for the diagnostics host-event log. No DOM, no powerbi host
 * services — just value-in/string-out so they're trivially testable.
 */
import powerbi from 'powerbi-visuals-api';

/** A {displayName, value} pair, as carried by IHtmlEntry.tooltips. */
export interface TooltipItem {
    displayName: string;
    value: string;
}

// VisualUpdateType is a bitflag enum; decode by name so we never hard-code its
// numeric values (which are an API detail).
const UPDATE_FLAGS: ReadonlyArray<[number, string]> = [
    [powerbi.VisualUpdateType.Data, 'Data'],
    [powerbi.VisualUpdateType.Resize, 'Resize'],
    [powerbi.VisualUpdateType.ViewMode, 'ViewMode'],
    [powerbi.VisualUpdateType.Style, 'Style'],
    [powerbi.VisualUpdateType.ResizeEnd, 'ResizeEnd']
];

/** Decode a VisualUpdateType bitmask to "Data+Resize"; numeric fallback. */
export const describeUpdateType = (type: number): string => {
    const names = UPDATE_FLAGS.filter(([bit]) => (type & bit) === bit).map(
        ([, name]) => name
    );
    return names.length ? names.join('+') : String(type);
};

/** Bounded "field=value, … (+k more)" from tooltip items. Empty → "". */
export const formatTooltipItems = (
    items: TooltipItem[],
    maxItems: number,
    valueCap: number
): string => {
    if (!items || items.length === 0) return '';
    const shown = items.slice(0, maxItems).map((i) => {
        const v =
            i.value.length > valueCap
                ? `${i.value.slice(0, valueCap)}…`
                : i.value;
        return `${i.displayName}="${v}"`;
    });
    const extra = items.length - maxItems;
    return extra > 0 ? `${shown.join(', ')} (+${extra} more)` : shown.join(', ');
};
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run test/host-events.test.ts`
Expected: PASS (3 formatter cases + 2 update-type cases).

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics/host-events.ts test/host-events.test.ts
git commit -m "feat: pure host-event formatters (update-type decode + bounded tooltip items)"
```

---

### Unit 3: The event recorder

**Files:**
- Create: `src/diagnostics/event-recorder.ts`
- Test: `test/event-recorder.test.ts`

- [ ] **Step 1: Write the failing test** (`test/event-recorder.test.ts`)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
    setArmed,
    recordEvent,
    recordTooltipEvent,
    snapshot,
    clear,
    resetForTests
} from '../src/diagnostics/event-recorder';
import { VisualConstants } from '../src/visual-constants';

beforeEach(() => resetForTests());

describe('event recorder arming', () => {
    it('is a no-op when disarmed', () => {
        recordEvent('update', 'x');
        expect(snapshot()).toEqual([]);
    });
    it('records when armed', () => {
        setArmed(true);
        recordEvent('update', 'type=Data');
        const s = snapshot();
        expect(s).toHaveLength(1);
        expect(s[0]).toMatchObject({ type: 'update', summary: 'type=Data' });
        expect(typeof s[0].ts).toBe('number');
    });
    it('disarming stops recording', () => {
        setArmed(true);
        recordEvent('drill', 'a');
        setArmed(false);
        recordEvent('drill', 'b');
        expect(snapshot()).toHaveLength(1);
    });
});

describe('ring buffer + clear', () => {
    beforeEach(() => setArmed(true));
    it('caps at eventBufferCap, evicting oldest', () => {
        const cap = VisualConstants.diagnostics.eventBufferCap;
        for (let i = 0; i < cap + 5; i++) recordEvent('update', `u${i}`);
        const s = snapshot();
        expect(s).toHaveLength(cap);
        expect(s[0].summary).toBe('u5');
    });
    it('clear empties the buffer and returns a copy from snapshot', () => {
        recordEvent('update', 'a');
        const s = snapshot();
        clear();
        expect(snapshot()).toEqual([]);
        expect(s).toHaveLength(1); // snapshot was a copy, unaffected by clear
    });
});

describe('tooltip de-duplication (Decision 9/10)', () => {
    beforeEach(() => setArmed(true));
    const sums = () => snapshot().map((e) => e.summary + '|' + (e.context ?? ''));

    it('collapses consecutive identical shows', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordTooltipEvent('show', 'standard', 'A');
        expect(snapshot()).toHaveLength(1);
    });
    it('re-enables an identical show after an intervening hide', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordTooltipEvent('hide', 'standard', '');
        recordTooltipEvent('show', 'standard', 'A');
        expect(snapshot()).toHaveLength(3);
    });
    it('records a show over different data', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordTooltipEvent('show', 'standard', 'B');
        expect(snapshot()).toHaveLength(2);
    });
    it('does NOT re-enable across an intervening non-tooltip event', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordEvent('update', 'type=Resize');
        recordTooltipEvent('show', 'standard', 'A');
        // update recorded; the second identical show suppressed → 2 total
        expect(snapshot()).toHaveLength(2);
        expect(sums()).toEqual(['show · standard|A', 'type=Resize|']);
    });
    it('does NOT dedup standard vs manual with the same context', () => {
        recordTooltipEvent('show', 'standard', 'A');
        recordTooltipEvent('show', 'manual', 'A');
        expect(snapshot()).toHaveLength(2);
    });
    it('clear resets the dedup key so the next show logs', () => {
        recordTooltipEvent('show', 'standard', 'A');
        clear();
        recordTooltipEvent('show', 'standard', 'A');
        expect(snapshot()).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `npx vitest run test/event-recorder.test.ts`
Expected: FAIL (cannot find `../src/diagnostics/event-recorder`).

- [ ] **Step 3: Implement** `src/diagnostics/event-recorder.ts`

```ts
/**
 * Passive host-event recorder for the diagnostics Events tab. A bounded ring
 * buffer that is a NO-OP unless armed — armed only while diagnostics is active
 * (the visual's diagActive gate), so there is zero cost in view mode or when the
 * toggle is off. Mirrors console-capture's buffer discipline; iframe-scoped.
 *
 * Imports only the pure types/constants — no dialog/UI, no powerbi host service.
 */
import { HostEvent, HostEventType, TooltipPhase, TooltipSource } from './types';
import { VisualConstants } from '../visual-constants';

let armed = false;
let buffer: HostEvent[] = [];
// Decision 9: dedup key of the LAST RECORDED tooltip event, so consecutive
// identical (phase, source, context) tooltip events collapse to one.
let lastTooltipKey: string | undefined;

export const setArmed = (value: boolean): void => {
    armed = value;
};

const push = (e: HostEvent): void => {
    buffer.push(e);
    while (buffer.length > VisualConstants.diagnostics.eventBufferCap) {
        buffer.shift();
    }
};

/** Record a host event. No-op unless armed. Self-guarded — never throws into
 *  the render/interaction paths that call it. */
export const recordEvent = (
    type: HostEventType,
    summary: string,
    context?: string
): void => {
    if (!armed) return;
    try {
        push({ ts: Date.now(), type, summary, context });
    } catch {
        /* diagnostics must never break the visual */
    }
};

/** Record a tooltip event with Decision 9/10 de-duplication. No-op unless
 *  armed. The dedup key includes source so standard/manual never collapse. */
export const recordTooltipEvent = (
    phase: TooltipPhase,
    source: TooltipSource,
    context: string
): void => {
    if (!armed) return;
    const key = `${phase}|${source}|${context}`;
    if (key === lastTooltipKey) return;
    lastTooltipKey = key;
    recordEvent('tooltip', `${phase} · ${source}`, context || undefined);
};

export const snapshot = (): HostEvent[] => buffer.slice();

/** Empty the buffer (the Clear affordance) and reset tooltip dedup so the next
 *  show always logs. Does not disarm. */
export const clear = (): void => {
    buffer = [];
    lastTooltipKey = undefined;
};

/** Test-only: full reset (disarm, empty, clear dedup). */
export const resetForTests = (): void => {
    armed = false;
    buffer = [];
    lastTooltipKey = undefined;
};
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run test/event-recorder.test.ts`
Expected: PASS (arming, ring buffer, clear, and all six dedup cases).

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics/event-recorder.ts test/event-recorder.test.ts
git commit -m "feat: passive host-event recorder with tooltip de-duplication"
```

---

### Unit 4: The Events tab

**Files:**
- Modify: `src/diagnostics/diagnostics-dialog.ts`
- Test: `test/diagnostics-dialog.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `test/diagnostics-dialog.test.ts`; first extend the `labels` stub and `snap()` with the new fields)

Add to the `labels` object:

```ts
    tabEvents: 'Events',
    eventsEmpty: 'No host events captured.',
    colTime: 'time',
    colEvent: 'event',
    colContext: 'context',
    eventsClear: 'Clear',
    evtUpdate: 'update',
    evtCrossFilter: 'cross-filter',
    evtTooltip: 'tooltip',
    evtDrill: 'drill'
```

Add `events: []` to the `snap()` default. Then the tests:

```ts
it('always renders an Events tab (every edition)', () => {
    const el = document.createElement('div');
    renderPanel(el, snap({ sanitizeEnabled: false }));
    const tabTexts = Array.from(el.querySelectorAll('[role="tab"]')).map(
        (t) => t.textContent
    );
    expect(tabTexts).toContain('Events');
});

it('renders host-event rows with time, type, and context', () => {
    const el = document.createElement('div');
    renderPanel(
        el,
        snap({
            events: [
                {
                    ts: 0,
                    type: 'cross-filter',
                    summary: 'cross-filter',
                    context: 'Region="East"'
                }
            ]
        })
    );
    const row = el.querySelector('.hc-evt') as HTMLElement;
    expect(row.querySelector('.hc-time')?.textContent).toMatch(
        /^\d{2}:\d{2}:\d{2}\.\d{3}$/
    );
    expect(row.querySelector('.hc-evt-type')?.textContent).toBe('cross-filter');
    // The context cell shows "summary · context" (the detail); assert it carries
    // the point context.
    expect(row.querySelector('.hc-evt-context')?.textContent).toContain(
        'Region="East"'
    );
});

it('event type filter hides rows of the unchecked type', () => {
    const el = document.createElement('div');
    renderPanel(
        el,
        snap({
            events: [
                { ts: 0, type: 'update', summary: 'u' },
                { ts: 0, type: 'drill', summary: 'd' }
            ]
        })
    );
    const updateCb = el.querySelector(
        'input[data-evt="update"]'
    ) as HTMLInputElement;
    const updateRow = el.querySelector('.hc-evt.hc-evt-update') as HTMLElement;
    const drillRow = el.querySelector('.hc-evt.hc-evt-drill') as HTMLElement;
    expect(updateRow.style.display).not.toBe('none');
    updateCb.checked = false;
    updateCb.dispatchEvent(new Event('change'));
    expect(updateRow.style.display).toBe('none');
    expect(drillRow.style.display).not.toBe('none');
});

it('events Clear empties the display and reports onClearEvents', () => {
    const el = document.createElement('div');
    let cleared = 0;
    renderPanel(
        el,
        snap({ events: [{ ts: 0, type: 'update', summary: 'u' }] }),
        { onClearEvents: () => cleared++ }
    );
    expect(el.querySelector('.hc-evt')).not.toBeNull();
    (el.querySelector('.hc-events .hc-clear') as HTMLButtonElement).click();
    expect(el.querySelector('.hc-evt')).toBeNull();
    expect(cleared).toBe(1);
});

it('events tab shows an empty state when there are no events', () => {
    const el = document.createElement('div');
    renderPanel(el, snap({ events: [] }));
    expect(el.querySelector('.hc-events')?.textContent?.toLowerCase()).toContain(
        'no host events'
    );
});
```

- [ ] **Step 2: Run it — expect FAIL** (no Events tab / `onClearEvents`)

Run: `npx vitest run test/diagnostics-dialog.test.ts`
Expected: FAIL (the Events tab and `.hc-evt` rows don't exist).

- [ ] **Step 3: Implement.** In `src/diagnostics/diagnostics-dialog.ts`:

  Add to `PanelCallbacks`:

```ts
    onClearEvents?: () => void;
```

  Add `EVENT_TYPES` near `CONSOLE_LEVELS`:

```ts
const EVENT_TYPES: { type: HostEventType; label: keyof DiagnosticsLabels }[] = [
    { type: 'update', label: 'evtUpdate' },
    { type: 'cross-filter', label: 'evtCrossFilter' },
    { type: 'tooltip', label: 'evtTooltip' },
    { type: 'drill', label: 'evtDrill' }
];
```

  (Add `HostEventType`, `HostEvent`, `DiagnosticsLabels` to the existing `./types` import; `fmtTime` and `el` already exist in this file.)

  Add the `eventsTab` builder (modeled on `consoleTab`):

```ts
const eventsTab = (
    s: DiagnosticsSnapshot,
    callbacks: PanelCallbacks
): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-events');
    const rows = el('div', 'hc-console-lines hc-evt-rows');

    const filters: HTMLInputElement[] = [];
    function applyFilter(): void {
        const on = new Set(
            filters.filter((f) => f.checked).map((f) => f.dataset.evt)
        );
        rows.querySelectorAll<HTMLElement>('.hc-evt').forEach((r) => {
            r.style.display = on.has(r.dataset.evt ?? '') ? '' : 'none';
        });
    }

    const toolbar = el('div', 'hc-console-toolbar');
    const clearBtn = el('button', 'hc-clear', s.labels.eventsClear) as HTMLButtonElement;
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', () => {
        rows.replaceChildren(el('p', 'hc-empty', s.labels.eventsEmpty));
        callbacks.onClearEvents?.();
    });
    toolbar.appendChild(clearBtn);
    EVENT_TYPES.forEach(({ type, label }) => {
        const lbl = el('label', 'hc-filter');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.dataset.evt = type;
        cb.addEventListener('change', applyFilter);
        lbl.appendChild(cb);
        lbl.appendChild(el('span', `hc-filter-label hc-evt-lbl-${type}`, s.labels[label]));
        toolbar.appendChild(lbl);
        filters.push(cb);
    });

    if (s.events.length === 0) {
        rows.appendChild(el('p', 'hc-empty', s.labels.eventsEmpty));
    } else {
        s.events.forEach((e: HostEvent) => {
            const row = el('div', `hc-evt hc-evt-${e.type}`);
            row.dataset.evt = e.type;
            // The "context" column shows the descriptive detail: the summary,
            // and the point context appended when present (e.g. update →
            // "type=Data+Resize, viewMode=Edit · rows=42").
            const detail = e.context ? `${e.summary} · ${e.context}` : e.summary;
            row.appendChild(el('span', 'hc-time', fmtTime(e.ts)));
            row.appendChild(el('span', 'hc-evt-type', e.type));
            row.appendChild(el('span', 'hc-evt-context', detail));
            row.title = detail;
            rows.appendChild(row);
        });
    }

    wrap.appendChild(toolbar);
    wrap.appendChild(rows);
    return wrap;
};
```

  In `renderPanel`, after the Console tab is pushed:

```ts
    tabs.push({
        id: 'events',
        label: snapshot.labels.tabEvents,
        body: eventsTab(snapshot, callbacks)
    });
```

  Wire the dialog result in the `DiagnosticsDialog` constructor — extend the `result` object and add the callback:

```ts
        const result: { lastTab: string; clearConsole?: boolean; clearEvents?: boolean } = {
            lastTab: 'raw'
        };
        // …
            onClearEvents: () => {
                result.clearEvents = true;
                host?.setResult?.({ ...result });
            },
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run test/diagnostics-dialog.test.ts`
Expected: PASS (Events tab present, rows, filter, Clear, empty state) and all existing dialog tests still green.

- [ ] **Step 5: Add minimal styles** to `style/visual.less` inside `.hc-diagnostics` (reuse log styles; just the new spans)

```less
    .hc-evt {
        display: flex;
        gap: 8px;
        font-family: monospace;
        white-space: pre-wrap;
    }
    .hc-evt-type {
        min-width: 90px;
        color: #0078d4;
    }
```

- [ ] **Step 6: Commit**

```bash
git add src/diagnostics/diagnostics-dialog.ts test/diagnostics-dialog.test.ts style/visual.less
git commit -m "feat: Events tab in the diagnostics dialog (rows, per-type filter, Clear)"
```

---

### Unit 5: Frozen headers

**Files:**
- Modify: `src/diagnostics/diagnostics-dialog.ts`
- Modify: `style/visual.less`
- Test: `test/diagnostics-dialog.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `test/diagnostics-dialog.test.ts`)

```ts
it('activates the selected panel with display:flex (frozen-header layout)', () => {
    const el = document.createElement('div');
    renderPanel(el, snap());
    const raw = el.querySelector('#hc-panel-raw') as HTMLElement;
    expect(raw.style.display).toBe('flex');
});

it('wraps each tab body in a scrollable .hc-tab-body under a header sibling', () => {
    const el = document.createElement('div');
    renderPanel(el, snap());
    const consolePanel = el.querySelector('#hc-panel-console') as HTMLElement;
    // toolbar (header) and the scrollable body are siblings; body carries .hc-tab-body
    expect(consolePanel.querySelector(':scope > .hc-console-toolbar')).not.toBeNull();
    expect(consolePanel.querySelector(':scope > .hc-tab-body')).not.toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL** (display is `block`; no `.hc-tab-body`)

Run: `npx vitest run test/diagnostics-dialog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement — `activate()` uses `flex`.** In `renderPanel`'s `activate` and the initial show, change `'block'` → `'flex'`:

```ts
    const activate = (id: string): void => {
        tabs.forEach((o, j) => {
            const on = o.id === id;
            o.body.style.display = on ? 'flex' : 'none';
            buttons[j].setAttribute('aria-selected', String(on));
        });
        callbacks.onTabChange?.(id);
    };
```

  and in the per-tab loop:

```ts
        t.body.style.display = t.id === activeId ? 'flex' : 'none';
```

- [ ] **Step 4: Implement — wrap each tab's scrollable content in `.hc-tab-body`.** In each tab builder (`rawTab`, `sanitizerTab`, `consoleTab`, `eventsTab`), keep the banner/toolbar (header) as a direct child of the panel `wrap`, and move the scrollable content (the `<pre>`, the table, `.hc-console-lines`, `.hc-evt-rows`) into a `.hc-tab-body` child. Example for `consoleTab` — replace `wrap.appendChild(lines)` with:

```ts
    const body = el('div', 'hc-tab-body');
    body.appendChild(lines);
    wrap.appendChild(toolbar); // header (frozen)
    wrap.appendChild(body);    // scrolls
    return wrap;
```

  Apply the same shape to `rawTab` (header = banner + truncation note + Copy; body = `<pre>`), `sanitizerTab` (header = docs banner; body = table + overflow note), and `eventsTab` (header = toolbar; body = `.hc-evt-rows`).

- [ ] **Step 5: Implement — flex layout** in `style/visual.less`. Change `.hc-diagnostics` to a full-height column and add the regions:

```less
.hc-diagnostics {
    font-family: 'Segoe UI', sans-serif;
    font-size: 12px;
    height: 100%;
    display: flex;
    flex-direction: column;
    .hc-tabbar {
        flex: none;
        display: flex;
        gap: 4px;
        border-bottom: 1px solid #ddd;
    }
    .hc-panels {
        flex: 1;
        min-height: 0; // lets the body scroll instead of growing the dialog
        padding-top: 12px; // keep the existing gap below the pivot
    }
    .hc-tabpanel {
        height: 100%;
        flex-direction: column;
        // (display is toggled to flex/none by activate())
    }
    .hc-tab-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }
    // …existing rules unchanged…
}
```

  Keep the existing `padding-top: 12px` on `.hc-panels` (folded into the block above) — `min-height: 0` still applies, so the body scrolls correctly with the gap retained.

- [ ] **Step 6: Run it — expect PASS**

Run: `npx vitest run test/diagnostics-dialog.test.ts`
Expected: PASS (display flex; `.hc-tab-body` present) and all existing dialog tests still green (the banner/`.hc-doc-link`/`.hc-pre`/`.hc-log` assertions still resolve — they're now nested under header/body but the selectors are descendant-based).

- [ ] **Step 7: Commit**

```bash
git add src/diagnostics/diagnostics-dialog.ts style/visual.less test/diagnostics-dialog.test.ts
git commit -m "feat: freeze pivot + per-tab headers; only tab bodies scroll"
```

---

### Unit 6: Tooltip dismissal (always-on)

**Files:**
- Modify: `src/behavior.ts`
- Modify: `src/visual.ts` (wire `hideTooltip` into the behavior options)
- Test: `test/behavior.test.ts` (create)

- [ ] **Step 1: Write the failing test** (`test/behavior.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { BehaviorManager } from '../src/behavior';

const makeOptions = (hideTooltip: () => void) => {
    const point = {
        on: vi.fn().mockReturnThis()
    };
    const clear = { on: vi.fn().mockReturnThis() };
    return {
        options: {
            pointSelection: point as any,
            clearCatcherSelection: clear as any,
            viewModel: { hasCrossFiltering: true } as any,
            hideTooltip
        },
        point,
        clear
    };
};

describe('tooltip dismissal on interaction', () => {
    it('handleContextMenu calls hideTooltip', () => {
        const hideTooltip = vi.fn();
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(hideTooltip);
        const handler = { handleContextMenu: vi.fn(), handleSelection: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 1, clientY: 2 } as any;
        mgr.handleContextMenu(evt, { tooltips: [] } as any);
        expect(hideTooltip).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`hideTooltip` not invoked / not in options type)

Run: `npx vitest run test/behavior.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `src/behavior.ts`, add to `IHtmlBehaviorOptions`:

```ts
    // Dismiss any active host tooltip on an interaction (cross-filter / context
    // menu). Always-on UX fix — independent of diagnostics. The visual wires it
    // to host.tooltipService.hide(...).
    hideTooltip: () => void;
```

  Call it at the top of `handleSelectionClick`, the clear-catcher click, and `handleContextMenu`:

```ts
    private handleSelectionClick(event: MouseEvent, d: IHtmlEntry) {
        event.preventDefault();
        event.stopPropagation();
        this.options.hideTooltip();
        this.selectionHandler.handleSelection(d, event.ctrlKey);
    }
```

```ts
    handleContextMenu(event: MouseEvent, d: IHtmlEntry) {
        event.preventDefault();
        event.stopPropagation();
        this.options.hideTooltip();
        event &&
            this.selectionHandler.handleContextMenu(d, {
                x: event.clientX,
                y: event.clientY
            });
    }
```

  In `bindClearCatcher`'s click handler, after `stopPropagation()`:

```ts
                this.options.hideTooltip();
```

- [ ] **Step 4: Wire it in `visual.ts`.** Where the behavior options are assembled (`bindInteractivity`), add:

```ts
                        hideTooltip: () =>
                            this.host.tooltipService.hide({
                                immediately: true,
                                isTouchEvent: false
                            }),
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx vitest run test/behavior.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/behavior.ts src/visual.ts test/behavior.test.ts
git commit -m "fix: dismiss active tooltip on cross-filter / context-menu (always-on)"
```

---

### Unit 7: Instrument cross-filter and drill

**Files:**
- Modify: `src/behavior.ts`
- Test: `test/behavior.test.ts`

- [ ] **Step 1: Write the failing test** (append to `test/behavior.test.ts`)

```ts
import { setArmed, snapshot, resetForTests } from '../src/diagnostics/event-recorder';

describe('host-event instrumentation in behavior', () => {
    beforeEach(() => resetForTests());

    it('records a cross-filter event with tooltip context on selection click', () => {
        setArmed(true);
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), ctrlKey: false } as any;
        mgr.handleSelectionClick?.(evt, { tooltips: [{ displayName: 'Region', value: 'East' }] } as any);
        const s = snapshot();
        expect(s.some((e) => e.type === 'cross-filter' && e.context === 'Region="East"')).toBe(true);
    });

    it('records a drill event with x,y on context menu', () => {
        setArmed(true);
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 320, clientY: 140 } as any;
        mgr.handleContextMenu(evt, { tooltips: [{ displayName: 'Region', value: 'East' }] } as any);
        const s = snapshot();
        expect(s.some((e) => e.type === 'drill' && e.summary.includes('320'))).toBe(true);
    });

    it('records a background drill when the datum is null', () => {
        setArmed(true);
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);
        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 1, clientY: 2 } as any;
        mgr.handleContextMenu(evt, null as any);
        expect(snapshot().some((e) => e.type === 'drill' && e.context === 'background')).toBe(true);
    });
});
```

> Note: `handleSelectionClick` is currently `private`. To test it directly, change it to a non-`private` method (drop the modifier — it's already only called internally) or invoke it through the bound `pointSelection.on('click', …)` callback. The plan drops the `private` modifier on `handleSelectionClick` for testability, consistent with `handleContextMenu` (already non-private).

- [ ] **Step 2: Run it — expect FAIL** (no events recorded)

Run: `npx vitest run test/behavior.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `src/behavior.ts`, import the recorder + formatter:

```ts
import { recordEvent } from './diagnostics/event-recorder';
import { formatTooltipItems } from './diagnostics/host-events';
import { VisualConstants } from './visual-constants';
```

  A small local helper for a datum's bounded context:

```ts
    private pointContext(d: IHtmlEntry | null): string {
        if (!d) return '';
        return formatTooltipItems(
            d.tooltips ?? [],
            VisualConstants.diagnostics.eventContextItems,
            VisualConstants.diagnostics.eventContextCap
        );
    }
```

  Record in `handleSelectionClick` (drop `private`):

```ts
    handleSelectionClick(event: MouseEvent, d: IHtmlEntry) {
        event.preventDefault();
        event.stopPropagation();
        this.options.hideTooltip();
        recordEvent(
            'cross-filter',
            event.ctrlKey ? 'select (multi)' : 'select',
            this.pointContext(d) || undefined
        );
        this.selectionHandler.handleSelection(d, event.ctrlKey);
    }
```

  Record the clear in `bindClearCatcher`'s handler (after `hideTooltip()`):

```ts
                recordEvent('cross-filter', 'cleared');
```

  Record in `handleContextMenu`:

```ts
    handleContextMenu(event: MouseEvent, d: IHtmlEntry) {
        event.preventDefault();
        event.stopPropagation();
        this.options.hideTooltip();
        recordEvent(
            'drill',
            `context-menu @ (${event.clientX},${event.clientY})`,
            d ? this.pointContext(d) || undefined : 'background'
        );
        event &&
            this.selectionHandler.handleContextMenu(d, {
                x: event.clientX,
                y: event.clientY
            });
    }
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run test/behavior.test.ts`
Expected: PASS (cross-filter, drill with x/y, background drill).

- [ ] **Step 5: Commit**

```bash
git add src/behavior.ts test/behavior.test.ts
git commit -m "feat: record cross-filter and drill host events from behavior handlers"
```

---

### Unit 8: Instrument both tooltip paths

**Files:**
- Modify: `src/domain-utils.ts:537-642` (`bindStandardTooltips`, `bindManualTooltips`)
- Test: `test/domain-utils.test.ts`

- [ ] **Step 1: Write the failing test** (append to `test/domain-utils.test.ts`; reuse its `buildContainers` helper)

```ts
import { resolveHover } from '../src/domain-utils';
import {
    setArmed,
    snapshot as evtSnapshot,
    resetForTests as resetEvents
} from '../src/diagnostics/event-recorder';

describe('tooltip host-event instrumentation', () => {
    beforeEach(() => resetEvents());

    it('records a standard tooltip show with source and context', () => {
        setArmed(true);
        const { container, dom } = buildContainers('');
        const node = container.node() as Element;
        const row = dom.window.document.createElement('div');
        node.appendChild(row);
        const sel = select(row).datum({
            tooltips: [{ displayName: 'Region', value: 'East' }],
            identity: {}
        } as any) as any;
        // host stub with a tooltipService
        const host: any = { tooltipService: { show: () => {}, hide: () => {} } };
        resolveHover(sel, host, true);
        sel.dispatch('mouseover');
        const s = evtSnapshot();
        expect(
            s.some(
                (e) =>
                    e.type === 'tooltip' &&
                    e.summary === 'show · standard' &&
                    e.context === 'Region="East"'
            )
        ).toBe(true);
    });
});
```

> Use the file's existing imports (`select` from d3, `buildContainers`). If `resolveHover`'s `mouseover mousemove` binding needs a `d` datum, the `.datum(...)` above supplies it.

- [ ] **Step 2: Run it — expect FAIL** (no tooltip event recorded)

Run: `npx vitest run test/domain-utils.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `src/domain-utils.ts`, import the recorder + formatter:

```ts
import { recordTooltipEvent } from './diagnostics/event-recorder';
import { formatTooltipItems, TooltipItem } from './diagnostics/host-events';
```

  A local helper:

```ts
const tooltipContext = (items: TooltipItem[]): string =>
    formatTooltipItems(
        items ?? [],
        VisualConstants.diagnostics.eventContextItems,
        VisualConstants.diagnostics.eventContextCap
    );
```

  In `bindStandardTooltips`, in the `mouseover mousemove` handler where `tooltipService.show(options)` is called, after the show:

```ts
            recordTooltipEvent('show', 'standard', tooltipContext(d.tooltips));
```

  and in its `mouseout` handler after `tooltipService.hide(...)`:

```ts
        recordTooltipEvent('hide', 'standard', '');
```

  In `bindManualTooltips`, after `tooltipService.show(options)` (inside the `dataItems.length > 0` block):

```ts
            recordTooltipEvent('show', 'manual', tooltipContext(dataItems));
```

  and in its `mouseout` handler after the hide:

```ts
        recordTooltipEvent('hide', 'manual', '');
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run test/domain-utils.test.ts`
Expected: PASS (standard tooltip show recorded with source+context); existing domain-utils tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/domain-utils.ts test/domain-utils.test.ts
git commit -m "feat: record tooltip host events from both standard and manual binders"
```

---

### Unit 9: Visual wiring, snapshot, and labels

**Files:**
- Modify: `src/visual.ts` (arm recorder + record `update`; snapshot `events`; read `clearEvents`; `diagnosticsLabels`)
- Modify: `src/diagnostics/diagnostics-snapshot.ts` (`buildSnapshot` input gains `events`)
- Modify: `stringResources/en-US/resources.resjson`
- Test: `test/diagnostics-snapshot.test.ts`, `test/diagnostics-wiring.test.ts`

- [ ] **Step 1: Write the failing test** (append to `test/diagnostics-snapshot.test.ts`; the file's `labels` stub must gain the new keys too)

```ts
it('passes host events through into the snapshot', () => {
    const events = [{ ts: 1, type: 'update' as const, summary: 'type=Data' }];
    const snap = buildSnapshot({ ...base, rawHtml: 'x', events });
    expect(snap.events).toBe(events);
});
```

  (Add `events: []` to the `base` object in that file, and the ten new label keys to its `labels` stub — mirror U4.)

- [ ] **Step 2: Run it — expect FAIL** (`buildSnapshot` drops `events`)

Run: `npx vitest run test/diagnostics-snapshot.test.ts`
Expected: FAIL (`snap.events` is undefined).

- [ ] **Step 3: Implement `buildSnapshot`.** In `src/diagnostics/diagnostics-snapshot.ts`, add `events: HostEvent[]` to the input type and pass it through:

```ts
export const buildSnapshot = (input: {
    rawHtml: string;
    sanitizer: SanitizerCapture;
    console: ConsoleEntry[];
    events: HostEvent[];
    labels: DiagnosticsLabels;
    sanitizeEnabled: boolean;
    initialTab?: string;
}): DiagnosticsSnapshot => {
    // …existing truncation…
    return {
        sanitizer: input.sanitizer,
        console: input.console,
        events: input.events,
        labels: input.labels,
        // …rest unchanged…
    };
};
```

  (Import `HostEvent` from `./types`.)

- [ ] **Step 4: Wire `visual.ts`.** Add imports:

```ts
import {
    setArmed as setEventsArmed,
    snapshot as eventsSnapshot,
    clear as clearEventsBuffer,
    recordEvent
} from './diagnostics/event-recorder';
import { describeUpdateType } from './diagnostics/host-events';
```

  In `update()`, at the `diagActive` block (after `this.diagActive = diagActive;`, alongside `installConsoleCapture()`):

```ts
        setEventsArmed(diagActive);
        if (diagActive) {
            installConsoleCapture();
            recordEvent(
                'update',
                `type=${describeUpdateType(options.type)}, viewMode=${options.viewMode}`,
                `rows=${options.dataViews?.[0]?.table?.rows?.length ?? options.dataViews?.[0]?.categorical?.categories?.[0]?.values?.length ?? 0}`
            );
        }
```

  In `openDiagnostics()`, add `events` to the `buildSnapshot({...})` call:

```ts
            events: eventsSnapshot(),
```

  In the `.then((result) => {...})` handler, after the `clearConsole` branch, add:

```ts
                if (rs?.clearEvents) {
                    clearEventsBuffer();
                }
```

  and extend the `rs` cast type with `clearEvents?: boolean`.

  In `diagnosticsLabels()`, add the ten new keys (mirroring the existing `t('Diagnostics_*')` lines):

```ts
            tabEvents: t('Diagnostics_TabEvents'),
            eventsEmpty: t('Diagnostics_EventsEmpty'),
            colTime: t('Diagnostics_ColTime'),
            colEvent: t('Diagnostics_ColEvent'),
            colContext: t('Diagnostics_ColContext'),
            eventsClear: t('Diagnostics_EventsClear'),
            evtUpdate: t('Diagnostics_EvtUpdate'),
            evtCrossFilter: t('Diagnostics_EvtCrossFilter'),
            evtTooltip: t('Diagnostics_EvtTooltip'),
            evtDrill: t('Diagnostics_EvtDrill')
```

- [ ] **Step 5: Add the resjson keys.** In `stringResources/en-US/resources.resjson`, after `"Diagnostics_RawBannerSanitized"`:

```json
    "Diagnostics_TabEvents": "Events",
    "Diagnostics_EventsEmpty": "No host events captured.",
    "Diagnostics_ColTime": "time",
    "Diagnostics_ColEvent": "event",
    "Diagnostics_ColContext": "context",
    "Diagnostics_EventsClear": "Clear",
    "Diagnostics_EvtUpdate": "update",
    "Diagnostics_EvtCrossFilter": "cross-filter",
    "Diagnostics_EvtTooltip": "tooltip",
    "Diagnostics_EvtDrill": "drill",
```

  (Ensure the preceding line keeps its trailing comma and the JSON stays valid.)

- [ ] **Step 6: Run the tests — expect PASS**

Run: `npx vitest run test/diagnostics-snapshot.test.ts test/diagnostics-wiring.test.ts`
Expected: PASS (snapshot carries events; the visual still constructs). Then `npx vitest run` for the full unit suite.

- [ ] **Step 7: Commit**

```bash
git add src/visual.ts src/diagnostics/diagnostics-snapshot.ts stringResources/en-US/resources.resjson test/diagnostics-snapshot.test.ts
git commit -m "feat: arm recorder + record update, carry events in snapshot, localize Events labels"
```

---

### Unit 10: Verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: all green (existing + new recorder/host-events/behavior/dialog/snapshot tests).

- [ ] **Step 2: Lint + format**

Run: `npx eslint .` then `npm run prettier-check`
Expected: eslint 0; prettier clean. (Fix any formatting in the files this plan touched only.)

- [ ] **Step 3: Full gate (integration + docs)**

Run: `npm run test:all`
Expected: unit + Playwright integration + `docs:check` all green — **zero sanitizer-rule churn** (no `docs/sanitization-rules.md` / `test-uat/*.csv` diff).

- [ ] **Step 4: Package all three editions**

Run: `npm run package` then `npm run package-standard` then `npm run package-standalone`
Expected: all three `.pbiviz` build. Restore `capabilities.json` / `config/visual.json` if the custom packager leaves them dirty (`git checkout -- capabilities.json config/visual.json`).

- [ ] **Step 5: Confirm no capabilities change**

Run: `git status --short`
Expected: no `capabilities.json` change attributable to this feature; only the intended source/test/doc/style files.

- [ ] **Step 6: Commit (if any formatting fixes were made)**

```bash
git add <only the files you reformatted>
git commit -m "chore: verification gate — full suite, lint, all editions package"
```

---

## System-Wide Impact

- **`diagnostics-dialog.ts`** gains a fourth tab and a frozen-header layout; existing tabs are restructured (`[header]+[.hc-tab-body]`) but their public selectors (`.hc-banner`, `.hc-doc-link`, `.hc-pre`, `.hc-log`, `.hc-copy`) are preserved, so existing tests and the visual's result round-trip are unaffected beyond the `display: flex` change.
- **`behavior.ts`** gains a required `hideTooltip` in `IHtmlBehaviorOptions` — every construction site (the visual's `bindInteractivity`) must supply it (done in U6). `handleSelectionClick` loses its `private` modifier (test access).
- **`domain-utils.ts`** `resolveHover` now has a one-way dependency on the recorder; no signature changes.
- **`visual.ts`** arms/records on the existing `diagActive` gate — no new gate, no new lifecycle.
- **No `capabilities.json`, data-role, or privilege change.** No sanitizer-rule change. The recorder buffer is iframe-scoped and bounded.

---

## Risks

- **Event noise** (`update`, hover `tooltip`). Mitigated by tooltip dedup (U3), the ring-buffer cap, and per-type filters (U4); tune `eventBufferCap` and whether `tooltip` defaults its filter off in UAT.
- **`d.tooltips` empty/null.** `pointContext`/`tooltipContext` return `''` (→ `undefined` context) and the drill/clear paths use generic labels (`background`, `cleared`); covered in U7.
- **Frozen-header height chain.** The flex scroll needs a definite height from the modal's fixed surface to `.hc-diagnostics`; the jsdom tests assert structure, not scroll — **verify scrolling in Desktop + Service UAT**.
- **`VisualUpdateType` value drift.** `describeUpdateType` reads the enum members (not magic numbers), so it tracks the pinned API; the numeric fallback covers any unmapped flag.
- **Tooltip-hide vs context menu timing** on right-click — confirm the hover tooltip dismisses cleanly around the menu in UAT.

---

## Documentation / Operational Notes

- The two `docs/v2/` guides already describe Diagnostics generically; after UAT, add a short "Events tab" paragraph to `HTML-Content-v2-Guide.md` and note the Console/Events debugging path in `scripting-unsanitized-edition.md` (the v2 docs are the user's WIP — coordinate, don't overwrite).
- This branch (`feat/diagnostics-host-events`) is cut from `2.0.0`; merge target is `2.0.0`.
- After merge, consider a `/ce-compound` capture of the passive-recorder + always-on-fix-riding-a-dev-tool pattern if it proves reusable.
