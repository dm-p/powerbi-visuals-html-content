---
title: 'feat: diagnostics dialog (developer tooling)'
type: feat
status: approved
date: 2026-06-18
origin: docs/brainstorms/2026-06-18-diagnostics-dialog.md
---

# feat: diagnostics dialog (developer tooling)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan unit-by-unit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an off-by-default **Enable diagnostics** toggle that surfaces an icon (Desktop + Service only) opening a Power BI **modal dialog** with three tabs — **Sanitizer** (what the sanitizer stripped + the rule), **Console** (captured `console.*` from author scripts and the visual's own warnings), and **Raw HTML** (the existing serialized view, shared DRY) — with every snapshot channel bounded for the multi-MB content authors push through this visual.

**Architecture:** A **passive diagnostics sink** (`beginCapture`/`recordRemoval`/`endCapture`, a no-op unless armed) is fed from each existing sanitizer rejection site, so sanitize output stays byte-identical when off and signatures don't change. A **console tee** ring-buffers `console.*` inside the visual's own sandboxed iframe. On icon click the visual assembles a **bounded snapshot** `{ sanitizer, console, rawHtml }` and passes it as `openModalDialog` `initialState` to a registered `DiagnosticsDialog` that renders the tabs purely from that snapshot (snapshot-at-open; the modal freezes the underlying render). Show Raw HTML is untouched; the dialog's Raw HTML tab reuses the existing `getRawHtml`/`domSerialize` core.

**Tech Stack:** TypeScript, powerbi-visuals-api 5.11.0 (`openModalDialog`, `IDialogHost`, `DialogConstructorOptions`, `hostCapabilities.allowModalDialog`, `CustomVisualHostEnv`), powerbi-visuals-utils-formattingmodel 6.0.1, d3-selection, DOMPurify, postcss, pretty, vitest (jsdom), Playwright, pbiviz.

---

## Summary

Power BI Desktop has no browser dev tools, so authors get no signal when the sanitizer strips their content (every rejection in [sanitize-pipeline.ts](../../src/sanitize-pipeline.ts) is a silent `hookEvent.keepAttr = false`) or when their standalone-edition scripts log to a console they can't open. This plan adds a developer diagnostics surface: a format toggle (`enableDiagnostics`, off by default) gates an icon, gated again on `host.hostCapabilities.allowModalDialog` (true only in Desktop + Service), which opens a host modal dialog with Sanitizer / Console / Raw HTML tabs. Instrumentation is **passive** — a module-level sink records removals only when armed, proven byte-identical to today when disarmed — and every snapshot channel is **capped** (raw HTML ~512 KB with a marker, sanitizer entries ~1000 with an overflow count enforced at capture time, console ~200 lines + per-line cap) so a tens-of-MB render can't blow the `initialState` payload. Eleven units: types/constants → sink → DOMPurify instrumentation → CSS instrumentation → console capture → highlighter → snapshot+gating helpers → dialog renderer/registration → format toggle+fingerprint → visual wiring → verification gate. Show Raw HTML and the DOMPurify ruleset are untouched throughout.

---

## Problem Frame

