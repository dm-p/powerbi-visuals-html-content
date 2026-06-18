---
title: Diagnostics dialog (developer tooling)
date: 2026-06-18
status: approved
related_issues: []
---

# Diagnostics dialog (developer tooling)

## Problem

Power BI Desktop gives report authors **no browser developer tools**. When their HTML/CSS (or, in the unsanitized standalone edition, their scripting) doesn't behave, there is nowhere to look:

- **Certified / lite / standard editions (`sanitize: true`).** The sanitizer in [sanitize-pipeline.ts](../../src/sanitize-pipeline.ts) silently drops disallowed tags, attributes, URL schemes, and CSS declarations — every rejection is `hookEvent.keepAttr = false; return;` (or an element removal, or a denylisted CSS declaration in [css-sanitizer.ts](../../src/css-sanitizer.ts)). The author sees content vanish with **no signal** as to what was removed or which rule fired, and reasonably concludes the visual "broke" their content. They end up fighting the sanitizer instead of working with it.
- **Standalone edition (`sanitize: false`).** Authors have found ways to make scripting work (executable `<script>` via `Range.createContextualFragment`). When a script misbehaves, its `console.*` output goes to a browser console the author cannot open inside Desktop.

The only existing debug surface is the **Show Raw HTML** toggle ([domain-utils.ts `getRawHtml`](../../src/domain-utils.ts) → in-canvas `<textarea>`), which shows the post-sanitize serialized DOM but says nothing about *what was removed* or *what a script logged*.

The earlier Show-Raw-HTML brainstorm explicitly **deferred** a "what was removed" diagnostic, flagging a concern about disclosing sanitizer rules as an oracle ([show-raw-html solution doc](../solutions/ui-bugs/show-raw-html-dev-tools-serializer-2026-05-15.md)). This work picks that thread back up — the concern is weak for an author-armed tool over open-source rules (see Decision 6).

## Users and outcome

**Primary users:**

- A report author on a **certified edition** whose content is being stripped and who needs to know *what* and *why* so they can adjust it (the bulk of users).
- A report author on the **standalone edition** doing scripting who needs to see `console.*` output (and runtime errors) from inside Desktop.
- Any author who already uses **Show Raw HTML** to inspect or demo the rendered markup (including side-by-side raw views) — this group keeps that feature unchanged.

**Outcome that changes for them:**

- Today: content disappears with no explanation; script output is invisible; raw HTML is the only (and silent) introspection surface.
- After this change: an off-by-default **Enable diagnostics** toggle surfaces a small icon in the visual (Desktop + Service only). Clicking it opens a host **modal dialog** with three tabs — **Sanitizer** (what was removed + the rule), **Console** (captured script/visual output), and **Raw HTML** (the existing serialized view, now sharing one core). The author can finally see, in Desktop, why their content renders the way it does.

## Goals

1. **A unified diagnostics surface** holding all three sections (Sanitizer report, Console capture, Raw HTML) in one modal dialog. Built as one deliverable; may be staged internally.
2. **Modal dialog API** (`host.openModalDialog`) as the surface — a large, unclipped reading area that solves the limited-container-space constraint without a bundled full-screen UI. Gated to environments that support it (Desktop + Service).
3. **Sanitizer transparency.** Report, per render, every removal the sanitizer made — element, attribute, URL scheme, and CSS declaration — each with a human-readable rule label.
4. **Console capture.** Surface `console.log/info/warn/error` from author scripts (standalone) and from the visual's own diagnostics (`console.warn` fail-closed messages) in every edition.
5. **DRY raw-HTML display.** The dialog's Raw HTML tab and the in-canvas Show Raw HTML view render from one shared `getRawHtml`/`domSerialize` core; improving the output improves both. The dialog tab additionally applies lightweight, dependency-free syntax colorization with a size-threshold fallback (Decision 8).
6. **Zero behaviour change when off.** No bundle path executes, no sanitizer instrumentation records, no console patch tees, and no icon renders unless the author arms the toggle. The sanitizer's security boundary is **byte-identical** with capture on vs off.
7. **No removals, full back-compat.** `showRawHtml` and every other persisted property stays. Nothing is deleted from the format model (see Decision 1).
8. **Certification-safe.** No new data role, no new privileges, no new `capabilities.json` surface (the dialog is code-registered). `"privileges": []` stays.

