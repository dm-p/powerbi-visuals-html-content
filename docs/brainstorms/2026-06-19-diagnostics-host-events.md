---
title: Diagnostics — host event log + frozen headers + tooltip dismissal
date: 2026-06-19
status: approved
related_issues: []
---

# Diagnostics — host event log + frozen headers + tooltip dismissal

Builds on the shipped diagnostics dialog ([2026-06-18-diagnostics-dialog.md](2026-06-18-diagnostics-dialog.md), merged in #165). Three related changes:

1. **Host event log** — a new **Events** tab recording visual host events (update, cross-filter, tooltip, drill) at a debug level, captured only while diagnostics is armed.
2. **Tooltip dismissal** (always-on UX fix) — cancel an active hover tooltip when a cross-filter or drill/context-menu action is invoked.
3. **Frozen dialog headers** — freeze the pivot tabs and each tab's banner/controls so only the tab body scrolls.

## Problem

The diagnostics dialog surfaces what the sanitizer removed, captured console output, and the processed raw HTML. It does **not** surface the visual's own interaction with the Power BI host. When an author is debugging why the visual re-rendered, why a cross-filter did or didn't fire, or what a tooltip/drill interaction carried, there is no record — the host calls (`update`, selection, tooltip show/hide, context-menu) happen invisibly. Power BI Desktop has no dev tools to observe them.

Two adjacent issues surface alongside this:

- **Lingering tooltips.** When a hover tooltip is showing and the author clicks (cross-filter) or right-clicks (context-menu / drill), the tooltip is **not** dismissed — it can hang over the context menu or persist after the selection. The interaction handlers in [behavior.ts](../../src/behavior.ts) never tell the tooltip service to hide.
- **Scrolling chrome.** In the current dialog the whole tab panel scrolls, so a tab's banner/controls (the Raw HTML Copy button, the Console toolbar) scroll out of view when the body overflows. With a new Events toolbar added, fixed chrome becomes worth doing properly.

## Users and outcome

**Primary user:** a report author (or the maintainer) building/debugging a templated, cross-filtering visual in Power BI Desktop or Service, with diagnostics enabled in edit mode.

**Outcome that changes:**

- Today: host interactions are invisible; an active tooltip lingers through clicks/right-clicks; dialog controls scroll away with the content.
- After: an **Events** tab shows a time-ordered, filterable log of `update` / `cross-filter` / `tooltip` / `drill` events with bounded context; tooltips dismiss cleanly on cross-filter/drill; the pivot and per-tab headers stay fixed while only bodies scroll.

## Goals

1. **Host event log.** Record `update` (type + viewMode + dataView shape), `cross-filter`, `tooltip` (show/hide), and `drill` (context-menu request) events, each with bounded, human-readable context.
2. **Passive, armed-only capture.** Recording is a no-op unless diagnostics is active — same zero-cost-when-off posture as the existing sanitizer sink and console tee. No behaviour change when off.
3. **Structured Events tab.** A dedicated tab (`time · type · context`) with a Clear button and per-type filter checkboxes, mirroring the Console tab's affordances.
4. **Tooltip dismissal (always-on).** Cancel an active hover tooltip on cross-filter, clear-selection, and drill/context-menu — independent of diagnostics.
5. **Frozen headers.** The pivot tab bar and each tab's banner/controls stay fixed; only the tab body scrolls.
6. **Reuse, don't reinvent.** Mirror the existing diagnostics modules (`console-capture.ts` ring buffer, the snapshot/result round-trip, localized labels in the snapshot, pure-DOM rendering, all editions).
7. **Certification-safe.** No new data role, privilege, or `capabilities.json` surface. Pure-DOM dialog UI (no innerHTML).

## Non-goals

- **Logging host-side outcomes the visual can't observe.** Drill/drillthrough *navigation* happens host-side and is not reported back to the visual; the Events tab logs the **context-menu request** (the visual's drill entry point), not the resulting page navigation.
- **Persistence / telemetry.** The event buffer is an in-memory, iframe-scoped ring buffer for the current session; nothing is persisted or sent anywhere.
- **A verbosity toggle.** Context is "rich but bounded" with fixed caps; no per-event verbosity control (rejected as YAGNI for a dev tool).
- **Raw selection identities / model internals.** Context is sourced from `d.tooltips` (already-formatted field=value pairs the visual already shows), not from serialized `ISelectionId` or dataView internals.
- **Reworking tooltips beyond dismissal.** The only tooltip change is dismissing on cross-filter/drill; the existing hover/show logic is untouched.

## Key technical decisions