The only existing debug surface is the **Show Raw HTML** toggle ([resolveForRawHtml](../../src/domain-utils.ts#L374) → in-canvas `<textarea>` via [getRawHtml](../../src/domain-utils.ts#L1040)/[domSerialize](../../src/domain-utils.ts#L319)), which shows the post-sanitize DOM but says nothing about *what was removed* or *what a script logged*. The earlier Show-Raw-HTML work explicitly deferred a "what was removed" diagnostic over an oracle concern that does not apply to an author-armed tool over open-source rules ([show-raw-html solution doc](../solutions/ui-bugs/show-raw-html-dev-tools-serializer-2026-05-15.md)). Full rationale, users, the nine key decisions, and the layout: [origin brainstorm](../brainstorms/2026-06-18-diagnostics-dialog.md).

---

## Requirements

- R1. A format toggle `enableDiagnostics` (default **off**), added as a slice in `ContentFormattingCardBehavior` **after** `showRawHtml` — nothing moved or removed; `showRawHtml` and all persisted properties untouched. *(origin: §B, Decision 1)*
- R2. The diagnostics icon renders only when `enableDiagnostics` is on **and** `host.hostCapabilities.allowModalDialog === true` (the Desktop+Service gate). Toggle is the only author-facing gate (no edit-mode gate). *(origin: Decision 3)*
- R3. Clicking the icon opens a host modal dialog via `host.openModalDialog(DiagnosticsDialog.id, opts, snapshot)`; a registered `DiagnosticsDialog` renders three tabs purely from the `initialState` snapshot (snapshot-at-open). *(origin: §C, Decision 4)*
- R4. **Sanitizer transparency:** a passive sink records each removal (attribute, element, CSS declaration, and DOMPurify-core tag) with a rule label. Sanitize output is **byte-identical** with capture armed vs disarmed; the DOMPurify config and CSS rules are unchanged. *(origin: §D, Decision 5–6)*
- R5. **Console capture:** when armed, `console.log/info/warn/error` are teed into a bounded ring buffer (always calling through), scoped to the visual's own sandboxed iframe; captures author script output and the visual's own `console.warn`s. *(origin: §E, Decision 7)*
- R6. **DRY raw HTML:** the dialog's Raw HTML tab reuses the existing `getRawHtml`/`domSerialize` core; the in-canvas Show Raw HTML keeps using the same function and stays **untruncated**. The dialog tab adds dependency-free colorization with a size-threshold plain-text fallback; **copy** yields the raw string. *(origin: §F, Decision 8)*
- R7. **Bounded snapshot:** every channel is capped before it enters `initialState` — raw HTML ~512 KB with a `… [truncated]` marker, sanitizer entries ~1000 capped at *capture* time with an overflow count, console ~200 lines + ~2000-char per-line cap. Caps are tunable constants. *(origin: Decision 9)*
- R8. **Passive instrumentation:** `recordRemoval` is a no-op unless armed; no sanitize/CSS signature changes; ~zero cost when off. *(origin: Decision 5)*
- R9. **Zero sanitizer-rule churn:** `docs/sanitization-rules.md` and `test-uat/*.csv` untouched, DOMPurify config unchanged (`npm run docs:check` green); all three editions package; existing unit + integration suites stay green. *(origin: Goal 6, R10 of templating precedent)*
- R10. **Certification-safe:** no new data role, no new privileges, no new `capabilities.json` object (the dialog is code-registered). `"privileges": []` stays. *(origin: Goal 8)*

---

## Scope Boundaries

- No mobile / embed / publish-to-web support — the feature is intentionally absent where `allowModalDialog` is false.
- No live streaming into the dialog — snapshot-at-open only; "refresh" = close & reopen.
- No removal or rework of Show Raw HTML — only its raw-HTML core is shared.
- No editing/round-tripping from the dialog — read-only diagnostics.
- No logging framework/telemetry — the console buffer is in-memory, session-only, sent nowhere.
- No syntax-highlighter dependency (highlight.js/Prism) and no DOM virtualization — tiny hand-rolled highlighter + native `<pre>` scroll, made viable by R7 truncation.
- No change to the DOMPurify ruleset, the CSS sanitizer *rules*, or the sanitizer fixture corpus (`test-uat/*.csv`). Instrumentation observes; it does not decide.

---

## Context & Research

### Relevant code and patterns

- [src/sanitize-pipeline.ts](../../src/sanitize-pipeline.ts) — `withSanitizerHooks(run, options)` registers the two hooks and runs `run(purify)`. Every `hookEvent.keepAttr = false; return;` in the `uponSanitizeAttribute` hook, the on*-handler `parentNode.removeChild` in `uponSanitizeElement`, and `purify.removed` after `purify.sanitize(...)` are the instrumentation sites (U3). `getSanitizedContent` and `sanitizeFragmentInPlace` are the two `run` call sites that can read `purify.removed`.
- [src/css-sanitizer.ts:228-246](../../src/css-sanitizer.ts#L228-L246) — `sanitizeCss` walks at-rules/rules/decls and `.remove()`s violators; [266-271](../../src/css-sanitizer.ts#L266-L271) the defense-in-depth final pass drops the whole block. These `.remove()`/drop points are the CSS instrumentation sites (U4).
- [src/domain-utils.ts:319-367](../../src/domain-utils.ts#L319-L367) `domSerialize`, [1040-1079](../../src/domain-utils.ts#L1040-L1079) `getRawHtml`, [374-395](../../src/domain-utils.ts#L374-L395) `resolveForRawHtml` — the shared raw-HTML core the dialog reuses (U8/U10); unchanged by this plan.
- [src/visual-settings.ts:62-108](../../src/visual-settings.ts#L62-L108) `ContentFormattingCardBehavior` — `showRawHtml` ToggleSwitch at [81-86](../../src/visual-settings.ts#L81-L86) is the exact template for `enableDiagnostics` (U9); add to the `slices` array after it.
- [src/render-orchestrator.ts:36-59](../../src/render-orchestrator.ts#L36-L59) `computeRenderFingerprint` — append `enableDiagnostics` so toggling it forces a rebuild that arms+captures fresh data (U9).
- [src/visual.ts:92-130](../../src/visual.ts#L92-L130) constructor, [145-205](../../src/visual.ts#L145-L205) `update`, [212-321](../../src/visual.ts#L212-L321) `buildRenderSteps` — the wiring surface (U10): import the dialog module for registration, install console capture when enabled, render/gate the icon, bracket `orchestrator.render` with `beginCapture`/`endCapture`, open the dialog on click.
- [src/visual-constants.ts:183-251](../../src/visual-constants.ts#L183-L251) — `contentFormatting` defaults and the `dom` selector block; add `enableDiagnostics: false` and a `diagnostics` constant block (U1).
- [test/setup.ts], [test/VisualBuilder.ts], [test/domain-utils.test.ts:573](../../test/domain-utils.test.ts#L573) `buildContainers` helper, [test/sanitize-pipeline.test.ts:1-6](../../test/sanitize-pipeline.test.ts#L1-L6) — vitest (`globals: true`, `environment: 'jsdom'`) + d3/jsdom patterns to mirror.

### Key API facts

- **`host.openModalDialog(dialogId, options, initialState): IPromise<ModalDialogResult>`** — `options: DialogOpenOptions = { title, size?: { width, height }, position?: { type: VisualDialogPositionType }, actionButtons: DialogAction[] }`. `initialState: object` is serialized across the dialog iframe boundary. ([visuals-api.d.ts:1821, 1886-1896](../../node_modules/powerbi-visuals-api/src/visuals-api.d.ts)).
- **Dialog registration needs no webpack entry** (maintainer-confirmed; [MS Learn: create-display-dialog-box](https://learn.microsoft.com/en-us/power-bi/developer/visuals/create-display-dialog-box)). An implementation file in `src/` declares a dialog class with a `static id`, a constructor `(options: DialogConstructorOptions, initialState: object)` where `options = { element: HTMLElement, host: IDialogHost }`, and self-registers via `globalThis.dialogRegistry[id] = TheClass`. The visual must `import` the module so the registration side-effect runs.
- **`hostCapabilities.allowModalDialog?: boolean`** — false in mobile/embed/publish-to-web; true in Desktop + Service. This *is* the environment gate. `host.hostEnv: CustomVisualHostEnv` (bitflag: `Web=1, Desktop=4, …`) is available as optional belt-and-braces. `DialogAction.Close = 0`; `VisualDialogPositionType.Center = 0`.
- **`DOMPurify.removed`** — after a `sanitize()` call, the instance exposes an array of removed `{ element }` / `{ attribute, from }` entries (reset at the start of each `sanitize()`). Read it inside the `run` callback immediately after `purify.sanitize(...)`. Treat its shape defensively (guard with `typeof`/`in` checks) — the hook-level records are the primary source. *(Risk: pinned-version shape; verified in U3.)*
- **Per-visual sandbox:** Power BI hosts each custom visual in its own sandboxed `<iframe>`; `console` is a per-`window` object, so patching `window.console` is scoped to this visual's iframe only — never the parent window, other visuals, or the global console.

### Institutional learnings

- [powerbi-cant-remove-format-properties] (auto memory) — never delete/rename a persisted format property; keep `showRawHtml`, unify the impl. Honored by R1/R6.
- [visual-handles-multi-mb-content] (auto memory) — authors push ~2 MB/measure; bound and truncate anything that serializes rendered output, capping at collection time. Honored by R7 (sink cap is at capture time, not display).
- [docs/solutions/ui-bugs/show-raw-html-dev-tools-serializer-2026-05-15.md](../solutions/ui-bugs/show-raw-html-dev-tools-serializer-2026-05-15.md) — the `domSerialize` contract the Raw HTML tab reuses verbatim.

---

## Key Technical Decisions

- **Passive sink over threaded collectors.** A module-level `diagnostics-sink` with an `armed` flag means `recordRemoval` is a no-op when off, so no sanitize/CSS signature changes and the security boundary is provably unchanged (the byte-identical test in U3). The sink imports nothing from the pipeline — one-way dependency, no cycles.
- **Cap at capture, not just display.** The sink stops appending after `SANITIZER_ENTRY_CAP` and counts overflow, so a 50k-row render that strips an attribute per row bounds memory during capture, not only in the snapshot. Console is a fixed ring buffer for the same reason.
- **Snapshot-at-open.** The modal freezes the underlying render, so a snapshot assembled at click time is sufficient and avoids any cross-iframe channel. `enableDiagnostics` is in the fingerprint so toggling it on forces a rebuild that arms+captures — guaranteeing fresh sanitizer data on first open.
- **Pure helpers carry the tests.** The modal can't render in jsdom, so the testable contract is the pure pieces — sink, console buffer, highlighter, `buildSnapshot`, `shouldShowDiagnosticsIcon`, `renderPanel(element, snapshot)` — and the glue in `visual.ts` stays thin. End-to-end (icon shows, dialog opens) is UAT.
- **DRY raw HTML, asymmetric truncation.** Both surfaces call `getRawHtml`; only the dialog path truncates (it crosses the iframe boundary). The in-canvas textarea keeps its untruncated demo behavior.
- **Localize the pane, not the dialog internals (v1).** The `enableDiagnostics` toggle gets resjson keys like every pane property; in-dialog tab/section labels are English constants for v1 (a dev tool), full localization a documented follow-up.

---

## Open Questions

### Resolved during planning

- *Does the dialog need a webpack entry?* No — `static id` + `globalThis.dialogRegistry` self-registration, packaged config picks it up (maintainer-confirmed + MS doc).
- *How do we restrict to Desktop + Service?* Gate on `allowModalDialog` — it is already false elsewhere. No manual env list needed.
- *Will instrumentation change sanitize output?* No — `recordRemoval` is a no-op when disarmed and side-effect-free when armed; U3's byte-identical test is the proof.

### Deferred to implementation / UAT

- *`DOMPurify.removed` exact entry shape at the pinned version.* U3 guards reads defensively and a test pins the observed shape; the feature degrades to hook-only records if absent.
- *Default cap values (~512 KB / ~1000 / ~200 / ~2000).* Constants; tune in UAT against a deliberately huge report.
- *Icon placement/size* (corner, must not occlude content or the scroll affordance) — finalize in UAT.
- *Whether console capture should install on first-enable vs construction.* U10 installs on first enabled update (idempotent); revisit only if early-script output is missed in UAT.

---

## High-Level Technical Design

```
visual.ts ──(import side-effect)──▶ diagnostics/diagnostics-dialog.ts ──▶ globalThis.dialogRegistry
   │
   │ update(): if enableDiagnostics → sink.beginCapture() … orchestrator.render() … this.cap = sink.endCapture()
   │ resolveContainer step: setIconVisibility(icon, shouldShowDiagnosticsIcon(enabled, allowModalDialog))
   │ icon click: host.openModalDialog(ID, opts, buildSnapshot({ rawHtml: getRawHtml(...), sanitizer: this.cap, console: consoleCapture.snapshot() }))
   ▼
sanitize-pipeline.ts ─ recordRemoval(attr/element) + purify.removed ─┐
css-sanitizer.ts ──── recordRemoval(css) ───────────────────────────┤──▶ diagnostics/diagnostics-sink.ts (armed? append:no-op, cap+overflow)
console (patched) ──── consoleCapture push ──────────────────────────────▶ diagnostics/console-capture.ts (ring buffer)
                                                                         ▼
DiagnosticsDialog(options, snapshot) ─▶ renderPanel(element, snapshot) ─▶ [Sanitizer table] [Console list] [Raw HTML <pre> via highlightHtml]
```

### File structure

| File | Responsibility |
|------|----------------|
| `src/diagnostics/types.ts` | `SanitizerEntry`, `ConsoleEntry`, `ConsoleLevel`, `SanitizerCapture`, `DiagnosticsSnapshot` |
| `src/diagnostics/diagnostics-sink.ts` | armed sink: `beginCapture`/`recordRemoval`/`endCapture`/`isArmed`, entry cap + overflow |
| `src/diagnostics/console-capture.ts` | `install`/`snapshot`/`clear`: console tee + ring buffer + per-line cap |
| `src/diagnostics/highlight-html.ts` | `escapeHtml`, `highlightHtml`: dependency-free colorizer + size-threshold bypass |
| `src/diagnostics/diagnostics-snapshot.ts` | `buildSnapshot` (raw truncation), `shouldShowDiagnosticsIcon`, `createDiagnosticsIcon`/`setIconVisibility` |
| `src/diagnostics/diagnostics-dialog.ts` | `renderPanel(element, snapshot)` + `DiagnosticsDialog` class + registry self-registration |
| `src/sanitize-pipeline.ts` (mod) | `recordRemoval` at each rejection site + `purify.removed` fold-in |
| `src/css-sanitizer.ts` (mod) | `recordRemoval` at each `.remove()`/drop site |
| `src/visual-settings.ts` (mod) | `enableDiagnostics` ToggleSwitch slice |
| `src/render-orchestrator.ts` (mod) | `enableDiagnostics` in the fingerprint |
| `src/visual.ts` (mod) | import dialog, console install, icon gating, capture bracketing, `openModalDialog` |
| `src/visual-constants.ts` (mod) | `enableDiagnostics: false`, `diagnostics` constants block |
| `stringResources/en-US/resources.resjson` (mod) | toggle label + description |

---

## Implementation Units

Each unit: write the failing test, run it red, implement, run it green, commit. Use `npm test -- <file>` for a single file during a unit and `npm test` before each commit. `npm run test:all` is the final gate (U11). Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### U1: Diagnostics types + constants

**Files:**
- Create: `src/diagnostics/types.ts`
- Modify: `src/visual-constants.ts` (add `enableDiagnostics: false` to `contentFormatting`; add a `diagnostics` block)
- Test: `test/visual-constants.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/visual-constants.test.ts`:

```ts
import { VisualConstants } from '../src/visual-constants';

describe('diagnostics constants', () => {
    it('defaults enableDiagnostics off', () => {
        expect(VisualConstants.contentFormatting.enableDiagnostics).toBe(false);
    });
    it('exposes tunable caps and dialog config', () => {
        const d = VisualConstants.diagnostics;
        expect(d.dialogId).toBe('DiagnosticsDialog');
        expect(d.rawHtmlCapBytes).toBeGreaterThan(0);
        expect(d.sanitizerEntryCap).toBeGreaterThan(0);
        expect(d.consoleBufferCap).toBeGreaterThan(0);
        expect(d.consoleLineCap).toBeGreaterThan(0);
        expect(d.highlightSizeLimit).toBeGreaterThan(0);
        expect(d.iconIdSelector).toBe('htmlDiagnosticsToggle');
        expect(d.dialog.size.width).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run it red** — `npm test -- visual-constants` → FAIL (`enableDiagnostics`/`diagnostics` undefined).

- [ ] **Step 3: Implement** — in `src/visual-constants.ts`, add to the `contentFormatting` object (after `noDataMessage`):

```ts
        noDataMessage: 'No data available to display',
        // Off by default. When on (and the host supports modal dialogs) the
        // diagnostics icon appears; it also arms the passive sanitizer sink
        // and console capture. Does not affect rendered output.
        enableDiagnostics: false
```

and add a top-level `diagnostics` block (after the `dom` block):

```ts
    diagnostics: {
        dialogId: 'DiagnosticsDialog',
        iconIdSelector: 'htmlDiagnosticsToggle',
        // Snapshot caps (Decision 9) — bound the cross-iframe initialState
        // for the multi-MB content authors push through this visual.
        rawHtmlCapBytes: 512 * 1024,
        sanitizerEntryCap: 1000,
        consoleBufferCap: 200,
        consoleLineCap: 2000,
        // Above this raw length, skip span-colorization and render plain
        // (escaped) text to avoid a token-span node explosion.
        highlightSizeLimit: 200 * 1024,
        dialog: {
            title: 'HTML Content — Diagnostics',
            size: { width: 900, height: 600 }
        }
    },
```

- [ ] **Step 4: Create `src/diagnostics/types.ts`:**

```ts
/** Shared types for the diagnostics dialog snapshot and its producers. */

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

/** One sanitizer removal: a stripped attribute, element, CSS declaration, or core tag. */
export interface SanitizerEntry {
    kind: 'attr' | 'element' | 'css' | 'tag';
    /** Human-readable subject, e.g. `onclick on <div>` or `<script>`. */
    subject: string;
    /** Rule label that fired, e.g. `event-handler` or `disallowed-url-scheme`. */
    rule: string;
    /** Optional truncated value snippet for context. */
    snippet?: string;
}

export interface SanitizerCapture {
    entries: SanitizerEntry[];
    /** Count of removals dropped after the entry cap was reached. */
    overflow: number;
}

export interface ConsoleEntry {
    ts: number;
    level: ConsoleLevel;
    text: string;
}

export interface DiagnosticsSnapshot {
    sanitizer: SanitizerCapture;
    console: ConsoleEntry[];
    rawHtml: { text: string; truncated: boolean; totalLength: number };
}
```

- [ ] **Step 5: Run green + commit** — `npm test -- visual-constants` → PASS.

```bash
git add src/diagnostics/types.ts src/visual-constants.ts test/visual-constants.test.ts
git commit -m "feat: diagnostics types + tunable constants (enableDiagnostics off)"
```

### U2: Passive sanitizer sink

**Files:**
- Create: `src/diagnostics/diagnostics-sink.ts`
- Test: `test/diagnostics-sink.test.ts`

- [ ] **Step 1: Write the failing test** — `test/diagnostics-sink.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
    beginCapture,
    recordRemoval,
    endCapture,
    isArmed
} from '../src/diagnostics/diagnostics-sink';
import { VisualConstants } from '../src/visual-constants';

const entry = (i: number) =>
    ({ kind: 'attr', subject: `a${i}`, rule: 'r' }) as const;

describe('diagnostics-sink', () => {
    beforeEach(() => endCapture()); // ensure disarmed between tests

    it('is a no-op until armed', () => {
        expect(isArmed()).toBe(false);
        recordRemoval(entry(0));
        beginCapture();
        const cap = endCapture();
        expect(cap.entries).toEqual([]);
        expect(cap.overflow).toBe(0);
    });

    it('collects while armed and disarms on endCapture', () => {
        beginCapture();
        expect(isArmed()).toBe(true);
        recordRemoval(entry(1));
        recordRemoval(entry(2));
        const cap = endCapture();
        expect(isArmed()).toBe(false);
        expect(cap.entries.map((e) => e.subject)).toEqual(['a1', 'a2']);
    });

    it('caps at the entry limit and counts overflow', () => {
        const cap = VisualConstants.diagnostics.sanitizerEntryCap;
        beginCapture();
        for (let i = 0; i < cap + 5; i++) recordRemoval(entry(i));
        const out = endCapture();
        expect(out.entries.length).toBe(cap);
        expect(out.overflow).toBe(5);
    });

    it('beginCapture resets prior state', () => {
        beginCapture();
        recordRemoval(entry(1));
        beginCapture();
        expect(endCapture().entries).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it red** — `npm test -- diagnostics-sink` → FAIL (module missing).

- [ ] **Step 3: Implement `src/diagnostics/diagnostics-sink.ts`:**

```ts
/**
 * Passive sanitizer-removal sink. `recordRemoval` is a no-op unless armed, so
 * the sanitizer's behaviour is byte-identical when diagnostics is off and no
 * sanitize/CSS signature has to change. Capped at capture time so a huge
 * multi-row render can't grow the buffer unbounded.
 *
 * Imports nothing from the pipeline — one-way dependency, no cycles.
 */
import { SanitizerEntry, SanitizerCapture } from './types';
import { VisualConstants } from '../visual-constants';

let armed = false;
let entries: SanitizerEntry[] = [];
let overflow = 0;

export const isArmed = (): boolean => armed;

export const beginCapture = (): void => {
    armed = true;
    entries = [];
    overflow = 0;
};

export const recordRemoval = (e: SanitizerEntry): void => {
    if (!armed) return;
    if (entries.length >= VisualConstants.diagnostics.sanitizerEntryCap) {
        overflow++;
        return;
    }
    entries.push(e);
};

/** Disarm and return the collected capture (a copy). */
export const endCapture = (): SanitizerCapture => {
    armed = false;
    return { entries: entries.slice(), overflow };
};
```

- [ ] **Step 4: Run green** — `npm test -- diagnostics-sink` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add src/diagnostics/diagnostics-sink.ts test/diagnostics-sink.test.ts
git commit -m "feat: passive sanitizer-removal sink (no-op unless armed, capped)"
```

### U3: Instrument the DOMPurify hooks

**Files:**
- Modify: `src/sanitize-pipeline.ts` (`uponSanitizeAttribute` rejection sites, `uponSanitizeElement` on*-removal, `purify.removed` in `getSanitizedContent` + `sanitizeFragmentInPlace`)
- Test: `test/diagnostics-sink-instrumentation.test.ts`

The load-bearing unit: it must **add observation only**. Every `hookEvent.keepAttr = false; return;` gets a preceding `recordRemoval({...})`; the existing control flow is untouched.

- [ ] **Step 1: Write the failing test** — `test/diagnostics-sink-instrumentation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';
import {
    beginCapture,
    endCapture
} from '../src/diagnostics/diagnostics-sink';

const sanitizeWithCapture = (html: string) => {
    beginCapture();
    const out = getSanitizedHtmlForTesting(html, 'html');
    return { out, cap: endCapture() };
};

describe('sanitizer instrumentation', () => {
    beforeEach(() => endCapture());

    it('is byte-identical with capture armed vs disarmed', () => {
        const html =
            '<div onclick="x()" style="color:red"><a href="javascript:1">x</a>' +
            '<script>bad()</script><p title="ok">hi</p></div>';
        const disarmed = getSanitizedHtmlForTesting(html, 'html');
        beginCapture();
        const armed = getSanitizedHtmlForTesting(html, 'html');
        endCapture();
        expect(armed).toBe(disarmed);
    });

    it('records an event-handler removal', () => {
        const { cap } = sanitizeWithCapture('<div onclick="x()">hi</div>');
        expect(
            cap.entries.some((e) => e.rule === 'event-handler')
        ).toBe(true);
    });

    it('records a disallowed URL scheme', () => {
        const { cap } = sanitizeWithCapture('<a href="javascript:1">x</a>');
        expect(
            cap.entries.some((e) => e.rule === 'disallowed-url-scheme')
        ).toBe(true);
    });

    it('records a DOMPurify-core tag removal (<script>)', () => {
        const { cap } = sanitizeWithCapture('<script>bad()</script><p>ok</p>');
        expect(
            cap.entries.some((e) => e.kind === 'tag' && /script/i.test(e.subject))
        ).toBe(true);
    });

    it('records nothing when disarmed', () => {
        getSanitizedHtmlForTesting('<div onclick="x()">hi</div>', 'html');
        expect(endCapture().entries).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it red** — `npm test -- diagnostics-sink-instrumentation` → FAIL (no records).

- [ ] **Step 3: Implement** — in `src/sanitize-pipeline.ts`:

Add the import at the top (with the other internal imports):

```ts
import { recordRemoval } from './diagnostics/diagnostics-sink';
```

Inside the `uponSanitizeAttribute` hook, add a local helper at the top of the `try` block (after `const isSvgTag = ...`):

```ts
                    const snip = (v: string) =>
                        v.length > 80 ? v.slice(0, 80) + '…' : v;
                    const dropAttr = (rule: string) =>
                        recordRemoval({
                            kind: 'attr',
                            subject: `${attrName} on <${tagName}>`,
                            rule,
                            snippet: snip(value)
                        });
```

Then insert the matching `dropAttr(...)` call immediately **before** each `hookEvent.keepAttr = false; return;` in the hook, using these labels (one per existing rejection site):

| Existing site (by guard/comment) | Label |
|---|---|
| Hyperlink toggle (`!allowHyperlinks && tagName === 'a'`) | `hyperlinks-disabled` |
| HTML per-tag allowlist miss (`!isAllowed`) | `attr-not-allowed` |
| SVG `on*` / `SVG_ATTRIBUTE_DENYLIST` | `svg-attr-denied` |
| Per-tag URL scheme not in `schemesByTag` | `disallowed-url-scheme` |
| SVG default-deny (no `schemesByTag` entry) | `svg-url-scheme-default-deny` |
| SVG funciri `url()` scheme `!== data` | `svg-funciri-scheme` |
| SVG funciri unsafe `data:` image | `svg-funciri-unsafe-data` |
| SMIL `attributeName` denylist | `smil-attributename` |
| `data:` URI sanitized empty | `data-uri` |
| inline `style` sanitized empty | `inline-style` |
| `xlink:href` `javascript:` | `xlink-javascript` |
| `scriptingPatterns` `hasDangerous` | `dangerous-pattern` |

In the `catch (err)` envelope (where it already sets `keepAttr = false` then `console.warn`), add before the existing body:

```ts
                    recordRemoval({
                        kind: 'attr',
                        subject: 'attribute',
                        rule: 'hook-error',
                        snippet: String(err).slice(0, 80)
                    });
```

In the `uponSanitizeElement` hook, in the on*-handler branch, immediately before `element.parentNode.removeChild(element)`:

```ts
                        recordRemoval({
                            kind: 'element',
                            subject: `<${element.nodeName.toLowerCase()}> (${attr.name})`,
                            rule: 'event-handler'
                        });
```

For DOMPurify-core tag removals, add a private helper near `getSanitizedContent` and call it after each `purify.sanitize(...)` while still inside `withSanitizerHooks`' `run` (so the hooks/teardown bracket it):

```ts
const recordCoreRemovals = (purify: DOMPurifyType): void => {
    const removed = (purify as unknown as { removed?: unknown[] }).removed;
    if (!Array.isArray(removed)) return;
    for (const r of removed) {
        if (r && typeof r === 'object' && 'element' in r) {
            const el = (r as { element: { nodeName?: string } }).element;
            const name = el?.nodeName
                ? `<${String(el.nodeName).toLowerCase()}>`
                : '<node>';
            recordRemoval({ kind: 'tag', subject: name, rule: 'forbidden-or-unknown-tag' });
        } else if (r && typeof r === 'object' && 'attribute' in r) {
            const a = r as { attribute?: { name?: string }; from?: { nodeName?: string } };
            const an = a.attribute?.name ?? 'attr';
            const fn = a.from?.nodeName ? `<${String(a.from.nodeName).toLowerCase()}>` : '';
            recordRemoval({ kind: 'attr', subject: `${an} on ${fn}`.trim(), rule: 'dompurify-core' });
        }
    }
};
```

In `getSanitizedContent`, change the `run` to read removals after sanitize:

```ts
    return withSanitizerHooks((purify) => {
        const result = purify.sanitize(preprocessed, dpConfig);
        recordCoreRemovals(purify);
        return result;
    }, options);
```

In `sanitizeFragmentInPlace`, after the existing per-node `purify.sanitize(el, { ...dpConfig, IN_PLACE: true })` call, add `recordCoreRemovals(purify);` (inside the loop, since `removed` resets per sanitize call).

> **Guard:** all `recordRemoval` calls are no-ops when disarmed; `recordCoreRemovals` returns early if `removed` is absent. None alter `hookEvent.keepAttr`, control flow, or return values — verified by Step 1's byte-identical test.

- [ ] **Step 4: Run green** — `npm test -- diagnostics-sink-instrumentation` and `npm test -- sanitize-pipeline` and `npm test -- security` → all PASS (byte-identical proof + no regressions).

- [ ] **Step 5: Commit:**

```bash
git add src/sanitize-pipeline.ts test/diagnostics-sink-instrumentation.test.ts
git commit -m "feat: record sanitizer removals (attrs, elements, core) into the passive sink"
```

### U4: Instrument the CSS sanitizer

**Files:**
- Modify: `src/css-sanitizer.ts` (record at `.remove()`/drop sites)
- Test: `test/css-sanitizer.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/css-sanitizer.test.ts`:

```ts
import { sanitizeCss } from '../src/css-sanitizer';
import {
    beginCapture,
    endCapture
} from '../src/diagnostics/diagnostics-sink';

describe('css-sanitizer instrumentation', () => {
    beforeEach(() => endCapture());

    it('is byte-identical with capture armed vs disarmed', () => {
        const css = 'p { color: red; behavior: url(x); background: url(javascript:1) }';
        const disarmed = sanitizeCss(css, 'stylesheet');
        beginCapture();
        const armed = sanitizeCss(css, 'stylesheet');
        endCapture();
        expect(armed).toBe(disarmed);
    });

    it('records a dropped declaration with kind css', () => {
        beginCapture();
        sanitizeCss('p { color: red; behavior: url(x) }', 'stylesheet');
        const cap = endCapture();
        expect(cap.entries.some((e) => e.kind === 'css')).toBe(true);
    });
});
```

- [ ] **Step 2: Run it red** — `npm test -- css-sanitizer` → FAIL (no css entries).

- [ ] **Step 3: Implement** — in `src/css-sanitizer.ts` add the import:

```ts
import { recordRemoval } from './diagnostics/diagnostics-sink';
```

At the `decl.remove()` site in `sanitizeCss` (the `walkDecls` callback):

```ts
    root.walkDecls((decl: Declaration) => {
        if (isDangerousDeclaration(decl)) {
            recordRemoval({
                kind: 'css',
                subject: decl.prop,
                rule: 'blocked-declaration',
                snippet: (decl.value || '').slice(0, 80)
            });
            decl.remove();
        }
    });
```

At the `atRule.remove()` site:

```ts
        if (!ALLOWED_AT_RULES.has(atRule.name.toLowerCase())) {
            recordRemoval({ kind: 'css', subject: `@${atRule.name}`, rule: 'blocked-at-rule' });
            atRule.remove();
        }
```

At the `rule.remove()` (dangerous selector) site:

```ts
            if (hasDangerousSelector(rule.selector)) {
                recordRemoval({ kind: 'css', subject: rule.selector.slice(0, 80), rule: 'dangerous-selector' });
                rule.remove();
            }
```

At the defense-in-depth final-pass drop (before `return ''`):

```ts
    if (!finalPassIsClean(output)) {
        recordRemoval({ kind: 'css', subject: 'stylesheet', rule: 'defense-in-depth-final-pass' });
        console.warn(
            'sanitizeCss: defense-in-depth final pass caught a dangerous pattern; dropping entire block'
        );
        return '';
    }
```

- [ ] **Step 4: Run green** — `npm test -- css-sanitizer` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add src/css-sanitizer.ts test/css-sanitizer.test.ts
git commit -m "feat: record dropped CSS declarations/rules into the passive sink"
```

### U5: Console capture

**Files:**
- Create: `src/diagnostics/console-capture.ts`
- Test: `test/console-capture.test.ts`

- [ ] **Step 1: Write the failing test** — `test/console-capture.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    install,
    snapshot,
    clear
} from '../src/diagnostics/console-capture';
import { VisualConstants } from '../src/visual-constants';

describe('console-capture', () => {
    beforeEach(() => clear());

    it('tees through to the original console', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        install();
        console.log('hello');
        expect(spy).toHaveBeenCalledWith('hello');
        spy.mockRestore();
    });

    it('captures level + text', () => {
        install();
        console.warn('careful', 42);
        const buf = snapshot();
        const last = buf[buf.length - 1];
        expect(last.level).toBe('warn');
        expect(last.text).toContain('careful');
        expect(last.text).toContain('42');
    });

    it('caps per-line length', () => {
        install();
        console.log('x'.repeat(VisualConstants.diagnostics.consoleLineCap + 500));
        const last = snapshot().slice(-1)[0];
        expect(last.text.length).toBe(VisualConstants.diagnostics.consoleLineCap);
    });

    it('rings the buffer at the count cap', () => {
        install();
        const cap = VisualConstants.diagnostics.consoleBufferCap;
        for (let i = 0; i < cap + 10; i++) console.log('m' + i);
        const buf = snapshot();
        expect(buf.length).toBe(cap);
        expect(buf[buf.length - 1].text).toContain('m' + (cap + 9));
    });

    it('install is idempotent', () => {
        install();
        install();
        console.log('once');
        expect(snapshot().filter((e) => e.text === 'once').length).toBe(1);
    });
});
```

- [ ] **Step 2: Run it red** — `npm test -- console-capture` → FAIL (module missing).

- [ ] **Step 3: Implement `src/diagnostics/console-capture.ts`:**

```ts
/**
 * Console tee. Patches console.log/info/warn/error ONCE to push into a bounded
 * ring buffer AND always call through to the originals. Scoped to the visual's
 * own sandboxed iframe (console is per-window), so it never affects the parent
 * Power BI window, other visuals, or the global console.
 */
import { ConsoleEntry, ConsoleLevel } from './types';
import { VisualConstants } from '../visual-constants';

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error'];
const buffer: ConsoleEntry[] = [];
let installed = false;

const stringify = (a: unknown): string => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try {
        return JSON.stringify(a);
    } catch {
        return String(a);
    }
};

const push = (level: ConsoleLevel, args: unknown[]): void => {
    const text = args
        .map(stringify)
        .join(' ')
        .slice(0, VisualConstants.diagnostics.consoleLineCap);
    buffer.push({ ts: Date.now(), level, text });
    while (buffer.length > VisualConstants.diagnostics.consoleBufferCap) {
        buffer.shift();
    }
};

export const install = (): void => {
    if (installed) return;
    installed = true;
    for (const level of LEVELS) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]): void => {
            try {
                push(level, args);
            } catch {
                /* never let capture break logging */
            }
            original(...args);
        };
    }
};

export const snapshot = (): ConsoleEntry[] => buffer.slice();

export const clear = (): void => {
    buffer.length = 0;
};
```

- [ ] **Step 4: Run green** — `npm test -- console-capture` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add src/diagnostics/console-capture.ts test/console-capture.test.ts
git commit -m "feat: console tee + bounded ring buffer (iframe-scoped)"
```

### U6: Raw-HTML highlighter

**Files:**
- Create: `src/diagnostics/highlight-html.ts`
- Test: `test/highlight-html.test.ts`

- [ ] **Step 1: Write the failing test** — `test/highlight-html.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { escapeHtml, highlightHtml } from '../src/diagnostics/highlight-html';
import { VisualConstants } from '../src/visual-constants';

const stripSpans = (s: string) => s.replace(/<\/?span[^>]*>/g, '');

describe('highlight-html', () => {
    it('escapes the raw source', () => {
        expect(escapeHtml('<a>&"x"')).toBe('&lt;a&gt;&amp;&quot;x&quot;');
    });

    it('highlighting never alters the (escaped) source', () => {
        const raw = '<div class="x">3 < 4 & ok</div>';
        expect(stripSpans(highlightHtml(raw))).toBe(escapeHtml(raw));
    });

    it('wraps tags in spans for typical markup', () => {
        const out = highlightHtml('<div class="x">hi</div>');
        expect(out).toContain('<span');
        expect(out).toContain('hi');
    });

    it('bypasses highlighting above the size limit (plain escaped text)', () => {
        const big = '<b>'.repeat(VisualConstants.diagnostics.highlightSizeLimit);
        const out = highlightHtml(big);
        expect(out).not.toContain('<span');
        expect(out).toBe(escapeHtml(big));
    });
});
```

- [ ] **Step 2: Run it red** — `npm test -- highlight-html` → FAIL (module missing).

- [ ] **Step 3: Implement `src/diagnostics/highlight-html.ts`:**

```ts
/**
 * Dependency-free HTML source colorizer for the Raw HTML tab. Escapes the
 * source for safe innerHTML, then wraps tag/attr/string tokens in classed
 * <span>s. Above a size threshold it returns plain escaped text (no spans) to
 * avoid a token-span node explosion. Stripping the spans always yields the
 * escaped source — highlighting never changes meaning.
 */
import { VisualConstants } from '../visual-constants';

export const escapeHtml = (s: string): string =>
    s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

// Matches an escaped tag: &lt; optional / tagname …attrs… optional / &gt;
const TAG = /(&lt;\/?)([a-zA-Z][\w-]*)((?:(?!&gt;).)*?)(\/?&gt;)/g;
const ATTR = /([\w-]+)(=)(&quot;(?:(?!&quot;).)*&quot;)/g;

export const highlightHtml = (raw: string): string => {
    const escaped = escapeHtml(raw);
    if (raw.length > VisualConstants.diagnostics.highlightSizeLimit) {
        return escaped;
    }
    return escaped.replace(TAG, (_m, open, name, attrs, close) => {
        const attrsHtml = attrs.replace(
            ATTR,
            (_a: string, n: string, eq: string, val: string) =>
                `<span class="hc-attr">${n}</span>${eq}<span class="hc-str">${val}</span>`
        );
        return (
            `<span class="hc-punc">${open}</span>` +
            `<span class="hc-tag">${name}</span>` +
            attrsHtml +
            `<span class="hc-punc">${close}</span>`
        );
    });
};
```

> Note: dev-tools-style raw output is not round-trippable (literal `<`/`>` in text nodes are not distinguished from real tags). Highlighting is best-effort over what `getRawHtml` already produces — acceptable for a debug view, documented here.

- [ ] **Step 4: Run green** — `npm test -- highlight-html` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add src/diagnostics/highlight-html.ts test/highlight-html.test.ts
git commit -m "feat: dependency-free raw-HTML colorizer with size-threshold bypass"
```

### U7: Snapshot assembly + gating + icon helpers

**Files:**
- Create: `src/diagnostics/diagnostics-snapshot.ts`
- Test: `test/diagnostics-snapshot.test.ts`

- [ ] **Step 1: Write the failing test** — `test/diagnostics-snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    buildSnapshot,
    shouldShowDiagnosticsIcon,
    createDiagnosticsIcon,
    setIconVisibility
} from '../src/diagnostics/diagnostics-snapshot';
import { VisualConstants } from '../src/visual-constants';

describe('shouldShowDiagnosticsIcon', () => {
    it('requires both the toggle and allowModalDialog', () => {
        expect(shouldShowDiagnosticsIcon(true, true)).toBe(true);
        expect(shouldShowDiagnosticsIcon(true, false)).toBe(false);
        expect(shouldShowDiagnosticsIcon(false, true)).toBe(false);
        expect(shouldShowDiagnosticsIcon(true, undefined)).toBe(false);
    });
});

describe('buildSnapshot', () => {
    const base = { sanitizer: { entries: [], overflow: 0 }, console: [] };

    it('passes short raw HTML through untruncated', () => {
        const snap = buildSnapshot({ ...base, rawHtml: '<p>hi</p>' });
        expect(snap.rawHtml.truncated).toBe(false);
        expect(snap.rawHtml.text).toBe('<p>hi</p>');
        expect(snap.rawHtml.totalLength).toBe(9);
    });

    it('truncates raw HTML over the cap and reports totalLength', () => {
        const big = 'x'.repeat(VisualConstants.diagnostics.rawHtmlCapBytes + 100);
        const snap = buildSnapshot({ ...base, rawHtml: big });
        expect(snap.rawHtml.truncated).toBe(true);
        expect(snap.rawHtml.text.length).toBe(
            VisualConstants.diagnostics.rawHtmlCapBytes
        );
        expect(snap.rawHtml.totalLength).toBe(big.length);
    });
});

describe('icon helpers', () => {
    it('creates a button with the configured id and wires the click', () => {
        let clicked = 0;
        const btn = createDiagnosticsIcon(() => clicked++);
        expect(btn.id).toBe(VisualConstants.diagnostics.iconIdSelector);
        btn.dispatchEvent(new MouseEvent('click'));
        expect(clicked).toBe(1);
    });

    it('toggles visibility', () => {
        const btn = createDiagnosticsIcon(() => {});
        setIconVisibility(btn, false);
        expect(btn.style.display).toBe('none');
        setIconVisibility(btn, true);
        expect(btn.style.display).not.toBe('none');
    });
});
```

- [ ] **Step 2: Run it red** — `npm test -- diagnostics-snapshot` → FAIL (module missing).

- [ ] **Step 3: Implement `src/diagnostics/diagnostics-snapshot.ts`:**

```ts
/** Snapshot assembly (with raw-HTML truncation), icon gating, and icon DOM. */
import { DiagnosticsSnapshot, SanitizerCapture, ConsoleEntry } from './types';
import { VisualConstants } from '../visual-constants';

/** The toggle AND host support are both required; absent capability ⇒ hidden. */
export const shouldShowDiagnosticsIcon = (
    enabled: boolean,
    allowModalDialog: boolean | undefined
): boolean => enabled && allowModalDialog === true;

export const buildSnapshot = (input: {
    rawHtml: string;
    sanitizer: SanitizerCapture;
    console: ConsoleEntry[];
}): DiagnosticsSnapshot => {
    const cap = VisualConstants.diagnostics.rawHtmlCapBytes;
    const total = input.rawHtml.length;
    const truncated = total > cap;
    return {
        sanitizer: input.sanitizer,
        console: input.console,
        rawHtml: {
            text: truncated ? input.rawHtml.slice(0, cap) : input.rawHtml,
            truncated,
            totalLength: total
        }
    };
};

export const createDiagnosticsIcon = (
    onClick: () => void
): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.id = VisualConstants.diagnostics.iconIdSelector;
    btn.type = 'button';
    btn.title = 'HTML Content diagnostics';
    btn.setAttribute('aria-label', 'Open HTML Content diagnostics');
    btn.textContent = '🐞';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
};

export const setIconVisibility = (
    btn: HTMLElement,
    visible: boolean
): void => {
    btn.style.display = visible ? 'block' : 'none';
};
```

- [ ] **Step 4: Run green** — `npm test -- diagnostics-snapshot` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add src/diagnostics/diagnostics-snapshot.ts test/diagnostics-snapshot.test.ts
git commit -m "feat: bounded snapshot assembly + icon gating/DOM helpers"
```

### U8: Dialog renderer + registration

**Files:**
- Create: `src/diagnostics/diagnostics-dialog.ts`
- Test: `test/diagnostics-dialog.test.ts`

- [ ] **Step 1: Write the failing test** — `test/diagnostics-dialog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderPanel, DiagnosticsDialog } from '../src/diagnostics/diagnostics-dialog';
import { DiagnosticsSnapshot } from '../src/diagnostics/types';
import { VisualConstants } from '../src/visual-constants';

const snap = (over: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot => ({
    sanitizer: { entries: [], overflow: 0 },
    console: [],
    rawHtml: { text: '<p>hi</p>', truncated: false, totalLength: 9 },
    ...over
});

describe('renderPanel', () => {
    it('renders three tab buttons', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        const tabs = el.querySelectorAll('[role="tab"]');
        expect(tabs.length).toBe(3);
    });

    it('lists sanitizer entries and the overflow note', () => {
        const el = document.createElement('div');
        renderPanel(
            el,
            snap({
                sanitizer: {
                    entries: [{ kind: 'attr', subject: 'onclick on <div>', rule: 'event-handler' }],
                    overflow: 7
                }
            })
        );
        expect(el.textContent).toContain('onclick on <div>');
        expect(el.textContent).toContain('event-handler');
        expect(el.textContent).toContain('7');
    });

    it('shows an empty state when there are no removals', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        expect(el.textContent?.toLowerCase()).toContain('no');
    });

    it('renders the raw HTML with the truncation marker when truncated', () => {
        const el = document.createElement('div');
        renderPanel(el, snap({ rawHtml: { text: 'abc', truncated: true, totalLength: 99999 } }));
        expect(el.textContent).toContain('truncated');
    });
});

describe('DiagnosticsDialog registration', () => {
    it('registers itself in the global registry under its id', () => {
        const reg = (globalThis as unknown as { dialogRegistry?: Record<string, unknown> })
            .dialogRegistry;
        expect(reg?.[VisualConstants.diagnostics.dialogId]).toBe(DiagnosticsDialog);
    });
});
```

- [ ] **Step 2: Run it red** — `npm test -- diagnostics-dialog` → FAIL (module missing).

- [ ] **Step 3: Implement `src/diagnostics/diagnostics-dialog.ts`:**

```ts
/**
 * The registered diagnostics modal dialog and its pure renderer. renderPanel
 * builds the three-tab UI from a snapshot (no live link to the visual). The
 * DiagnosticsDialog class is the host entry point; it self-registers so the
 * packaged config can resolve it by id (no webpack entry needed).
 */
import { DiagnosticsSnapshot, SanitizerEntry, ConsoleEntry } from './types';
import { highlightHtml } from './highlight-html';
import { VisualConstants } from '../visual-constants';

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
};

const sanitizerTab = (s: DiagnosticsSnapshot): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-sanitizer');
    if (s.sanitizer.entries.length === 0) {
        wrap.appendChild(el('p', 'hc-empty', 'No removals in the last render.'));
        return wrap;
    }
    const table = el('table', 'hc-table');
    const head = el('tr');
    ['kind', 'removed', 'rule'].forEach((h) => head.appendChild(el('th', undefined, h)));
    table.appendChild(head);
    s.sanitizer.entries.forEach((e: SanitizerEntry) => {
        const tr = el('tr');
        tr.appendChild(el('td', undefined, e.kind));
        tr.appendChild(el('td', undefined, e.snippet ? `${e.subject} — ${e.snippet}` : e.subject));
        tr.appendChild(el('td', undefined, e.rule));
        table.appendChild(tr);
    });
    wrap.appendChild(table);
    if (s.sanitizer.overflow > 0) {
        wrap.appendChild(el('p', 'hc-overflow', `+${s.sanitizer.overflow} more removals not shown`));
    }
    return wrap;
};

const consoleTab = (s: DiagnosticsSnapshot): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-console');
    if (s.console.length === 0) {
        wrap.appendChild(el('p', 'hc-empty', 'No console output captured.'));
        return wrap;
    }
    s.console.forEach((c: ConsoleEntry) => {
        const line = el('div', `hc-log hc-${c.level}`);
        line.appendChild(el('span', 'hc-level', c.level));
        line.appendChild(el('span', 'hc-text', c.text));
        wrap.appendChild(line);
    });
    return wrap;
};

const rawTab = (s: DiagnosticsSnapshot): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-raw');
    if (s.rawHtml.truncated) {
        wrap.appendChild(
            el(
                'p',
                'hc-overflow',
                `… truncated — showing first ${s.rawHtml.text.length} of ${s.rawHtml.totalLength} characters`
            )
        );
    }
    const copy = el('button', 'hc-copy', 'Copy') as HTMLButtonElement;
    copy.type = 'button';
    copy.addEventListener('click', () => {
        try {
            void navigator.clipboard?.writeText(s.rawHtml.text);
        } catch {
            /* clipboard unavailable; ignore */
        }
    });
    wrap.appendChild(copy);
    const pre = el('pre', 'hc-pre');
    pre.innerHTML = highlightHtml(s.rawHtml.text);
    wrap.appendChild(pre);
    return wrap;
};

/** Build the tabbed diagnostics UI into `host` from `snapshot`. Pure DOM. */
export const renderPanel = (
    host: HTMLElement,
    snapshot: DiagnosticsSnapshot
): void => {
    host.innerHTML = '';
    host.className = 'hc-diagnostics';
    const tabs = [
        { id: 'sanitizer', label: 'Sanitizer', body: sanitizerTab(snapshot) },
        { id: 'console', label: 'Console', body: consoleTab(snapshot) },
        { id: 'raw', label: 'Raw HTML', body: rawTab(snapshot) }
    ];
    const bar = el('div', 'hc-tabbar');
    bar.setAttribute('role', 'tablist');
    const panels = el('div', 'hc-panels');
    tabs.forEach((t, i) => {
        const btn = el('button', 'hc-tab', t.label) as HTMLButtonElement;
        btn.type = 'button';
        btn.setAttribute('role', 'tab');
        btn.dataset.target = t.id;
        t.body.dataset.tab = t.id;
        t.body.style.display = i === 0 ? 'block' : 'none';
        btn.addEventListener('click', () => {
            tabs.forEach((o) => {
                o.body.style.display = o.id === t.id ? 'block' : 'none';
            });
        });
        bar.appendChild(btn);
        panels.appendChild(t.body);
    });
    host.appendChild(bar);
    host.appendChild(panels);
};

export class DiagnosticsDialog {
    static id = VisualConstants.diagnostics.dialogId;
    constructor(
        options: { element: HTMLElement },
        initialState: object
    ) {
        renderPanel(options.element, initialState as DiagnosticsSnapshot);
    }
}

const g = globalThis as unknown as { dialogRegistry?: Record<string, unknown> };
g.dialogRegistry = g.dialogRegistry || {};
g.dialogRegistry[DiagnosticsDialog.id] = DiagnosticsDialog;
```

- [ ] **Step 4: Add panel styles** — append to `style/visual.less` (minimal, scoped):

```less
.hc-diagnostics {
    font-family: 'Segoe UI', sans-serif;
    font-size: 12px;
    .hc-tabbar { display: flex; gap: 4px; border-bottom: 1px solid #ddd; }
    .hc-tab { padding: 4px 10px; border: none; background: none; cursor: pointer; }
    .hc-table { width: 100%; border-collapse: collapse; }
    .hc-table th, .hc-table td { text-align: left; padding: 2px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
    .hc-log { display: flex; gap: 8px; font-family: monospace; white-space: pre-wrap; }
    .hc-log.hc-warn .hc-level { color: #8a6d00; }
    .hc-log.hc-error .hc-level { color: #b00020; }
    .hc-pre { white-space: pre-wrap; word-break: break-word; font-family: monospace; }
    .hc-overflow { color: #8a6d00; }
    .hc-empty { color: #666; }
    .hc-punc { color: #999; } .hc-tag { color: #22863a; }
    .hc-attr { color: #6f42c1; } .hc-str { color: #032f62; }
}
```

- [ ] **Step 5: Run green + commit** — `npm test -- diagnostics-dialog` → PASS.

```bash
git add src/diagnostics/diagnostics-dialog.ts style/visual.less test/diagnostics-dialog.test.ts
git commit -m "feat: diagnostics dialog renderer + registration + panel styles"
```

### U9: Format toggle + fingerprint

**Files:**
- Modify: `src/visual-settings.ts` (`enableDiagnostics` slice), `src/render-orchestrator.ts` (fingerprint), `stringResources/en-US/resources.resjson`
- Test: `test/visual-settings.test.ts`, `test/render-orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `test/visual-settings.test.ts`:

```ts
it('exposes enableDiagnostics off by default after showRawHtml', () => {
    const model = new VisualFormattingSettingsModel();
    const behavior = model.contentFormatting.contentFormattingCardBehavior;
    expect(behavior.enableDiagnostics.value).toBe(false);
    const names = behavior.slices.map((s: any) => s.name);
    expect(names).toContain('enableDiagnostics');
    expect(names.indexOf('enableDiagnostics')).toBeGreaterThan(
        names.indexOf('showRawHtml')
    );
});
```

and append to `test/render-orchestrator.test.ts`:

```ts
it('fingerprint changes when enableDiagnostics toggles', () => {
    const a = makeSettings(); // existing helper in this file
    a.contentFormatting.contentFormattingCardBehavior.enableDiagnostics.value = false;
    const b = makeSettings();
    b.contentFormatting.contentFormattingCardBehavior.enableDiagnostics.value = true;
    expect(computeRenderFingerprint(a)).not.toBe(computeRenderFingerprint(b));
});
```

> If `test/render-orchestrator.test.ts` builds settings differently, mirror its existing settings-construction helper rather than `makeSettings`.

- [ ] **Step 2: Run red** — `npm test -- visual-settings render-orchestrator` → FAIL.

- [ ] **Step 3: Implement** — in `src/visual-settings.ts`, add the toggle to `ContentFormattingCardBehavior` after `showRawHtml`:

```ts
    // Developer diagnostics: surfaces an icon (Desktop+Service) that opens a
    // modal dialog with sanitizer/console/raw-HTML tabs. Off by default; the
    // only author-facing gate. Does not change rendered output.
    enableDiagnostics = new formattingSettings.ToggleSwitch({
        name: 'enableDiagnostics',
        displayNameKey: 'Objects_ContentFormatting_EnableDiagnostics',
        descriptionKey: 'Objects_ContentFormatting_EnableDiagnostics_Description',
        value: VisualConstants.contentFormatting.enableDiagnostics
    });
```

and add `this.enableDiagnostics` to the `slices` array (after `this.showRawHtml`).

In `src/render-orchestrator.ts`, add `b.enableDiagnostics.value` to the `computeRenderFingerprint` array (after `b.showRawHtml.value`):

```ts
        b.showRawHtml.value,
        b.enableDiagnostics.value,
```

In `stringResources/en-US/resources.resjson`, add:

```json
    "Objects_ContentFormatting_EnableDiagnostics": "Enable diagnostics",
    "Objects_ContentFormatting_EnableDiagnostics_Description": "Show a diagnostics icon (Power BI Desktop and Service only) that opens a dialog reporting what the sanitizer removed, captured console output, and the raw rendered HTML.",
```

- [ ] **Step 4: Run green** — `npm test -- visual-settings render-orchestrator` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add src/visual-settings.ts src/render-orchestrator.ts stringResources/en-US/resources.resjson test/visual-settings.test.ts test/render-orchestrator.test.ts
git commit -m "feat: enableDiagnostics toggle + fingerprint (forces rebuild to arm capture)"
```

### U10: Visual wiring

**Files:**
- Modify: `src/visual.ts`
- Test: `test/diagnostics-wiring.test.ts` (pure-helper assertions) + manual UAT for the modal

The pure decisions are already tested (U7 gating/snapshot, U8 renderPanel). This unit wires them with thin glue; the only new automated check is that the visual constructs an icon and brackets capture. Keep the modal open path for UAT.

- [ ] **Step 1: Add the imports + fields + console install.** In `src/visual.ts`, add these imports (and add `getRawHtml` to the **existing** `from './domain-utils'` import list rather than a second import line):

```ts
import './diagnostics/diagnostics-dialog'; // registration side-effect — must be imported
import { beginCapture, endCapture } from './diagnostics/diagnostics-sink';
import {
    install as installConsoleCapture,
    snapshot as consoleSnapshot
} from './diagnostics/console-capture';
import {
    buildSnapshot,
    shouldShowDiagnosticsIcon,
    createDiagnosticsIcon,
    setIconVisibility
} from './diagnostics/diagnostics-snapshot';
import { SanitizerCapture } from './diagnostics/types';
```

> `DialogAction.Close` and `VisualDialogPositionType.Center` are **const enums** in the external `.d.ts`; like `VisualUpdateType` (see the `DATA_BIT = 1 << 1` literal in [render-orchestrator.ts:16](../../src/render-orchestrator.ts#L16)) they are inlined by the webpack/ts-loader build but the values are passed as literals in Step 4 to keep the call self-contained and avoid any inlining ambiguity. No enum import is needed.

Add fields:

```ts
    private diagnosticsIcon!: HTMLButtonElement;
    private lastSanitizerCapture: SanitizerCapture = { entries: [], overflow: 0 };
```

- [ ] **Step 2: Create the icon in the constructor** (after `this.contentContainer` is set up):

```ts
        this.diagnosticsIcon = createDiagnosticsIcon(() => this.openDiagnostics());
        setIconVisibility(this.diagnosticsIcon, false);
        (this.container.node() as HTMLElement).appendChild(this.diagnosticsIcon);
```

- [ ] **Step 3: Gate the icon + arm capture in `update()`.** At the top of `update()`, after settings are populated, compute the flag and (lazily) install console capture:

```ts
        const diagOn =
            this.formattingSettings.contentFormatting
                .contentFormattingCardBehavior.enableDiagnostics.value;
        if (diagOn) {
            installConsoleCapture();
        }
        setIconVisibility(
            this.diagnosticsIcon,
            shouldShowDiagnosticsIcon(
                diagOn,
                this.host.hostCapabilities?.allowModalDialog
            )
        );
```

Bracket the render with capture when armed — wrap the existing `this.orchestrator.render(...)` call:

```ts
            if (diagOn) beginCapture();
            this.orchestrator.render(options, viewModel, this.formattingSettings);
            if (diagOn) this.lastSanitizerCapture = endCapture();
```

This replaces the existing single `this.orchestrator.render(...)` line: `render` is still called exactly once; the `if (diagOn)` guards only add the capture brackets, so the diagnostics-off path is unchanged.

- [ ] **Step 4: Add the open handler** (new private method):

```ts
    /** Assemble a bounded snapshot and open the host modal dialog. */
    private openDiagnostics(): void {
        const rawHtml = getRawHtml(
            this.styleSheetContainer,
            this.contentContainer,
            this.formattingSettings.stylesheet
        );
        const snapshot = buildSnapshot({
            rawHtml,
            sanitizer: this.lastSanitizerCapture,
            console: consoleSnapshot()
        });
        const d = VisualConstants.diagnostics.dialog;
        this.host.openModalDialog(
            VisualConstants.diagnostics.dialogId,
            {
                title: d.title,
                size: d.size,
                // Literals avoid const-enum inlining ambiguity (see Step 1 note):
                position: { type: 0 /* VisualDialogPositionType.Center */ },
                actionButtons: [0 /* DialogAction.Close */]
            },
            snapshot
        );
    }
```

- [ ] **Step 5: Write the wiring test** — `test/diagnostics-wiring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CustomVisualBuilder } from './VisualBuilder';

describe('diagnostics wiring', () => {
    it('appends a hidden diagnostics icon on construction', () => {
        const vb = new CustomVisualBuilder(400, 300);
        const icon = vb.mainElement.querySelector('#htmlDiagnosticsToggle') as HTMLElement;
        expect(icon).toBeTruthy();
        expect(icon.style.display).toBe('none');
    });
});
```

> The icon's *visible* state and the modal open are environment-dependent (`allowModalDialog`, a real host) and are verified in UAT — the testutils host does not implement `openModalDialog`. Do not assert the dialog opens in jsdom.

- [ ] **Step 6: Run green** — `npm test -- diagnostics-wiring` → PASS; `npm test` → all green; `npx eslint .` → 0 errors (delete the unused `recordRemovalEnd`/`powerbiDialog` import lines); `npm run prettier-check`.

- [ ] **Step 7: Commit:**

```bash
git add src/visual.ts test/diagnostics-wiring.test.ts
git commit -m "feat: wire diagnostics icon, capture bracketing, and openModalDialog"
```

### U11: Verification gate

**Files:** none (verification only); fix-ups committed as found.

- [ ] **Step 1: Full unit suite** — `npm test` → all green (existing + new). Confirm the byte-identical sanitize tests (U3/U4) pass.
- [ ] **Step 2: Lint/format/types** — `npx eslint .` (0 errors), `npm run prettier-check`, and a TypeScript build (`npx tsc --noEmit` or `npm run package` dry parse) → clean. No unused imports in `src/visual.ts`.
- [ ] **Step 3: Zero sanitizer churn** — `npm run docs:check` → in sync (the DOMPurify config and CSS rules were not changed; instrumentation only observes). `git diff --stat` shows no change to `docs/sanitization-rules.md` or `test-uat/*.csv`.
- [ ] **Step 4: Integration** — `npm run test:integration` (Playwright CSP/XSS corpus) → green; then `npm run test:all` as the combined gate.
- [ ] **Step 5: Package all three editions** — `npm run package` (lite), `npm run package-standard`, `npm run package-standalone` → all succeed. (These dirty `capabilities.json`/`config/visual.json` per the build; leave that as the user's WIP, do not commit it.)
- [ ] **Step 6: Manual UAT (documented, not automated)** — in Power BI Desktop and the Service: toggle **Enable diagnostics** on → icon appears; with it off → icon gone; in a mobile/embed context the icon never appears. Open the dialog → Sanitizer lists removals from a payload with `<script>`/`onclick`/`javascript:`; Console shows a standalone-edition `console.log`; Raw HTML colorizes and shows the truncation marker for a multi-MB measure. Confirm Show Raw HTML still works unchanged.
- [ ] **Step 7: Final commit** (if any fix-ups):

```bash
git add -p   # stage only diagnostics-related fix-ups, never -A
git commit -m "test: verification fix-ups for diagnostics dialog"
```

---

## System-Wide Impact

- **Render path:** `update()` brackets `orchestrator.render` with `beginCapture`/`endCapture` only when diagnostics is on; off path is unchanged. `enableDiagnostics` in the fingerprint forces one rebuild when toggled (so the first dialog open has fresh sanitizer data) — a deliberate, debug-only re-render.
- **Sanitizer:** observation-only `recordRemoval` calls; output byte-identical when disarmed (U3/U4 prove it). No DOMPurify config or CSS rule change → `docs:check` stays green (R9).
- **Bundle:** one new `src/diagnostics/` folder (no third-party deps) + the dialog module, registered via `globalThis.dialogRegistry`. Ships to all editions but executes only when armed/opened.
- **Format pane:** one new toggle; `showRawHtml` and all persisted properties untouched (R1, [powerbi-cant-remove-format-properties]).
- **Console:** `window.console` patched (once, lazily) inside the visual's own iframe; tees through, never swallows. No effect outside the iframe.

## Risks

- **`DOMPurify.removed` shape** at the pinned version — read defensively (U3 `recordCoreRemovals` guards with `typeof`/`in`); degrades to hook-only records if absent. A U3 test pins the observed shape.
- **`initialState` size** — bounded by R7 caps before crossing the iframe boundary; tune the defaults in UAT against a deliberately huge report.
- **Console patch interactions** — idempotent install + call-through; if a host pre-wraps `console`, we wrap on top and still call through (no loss). Restore-on-disable is not implemented (the patch is harmless when the buffer is simply not read); revisit only if UAT shows an issue.
- **Highlighter fidelity** — dev-tools raw output isn't round-trippable, so colorization is best-effort; the size-threshold bypass and `stripSpans === escaped source` test bound the risk.

## Documentation / Operational Notes

- Post-merge: capture a `/ce-compound` solution doc on the passive-sink instrumentation pattern (observe-don't-decide at a frozen security boundary) and the modal-dialog registration mechanics.
- `docs/v2/HTML-Content-v2-Guide.md` (untracked living doc) should gain a short "Diagnostics" section when the feature lands.
- No change to `docs/sanitization-rules.md` (generated; `docs:check` enforces parity).
- In-dialog strings are English in v1; full localization of the dialog internals is a follow-up (the pane toggle is localized).