## Non-goals

- **Mobile / embed / publish-to-web support.** The feature is intentionally absent where `hostCapabilities.allowModalDialog` is false. Confirmed acceptable.
- **Live streaming into the dialog.** The dialog is a snapshot-at-open renderer (see Decision 4). No cross-context request/response channel is built; "refresh" = close and reopen.
- **Removing or reworking Show Raw HTML.** It stays exactly as-is (Decision 1); only its underlying raw-HTML function is shared.
- **Editing / round-tripping content from the dialog.** It is read-only diagnostics. No "fix it here" affordance.
- **A general logging framework / telemetry.** Console capture is a bounded in-memory ring buffer for the current session only; nothing is persisted or sent anywhere.
- **A syntax-highlighter dependency or DOM virtualization for the Raw HTML tab.** v1 uses a tiny hand-rolled highlighter and native `<pre>` scroll (Decision 8). A full highlighting library (highlight.js/Prism) is rejected — it would ship in the package for every user to benefit a debug-only view. DOM-windowed virtualization is deferred unless UAT surfaces large-document lag.
- **Exhaustive provenance for every sanitizer micro-rule.** v1 labels removals with the rule that fired at the call site (plus a generic label for DOMPurify-core removals); it is not a formal grammar of the policy.

## Key technical decisions

These were settled during brainstorming; rationale captured inline.

1. **Show Raw HTML is kept, not replaced.** Power BI visuals must service every previously-persisted version cleanly — old metadata rides along in the report and is upgraded live *before* new code runs, so removing a format property is unsafe. Show Raw HTML also has an active demo use (side-by-side raw views). It may fade by attrition, but it is not removed. The new work **unifies the display** (one raw-HTML core) rather than replacing the feature. *(Maintainer constraint.)*

2. **Modal dialog API over an in-visual overlay.** The content is table-, log-, and raw-markup-shaped and routinely large; it reads poorly in an overlay clipped to a small visual and well in a host modal that escapes the container. The dialog's only real downsides — capability gating and a separate registered component — are acceptable once the feature is scoped to Desktop + Service. *(Chosen after a two-size layout sketch.)*

3. **`allowModalDialog` is the gate.** `host.hostCapabilities.allowModalDialog === true` already excludes mobile/embed/publish-to-web, so it *is* the "Desktop + Service" restriction. The icon renders only when `enableDiagnostics` is on **and** `allowModalDialog` is true. Optionally AND-filtered with `host.hostEnv & (Web | Desktop)` as belt-and-braces. The off-by-default toggle is the **only** author-facing gate — no edit-mode gate (consistent with how `showRawHtml` already behaves; the author owns leaving it on in a published report).

4. **Snapshot-at-open, not live.** The modal blocks interaction with the report while open, so the underlying render is frozen — a snapshot assembled at click time is sufficient and avoids a cross-context streaming channel. The snapshot `{ sanitizer: Entry[], console: LogEntry[], rawHtml: string }` is passed as `initialState`; the dialog is a dumb renderer of it.

5. **A passive diagnostics sink, not threaded collectors.** Rather than add a collector parameter to every sanitize entry point (`getSanitizedContent`, `parseAndSanitizeInContext`, `sanitizeFragmentInPlace`, `getSanitizedCss`, `preprocessStyleTags`), a small module-level sink exposes `beginCapture()` / `recordRemoval(entry)` / `endCapture(): Entry[]`. `recordRemoval` is a **no-op unless armed**, so signatures stay stable, cost is a boolean check when off, and there is one place all sanitize paths feed. The visual arms it around a render when diagnostics is on.