1. **A separate Events tab, not a 5th console level.** Host events are structured (type + context) and benefit from their own columns, filter, and retrieval path. They go in a dedicated tab rather than being flattened into the Console's text lines. *(Chosen over interleaving with console output.)*

2. **A passive event recorder, mirroring the existing sinks.** A module-level `src/diagnostics/event-recorder.ts` exposes `recordEvent(type, context)` / `snapshot()` / `clear()` / `resetForTests()` over a bounded ring buffer. `recordEvent` is a **no-op unless armed**; the visual arms it in `update()` exactly where console capture installs, gated on `diagActive` (toggle ON + `allowModalDialog` + edit mode). Spread-out call sites just call `recordEvent(...)`; they never import dialog/UI code. *(Same philosophy as `diagnostics-sink.ts` / `console-capture.ts`.)*

3. **`d.tooltips` is the context source.** The row datum `IHtmlEntry` already carries `tooltips: VisualTooltipDataItem[]` (displayName + formatted value) — the exact field=value pairs the visual already surfaces in its own tooltips. Reusing it for event context means the Events tab discloses nothing the visual doesn't already show, and the values are pre-formatted. Context strings are capped per item and limited to the first N items with a `(+k more)` marker.

4. **All four events have existing hook points — no net-new wiring.**
   - `update` → [visual.ts](../../src/visual.ts) `update()`.
   - `cross-filter` → [behavior.ts](../../src/behavior.ts) `handleSelectionClick` + clear-catcher click.
   - `drill` → [behavior.ts](../../src/behavior.ts) `handleContextMenu` (the context-menu request is the drill/drillthrough entry point).
   - `tooltip` → [domain-utils.ts](../../src/domain-utils.ts) `resolveHover` show/hide.

5. **Tooltip dismissal via a narrow `hideTooltip` callback.** [behavior.ts](../../src/behavior.ts) has no host dependency today. Rather than couple it to `tooltipService`/`TooltipShowOptions`, pass a `hideTooltip: () => void` into `IHtmlBehaviorOptions`; the visual wires it to `host.tooltipService.hide({ immediately: true, isTouchEvent: false })`. The dismissal is **always-on** (not diagnostics-gated); the `recordEvent` call at the same site **is** gated. The programmatic hide is **not** logged as its own `tooltip` event — it's implied by the cross-filter/drill event — keeping the log quiet and honest.

6. **Frozen headers via flexbox; active panel becomes a flex column.** Each tab is `[fixed header] + [scrolling body]`. `.hc-diagnostics` is a full-height column flex; `.hc-tabbar` is `flex: none`; `.hc-panels` is `flex: 1; min-height: 0` (the `min-height: 0` is what allows the body to scroll instead of growing the dialog). Each tab panel is a column flex with a `flex: none` header region and a `flex: 1; overflow: auto; min-height: 0` body region. `activate()` sets the active panel's display to **`flex`** (was `block`). The dialog's fixed 900×600 surface must propagate `height: 100%` down to `.hc-diagnostics` — verified in UAT.

7. **Events tab is always present.** Unlike the Sanitizer tab (sanitizing editions only), host events apply to every edition, so the Events tab shows in all builds.

8. **Bounded like every other channel.** A tunable `eventBufferCap` (default ~200, like the console) ring buffer; each context string capped; first-N items per event. Keeps the cross-iframe `initialState` payload bounded.

9. **Tooltip `show` de-duplication.** `tooltip` `show` fires on mousemove and is chatty. A tooltip event is recorded only when its `(phase, source, context)` differs from the **last recorded tooltip event** (`source` per Decision 10): consecutive `show`s over the same point collapse to one, while an intervening `hide` (or a `show` over a *different* point) re-enables logging the next identical `show` — matching "show, hide, show same data is OK to log." An intervening **non-tooltip** event (e.g. `update`) does **not** re-enable it, because the comparison is against the last *tooltip* event, not the last global event. The dedup lives in the recorder as a dedicated `recordTooltipEvent(phase, source, context)` holding a `lastTooltipKey`; it resets on `clear()` / `resetForTests()`. The same comparison collapses repeated `hide`s. (Only `tooltip` is de-duplicated; `update` / `cross-filter` / `drill` always record.)