6. **The oracle concern is moot.** The deferred-diagnostic worry (disclosing what the sanitizer strips) does not apply: capture runs only when the author arms it on their own content, and the sanitizer rules are open-source. No information is exposed that an attacker couldn't already read in the repo.

7. **Console tee, not replace.** When armed, `console.log/info/warn/error` are patched once to push into a bounded ring buffer (e.g. last 200 entries) **and always call through** to the originals. **Scope:** Power BI hosts each custom visual in its own sandboxed `<iframe>`, and `console` is a per-`window` object — so patching `window.console` affects only this visual's iframe (capturing the author's in-iframe `<script>` output, which is the point), and never the parent Power BI window, other visuals, or the browser's global console. Call-through means the real console still receives everything.

8. **Raw HTML tab: cheap colorization, native scroll.** The tab applies a tiny, dependency-free regex highlighter (tag / attribute / string / comment → `<span>`s) over the shared `getRawHtml` output, rendered into a `<pre>` that scrolls natively. Above a size threshold (very large documents) it falls back to plain un-highlighted text to avoid a token-span node explosion. No highlighting library and no DOM virtualization in v1 (both rejected/deferred per Non-goals). **Copy** yields the raw string, not the highlighted markup.

## High-level design

### Trigger and gating

- New format toggle `enableDiagnostics` (default **off**), added as a slice in the existing behavior group (`ContentFormattingCardBehavior` in [visual-settings.ts](../../src/visual-settings.ts)) **after** `showRawHtml`. Nothing is moved or removed, so persistence is untouched.
- In [visual.ts](../../src/visual.ts), when `enableDiagnostics` is on and `allowModalDialog` is true, render a small absolutely-positioned icon button in a corner of the visual. Otherwise no icon.
- The toggle being on also **arms** the diagnostics sink and console capture for subsequent renders.

### Dialog and data flow

```
icon click
  └─ assemble snapshot { sanitizer, console, rawHtml }
       └─ host.openModalDialog(DiagnosticsDialog.id, dialogOpts, snapshot)
            └─ DiagnosticsDialog renders 3 tabs from initialState (read-only)
                 └─ Close → host.close(DialogAction.Close) → promise resolves → no-op
```

- `dialogOpts`: `{ title, size: { width, height }, position: { type: VisualDialogPositionType.Center }, actionButtons: [DialogAction.Close] }`.
- Registration is the documented pattern (no webpack entry needed; packaged config picks it up): a `src/diagnostics/diagnostics-dialog.ts` module declares `class DiagnosticsDialog { static id = 'DiagnosticsDialog'; constructor(options: DialogConstructorOptions, initialState) { renderPanel(options.element, initialState) } }` and self-registers via `globalThis.dialogRegistry[DiagnosticsDialog.id] = DiagnosticsDialog`. `visual.ts` imports the module so registration runs.

### Tab 1 — Sanitizer transparency

- **Sink module** (`src/diagnostics/diagnostics-sink.ts`): `beginCapture()`, `recordRemoval(entry)`, `endCapture(): Entry[]`; armed-state boolean. `Entry = { kind: 'element' | 'attr' | 'css' | 'tag', subject, rule, snippet? }`.
- **Attributes:** a `recordRemoval(...)` call at each `keepAttr = false` site in [sanitize-pipeline.ts](../../src/sanitize-pipeline.ts) (event-handler, per-tag allowlist miss, disallowed URL scheme, SVG default-deny, funciri scheme, SMIL `attributeName`, dangerous-pattern, hyperlink-toggle, fail-closed catch). Each site already knows its precise reason.
- **Elements:** the on*-handler removal in `uponSanitizeElement` records an `element` entry.
- **Core removals:** read `purify.removed` after `sanitize()` and fold in forbidden/unknown tags DOMPurify itself stripped, with a generic rule label.
- **CSS declarations:** [css-sanitizer.ts](../../src/css-sanitizer.ts) records each denylisted declaration it drops.
- The visual calls `beginCapture()` before an armed render and stashes `endCapture()` for the snapshot.

### Tab 2 — Console capture

- `src/diagnostics/console-capture.ts`: an `install()` that patches the four console methods once to tee into a bounded ring buffer of `{ ts, level, text }`, always calling through. `snapshot()` returns a copy; `clear()` empties it.
- Captures author script output (standalone) and the visual's own `console.warn` diagnostics (sanitizer fail-closed, blocked data URIs) in every edition.

### Tab 3 — Raw HTML (DRY)

- `renderPanel`'s Raw HTML tab calls the existing `getRawHtml`/`domSerialize` core. The in-canvas Show Raw HTML path keeps using the same function. Output improvements land in both.
- A small `src/diagnostics/highlight-html.ts` (no dependency) tokenizes the raw string into `<span>`-wrapped tag/attr/string/comment classes (styled via the dialog's CSS), rendered into a `<pre>` with native scroll. A size threshold (e.g. raw length over a constant) bypasses highlighting and renders plain text. A **copy** action copies the underlying raw string, never the span markup.

## Files and architecture

New `src/diagnostics/`:
- `types.ts` — `Entry`, `LogEntry`, `DiagnosticsSnapshot`.
- `diagnostics-sink.ts` — armed-state sanitizer removal sink.
- `console-capture.ts` — console tee + ring buffer.
- `diagnostics-dialog.ts` — registered `DiagnosticsDialog` + pure `renderPanel(element, snapshot)`.
- `highlight-html.ts` — dependency-free raw-HTML tokenizer/colorizer with size-threshold fallback.

Touched:
- [visual.ts](../../src/visual.ts) — icon render + gating, arm sink/console, assemble snapshot, `openModalDialog`, import dialog module for registration.
- [sanitize-pipeline.ts](../../src/sanitize-pipeline.ts) — `recordRemoval` calls at each rejection site + `purify.removed` fold-in.
- [css-sanitizer.ts](../../src/css-sanitizer.ts) — record dropped declarations.
- [visual-settings.ts](../../src/visual-settings.ts) — `enableDiagnostics` toggle slice.
- [visual-constants.ts](../../src/visual-constants.ts) — `DIALOG_ID`, dialog size/position, ring-buffer cap, icon selector, default `enableDiagnostics: false`.
- `stringResources/en-US/resources.resjson` — toggle label/description, tab/section labels.

No `capabilities.json` change expected.

## Testing

- **Byte-identical sanitize proof:** sanitize output is identical with capture armed vs disarmed (the security boundary is unchanged).
- **Sink:** parametrized over each rejection rule → asserts the right `Entry` is recorded; CSS-declaration capture; `purify.removed` fold-in.
- **Console:** ring-buffer cap, ordering, level mapping, tee-through (originals still called).
- **Snapshot assembly + gating:** `allowModalDialog` false ⇒ no icon; toggle off ⇒ no icon, no arming.
- **`renderPanel(snapshot)`** as a pure DOM builder (tabs, tables, empty states).
- **`highlight-html.ts`:** tokenization classes are correct for representative markup; the size-threshold bypass returns plain text; highlighting never alters the underlying text (strip spans ⇒ original string); the copy affordance yields the raw string.
- The modal cannot run in jsdom → covered by UAT in Desktop + Service.
- `npm test` for fast feedback; `npm run test:all` as the final gate; zero sanitizer-rule churn expected.

## Risks and open questions

- **`initialState` serialization size.** Very large raw HTML crosses the iframe boundary as the dialog's initial state. Expected fine; if needed, cap/elide the raw tab with a note. *(Watch in UAT.)*
- **`purify.removed` shape/availability** across the pinned DOMPurify version — verify the field exists and its entry shape before relying on it; the hook-level records are the primary source regardless.
- **Console patch lifetime.** Patch once and keep call-through; ensure no double-install across `update()` calls and no interference with the visual's own logging.
- **Icon placement vs. content.** A corner icon must not occlude author content or fight the scroll affordance — finalize position/size in UAT.