10. **Both tooltip binding paths are instrumented.** [domain-utils.ts](../../src/domain-utils.ts) `resolveHover` binds **two** tooltip sources: `bindStandardTooltips` (on the row elements, driven by the view model's `d.tooltips` + `d.identity`) and `bindManualTooltips` (on author content matching the manual-tooltip class, driven by `data-*` title/value attributes, no identity). Both call `tooltipService.show`/`hide`, so both are instrumented, and each event carries a `source: 'standard' | 'manual'` tag (shown in the row, e.g. `show · standard`). Because a manual-tooltip element nested in a row can bubble to the standard handler too, the `source` tag — and its place in Decision 9's dedup key — keeps the two distinguishable rather than collapsing them together.

## High-level design

### Event model

```ts
type HostEventType = 'update' | 'cross-filter' | 'tooltip' | 'drill';

interface HostEvent {
  ts: number;        // Date.now()
  type: HostEventType;
  summary: string;   // short, e.g. "type=Data+Resize, viewMode=Edit"
  context?: string;  // bounded detail, e.g. 'Employee[FullName]="A. Smith" (+1 more)'
}
```

### Capture flow

```
host calls update() / user clicks / hovers / right-clicks
  └─ call site builds (summary, context) and calls recordEvent(type, …)
       └─ no-op unless armed; else push to ring buffer (capped)
icon click / Ctrl+D
  └─ snapshot.events = eventRecorder.snapshot()  (alongside sanitizer/console/rawHtml)
       └─ dialog renders the Events tab from the snapshot (read-only)
            └─ Clear → result.clearEvents → visual calls eventRecorder.clear() on close
```

### Hook points and captured context

| Event | Hook point | summary / context |
|---|---|---|
| **update** | `visual.ts update()` | `VisualUpdateType` flag **names** (decode bitmask: Data/Resize/ViewMode/Style/Resize-end/All), `viewMode`, dataView row count + value/measure count |
| **cross-filter** | `behavior.ts` `handleSelectionClick` + clear-catcher | selected row's `d.tooltips` field=value (first N, `+k more`) + multi-select (Ctrl) flag; or `cleared` |
| **tooltip** | `domain-utils.ts` `resolveHover` — **both** `bindStandardTooltips` (rows; `d.tooltips` + identity) and `bindManualTooltips` (author DOM via `data-*`; parsed `dataItems`, no identity) | `show` / `hide` + `source` (standard\|manual) + field=value (first N); **de-duplicated** per Decision 9 (a repeat `show` over the same source+data is suppressed unless a `hide` intervened) |
| **drill** | `behavior.ts` `handleContextMenu` | point's `d.tooltips` field=value (or `background` when datum is null) + cursor x/y |

A pure `describeUpdateType(type: number): string` decodes the `VisualUpdateType` bitmask to names; table-driven and unit-tested.

### Tooltip dismissal (always-on)

- `IHtmlBehaviorOptions` gains `hideTooltip: () => void`.
- `handleSelectionClick`, the clear-catcher click handler, and `handleContextMenu` call `hideTooltip()` before delegating to the selection handler.
- `visual.ts` supplies `() => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false })` when building the behavior options.

### Events tab (dialog)

- New tab after **Console**, always present. Structured rows: `time · type · context`, monospace, reusing the `.hc-log`/`.hc-time` styles.
- Toolbar mirroring Console: **Clear** button + per-type filter checkboxes (`update` / `cross-filter` / `tooltip` / `drill`), default all on; instant in-dialog show/hide.
- Empty state ("No host events captured."). Clear empties the display and requests `clearEvents` via the result channel; the visual clears the live buffer on close (same pattern as console clear).
- All labels localized and passed in the snapshot (`DiagnosticsLabels` + `Diagnostics_*` resjson keys).

### Frozen headers

- Markup: each tab builder wraps its scrollable content in a body element (`.hc-tab-body`), with the banner/toolbar as a sibling header above it.
- CSS (in `style/visual.less`): the flexbox layout from Decision 6.
- `renderPanel` `activate()` toggles the active panel to `display: flex` (column) instead of `block`.

| Tab | Frozen header | Scrolling body |
|---|---|---|
| Raw HTML | banner + Copy + truncation note | the `<pre>` |
| Sanitizer | docs banner | removals table (+ overflow note) |
| Console | toolbar (Clear + level filters) | log lines |
| Events | toolbar (Clear + type filters) | event rows |

## Files and architecture

New:
- `src/diagnostics/event-recorder.ts` — armed-state host-event ring buffer (`recordEvent`, `recordTooltipEvent` with the Decision 9 dedup, `snapshot`, `clear`, `resetForTests`) + the `describeUpdateType` decoder (or a sibling `host-events.ts` for the pure decoder/formatters).

Touched:
- [src/diagnostics/types.ts](../../src/diagnostics/types.ts) — `HostEvent`, `HostEventType`; extend `DiagnosticsLabels` (tab + columns + per-type filter + Clear + empty); add `events: HostEvent[]` to `DiagnosticsSnapshot`.
- [src/diagnostics/diagnostics-dialog.ts](../../src/diagnostics/diagnostics-dialog.ts) — Events tab builder; per-type filter; Clear → result; `activate()` `display: flex`; wrap each tab's body for frozen headers.
- [src/visual.ts](../../src/visual.ts) — arm the recorder in `update()` (gated on `diagActive`); `recordEvent('update', …)`; add `events` to the snapshot; read `clearEvents` from the result; wire `hideTooltip` into the behavior options.
- [src/behavior.ts](../../src/behavior.ts) — `hideTooltip` in options; call it on click/clear/contextmenu; `recordEvent('cross-filter' | 'drill', …)`.
- [src/domain-utils.ts](../../src/domain-utils.ts) — `recordTooltipEvent(phase, source, context)` in **both** `bindStandardTooltips` (`source: 'standard'`) and `bindManualTooltips` (`source: 'manual'`), at their show + hide sites.
- [src/visual-constants.ts](../../src/visual-constants.ts) — `eventBufferCap`, per-context caps, first-N.
- [stringResources/en-US/resources.resjson](../../stringResources/en-US/resources.resjson) — Events tab + column + filter + Clear + empty labels.
- [style/visual.less](../../style/visual.less) — frozen-header flex layout; Events rows reuse existing log styles.

No `capabilities.json` change expected. `"privileges": []` stays.

## Testing

- **Recorder** (mirrors `console-capture.test.ts`): no-op when disarmed; ring-buffer cap + eviction; `clear`; `snapshot` copy; `resetForTests`.
- **Tooltip dedup (Decision 9):** `show(A), show(A)` records once; `show(A), hide, show(A)` records all three; `show(A), show(B)` records both; an intervening `update` between two `show(A)` does **not** re-enable the second; a `standard` `show(A)` and a `manual` `show(A)` are **not** de-duplicated against each other (distinct `source`); `clear()` resets the dedup so the next `show` logs.
- **Both tooltip paths (Decision 10):** an event is recorded for `bindStandardTooltips` and for `bindManualTooltips`, each tagged with the correct `source` and context derived from the right place (`d.tooltips` vs the parsed `data-*` items).
- **`describeUpdateType`:** table-driven over single + combined `VisualUpdateType` flags → expected name strings.
- **Event shaping:** each type's `summary`/`context` formatting, including first-N + `(+k more)` and per-string caps; `background`/`cleared` cases.
- **Dialog:** Events tab renders rows (time/type/context); per-type filter hides/shows by type; Clear empties + reports `clearEvents`; empty state; tab present in all editions.
- **Frozen headers:** active panel uses `display: flex`; header region present as a sibling of the scrolling body; lossless body content (e.g. Raw HTML `<pre>` text unchanged). (Actual overflow/scroll behaviour is visual — confirmed in UAT.)
- **Tooltip dismissal:** `behavior.ts` invokes `hideTooltip` on click, clear-catcher click, and contextmenu (spy); the dismissal path is independent of `diagActive`.
- **Gating:** disarmed ⇒ `recordEvent` no-ops and the snapshot's `events` is empty; armed only when `diagActive`.
- `npm test` for fast feedback; `npm run test:all` as the final gate; zero sanitizer-rule churn expected; all three editions package. The modal and real host events can't run in jsdom → covered by UAT in Desktop + Service.

## Risks and open questions

- **Event noise / volume.** `update` and `tooltip` (hover) can fire frequently. Mitigated by tooltip `show` de-duplication (Decision 9), the ring-buffer cap, and per-type filters; the default `eventBufferCap` and whether `tooltip` should default its filter **off** are tuned in UAT.
- **`d.tooltips` availability.** Cross-filter/drill context relies on the datum carrying tooltips; when a row has none (or the datum is null for background/clear), fall back to a generic label (`background`, `cleared`, or an identity key) rather than empty context.
- **Frozen-header height chain.** The flexbox scroll depends on a definite height propagating from the modal's fixed surface down to `.hc-diagnostics`; verify in Desktop + Service (the one cross-cutting CSS risk).
- **Tooltip-hide timing.** Confirm `hideTooltip()` before delegating to the selection handler doesn't race the context menu on right-click (the menu should appear after the hover tooltip is dismissed). Verify in UAT.
- **Drill semantics.** The Events tab logs the context-menu *request*; reviewers/authors should understand it is not a confirmation that drillthrough navigation occurred.
