---
title: "Power BI modal-dialog diagnostics: sandboxed IDialogHost forces snapshot-in / result-out"
date: 2026-06-19
category: architecture-patterns
module: diagnostics dialog
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Surfacing visual state in a Power BI modal dialog (host.openModalDialog / IDialogHost)"
  - "Dialog code needs a privileged IVisualHost action (launchUrl, localization, live buffers)"
  - "A persisted format toggle must survive update() across reloads"
  - "Copy-to-clipboard is required inside a sandboxed iframe"
  - "The certified visual forbids innerHTML/outerHTML (no-inner-outer-html)"
tags:
  - powerbi
  - modal-dialog
  - idialoghost
  - sandbox-iframe
  - snapshot-result-channel
  - capabilities-json
  - execcommand-copy
  - createelement-dom
---

# Power BI modal-dialog diagnostics: sandboxed IDialogHost forces snapshot-in / result-out

## Context

A Power BI custom visual renders inside a sandboxed iframe with only the privileges Power BI grants it. When you want to expose a developer/diagnostics surface — show the rendered raw HTML, what the sanitizer stripped, captured console output — you cannot just pop a panel inside your own visual DOM; visuals have tight constraints (no `innerHTML` for certified, no arbitrary network, no clipboard) and the natural "big surface" primitive Power BI offers is the **modal dialog API** (`host.openModalDialog`).

The catch that shapes the entire design: **the modal dialog runs in its own separate sandboxed iframe, and it receives only an `IDialogHost` (`setResult`, `close`), never the visual's `IVisualHost`.** So inside the dialog you cannot `launchUrl`, cannot build a localization manager, and cannot reach the visual's live console buffer or DOM. Everything the dialog needs must be handed in; everything it wants done on its behalf must be requested back out.

This repo (`powerbi-visuals-html-content`, branch `feat/diagnostics-dialog`) implements that surface: an off-by-default toggle → a triple-gated icon → a modal dialog with Raw HTML / Sanitizer / Console tabs. The pattern below generalizes to any modal-dialog surface in a Power BI visual.

## Guidance

**1. Treat the dialog as a pure function of a snapshot.** Build a fully-formed, already-localized snapshot in the visual; render purely from it in the dialog. The dialog has no `IVisualHost`, so it cannot resolve anything at render time. Resolve every label, every value, every feature flag in the visual and pass them as the dialog's `initialState`.

```ts
// visual.ts — visual side owns ILocalizationManager and the live data
const snapshot = buildSnapshot({
    rawHtml,
    sanitizer: this.lastSanitizerCapture,
    console: consoleSnapshot(),
    labels: this.diagnosticsLabels(),     // every UI string, pre-localized
    sanitizeEnabled: config.sanitize,     // feature flag → which tabs exist
    initialTab: this.lastDiagnosticsTab   // reopen on the remembered tab
});
void this.host.openModalDialog(dialogId, { title, size, position, actionButtons }, snapshot)
```

Keep the DOM render helpers free of any `powerbi-visuals-api` dependency — pass localized strings in, don't import the API into render code.

**2. Define an explicit result contract and read it on close.** Intents flow OUT through the dialog's result channel: `setResult({...})` for things the visual reads when the dialog closes (last-selected tab, a console-clear request), and `close(action, {...})` for actions that should close-and-act (a doc-link launch). The visual performs all privileged work when the promise resolves.

```ts
// dialog side: accumulate a result object; report it via setResult / close
const result: { lastTab: string; clearConsole?: boolean } = { lastTab: 'raw' };
renderPanel(options.element, initialState as DiagnosticsSnapshot, {
    onTabChange:    (id)  => { result.lastTab = id;        host?.setResult?.({ ...result }); },
    onClearConsole: ()    => { result.clearConsole = true; host?.setResult?.({ ...result }); },
    onLaunchDoc:    (key) =>   host?.close?.(0 /* Close */, { ...result, launchDoc: key })
});
```

```ts
// visual side: read resultState, perform the privileged actions
.then((result) => {
    // Annotate the contract — don't `as { lastTab?; … }` (that resolves to all-any
    // and bypasses the key→URL check below). DiagnosticsDocKey is the doc-link enum.
    const rs = result?.resultState as {
        lastTab?: string;
        clearConsole?: boolean;
        launchDoc?: DiagnosticsDocKey;
    };
    if (rs?.lastTab)      this.lastDiagnosticsTab = rs.lastTab;   // reopen memory
    if (rs?.clearConsole) clearConsoleBuffer();                    // mutate visual state
    if (rs?.launchDoc)    this.host.launchUrl(DOCS[rs.launchDoc]); // privileged call
})
.catch(() => { /* dialog dismissed / unsupported; keep current state */ });
```

**3. Pass enum KEYS for privileged actions, never raw values — this is a security property, not just indirection.** The dialog can't `launchUrl`, so a doc-link returns `{ launchDoc: 'sanitization' | 'acceptedTags' }`. The visual maps the key to a fixed constant URL. Because the dialog passes a *key* and not a *URL*, `launchUrl` can only ever open allow-listed pages — untrusted content in the dialog iframe can never coerce the visual into navigating somewhere arbitrary.

```ts
// visual-constants.ts: the dialog passes only a doc KEY back; the visual maps it
// to one of these URLs and launches via host.launchUrl — so only these known URLs
// can ever open.
docs: {
    sanitization: 'https://html-content.com/docs/sanitization',
    acceptedTags: 'https://html-content.com/docs/accepted-tags'
}
```

**4. Self-register the dialog class in `globalThis.dialogRegistry` keyed by a stable id; share that id via constants.** Power BI instantiates your registered class with `({ element, host }, initialState)` in the dialog iframe — no separate webpack entry is required.

```ts
export class DiagnosticsDialog {
    static id = VisualConstants.diagnostics.dialogId; // same id used by openModalDialog
    constructor(options: { element; host?: { setResult?; close? } }, initialState: object) { ... }
}
const g = globalThis as unknown as { dialogRegistry?: Record<string, unknown> };
g.dialogRegistry = g.dialogRegistry || {};
g.dialogRegistry[DiagnosticsDialog.id] = DiagnosticsDialog;
```

**5. Use `document.execCommand('copy')` via an off-screen readonly textarea — the async Clipboard API is blocked in the dialog iframe.** Stage the text, select, copy, remove; best-effort with a silent catch.

```ts
const staging = document.createElement('textarea');
staging.value = text; staging.setAttribute('readonly', '');
staging.style.position = 'fixed'; staging.style.top = '-1000px'; staging.style.opacity = '0';
document.body.appendChild(staging); staging.select();
try { document.execCommand('copy'); } catch { /* unavailable; ignore */ }
document.body.removeChild(staging);
```

**6. Build the entire dialog UI as pure DOM — no `innerHTML`/`outerHTML`.** Certified posture (eslint `powerbi-visuals/no-inner-outer-html` + the AppSource scanner) forbids them. Use `createElement`/`appendChild`/`replaceChildren`. Even a colorized code view must be DOM span nodes, and should stay lossless:

```ts
host.replaceChildren();                 // clear without innerHTML (cert-safe)
const pre = el('pre', 'hc-pre');
// Built as DOM nodes (not innerHTML); lossless — pre.textContent === s.rawHtml.text.
pre.appendChild(buildHighlightedFragment(s.rawHtml.text));
```

**7. Persist the on/off toggle by declaring it in `capabilities.json`, not only in a formatting slice.** A `formattingSettings` slice renders the pane control, but the value reverts to default on every `update` unless the property is declared under `objects.*.properties` in `capabilities.json`. jsdom unit tests cannot catch this — only Power BI Desktop UAT.

```jsonc
// capabilities.json → objects.contentFormatting.properties
"enableDiagnostics": { "type": { "bool": true } }
```

**8. Bound every snapshot channel** — authors push multi-MB content, and the snapshot crosses an iframe boundary. Cap the raw HTML, the sanitizer entries, and the console buffer (a ring buffer), and surface overflow/truncation to the user as templated, localized strings.

```ts
// visual-constants.ts — bound the cross-iframe initialState for multi-MB content
rawHtmlCapBytes: 512 * 1024,
sanitizerEntryCap: 1000,
consoleBufferCap: 200,
highlightSizeLimit: 200 * 1024,  // above this, skip span-colorization → plain escaped text
```

**9. Triple-gate visibility: toggle ON && host `allowModalDialog` && edit mode.** Fail-closed — an absent capability or an unknown/non-edit view mode hides everything. The same gate guards the icon, the console-capture install, and the recording brackets, so view-mode consumers never pay the cost or see internals.

```ts
export const shouldShowDiagnosticsIcon = (
    enabled: boolean, allowModalDialog: boolean | undefined, isEditMode: boolean
): boolean => enabled && allowModalDialog === true && isEditMode;

// visual.ts update()
const diagActive = shouldShowDiagnosticsIcon(
    settings.enableDiagnostics.value,
    this.host.hostCapabilities?.allowModalDialog,
    options.viewMode === 1 || options.viewMode === 2   // Edit=1, InFocusEdit=2
);
```

## Why This Matters

- **The privilege boundary is real and one-directional.** The dialog iframe is strictly less privileged than the visual. If you forget this and try to localize or `launchUrl` from inside the dialog, it silently does nothing in the host (and may "work" in jsdom tests, masking the bug). The snapshot-in / result-out shape is the only correct way to move data and intent across that boundary.
- **Key-not-URL is defense in depth.** Returning an enum key instead of a URL means the privileged `launchUrl` call is structurally incapable of opening anything outside your allow-list — even if the dialog's DOM is influenced by untrusted authored content. This is exactly the kind of property AppSource certification cares about.
- **Certification rules bite at build and scan time.** `innerHTML`/`outerHTML` are blocked by eslint and the AppSource scanner; the Clipboard API is blocked at runtime in the sandbox. Knowing these up front saves a failed certification round-trip.
- **Capabilities-vs-formatting is a classic silent-revert trap.** The pane shows the control either way, so the bug ("my toggle keeps resetting") only reproduces in Desktop, never in unit tests. Declaring the property in `capabilities.json` is the fix and the thing to verify in UAT.
- **Unbounded snapshots crash or hang the dialog.** When authors push ~2MB per measure, an unbounded raw-HTML snapshot serialized across the iframe is a memory/latency hazard; the colorizer alone can explode into hundreds of thousands of span nodes. The caps keep the surface usable.

## When to Apply

Apply this pattern when building **any modal-dialog surface in a Power BI custom visual** — diagnostics, a settings editor, a detail/drill view, an export preview, a help panel — especially in a **certified/AppSource** visual where the no-`innerHTML` and sandbox constraints apply.

Reach for it specifically when the dialog must:
- display data the visual computes or holds (it cannot recompute it itself),
- show localized text (it has no localization manager),
- trigger a privileged host action like `launchUrl` (it must delegate that back to the visual),
- copy to clipboard (use `execCommand`, not the Clipboard API),
- be hidden from report consumers (gate on edit mode + a host capability + an opt-in toggle).

Do **not** reach for the modal dialog when an in-visual panel suffices and you don't need a large/blocking surface — the dialog's privilege split adds real ceremony (snapshot assembly, result contract, registration) that is only worth it when you genuinely need the separate dialog surface.

## Examples

**Before/after — moving a privileged action across the boundary.** The wrong instinct is to call `launchUrl` from the click handler:

```ts
// ✗ WRONG — runs in the dialog iframe, which has no IVisualHost; silently no-ops
link.addEventListener('click', () => host.launchUrl('https://.../sanitization'));

// ✓ RIGHT — close returning a KEY; the visual maps key→URL and launches
onLaunchDoc: (key) => host?.close?.(0 /* Close */, { ...result, launchDoc: key })
// …then in visual.ts:
if (rs?.launchDoc) this.host.launchUrl(VisualConstants.diagnostics.docs[rs.launchDoc]);
```

**Snapshot shape — pre-localized labels travel with the data.** The `DiagnosticsLabels` interface documents the constraint inline:

```ts
/** The dialog runs in its own iframe (only an IDialogHost, no localization
 *  manager), so the visual resolves these via its ILocalizationManager and
 *  passes them in the snapshot. `overflow`/`truncated` are templates: {0}/{1}
 *  are substituted at render time. */
export interface DiagnosticsLabels {
    tabRaw: string; tabConsole: string; tabSanitizer: string;
    overflow: string;   // {0} = overflow count
    truncated: string;  // {0} = shown chars, {1} = total chars
    /* …copy, consoleClear, docsHeading, docsSanitization, docsAcceptedTags… */
}
```

**Feature-flag-driven tab set.** The snapshot's `sanitizeEnabled` flag decides which tabs exist — computed in the visual, consumed in the dialog:

```ts
const tabs = [{ id: 'raw', label: snapshot.labels.tabRaw, body: rawTab(snapshot) }];
if (snapshot.sanitizeEnabled) {            // Sanitizer tab only when this edition sanitizes
    tabs.push({ id: 'sanitizer', label: snapshot.labels.tabSanitizer, body: sanitizerTab(...) });
}
// Console tab always present
```

**Pure-DOM element helper used throughout (no innerHTML anywhere):**

```ts
const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
};
```

**Files of record:** `src/diagnostics/diagnostics-dialog.ts` (renderPanel, `DiagnosticsDialog`, registry, copy helper, doc-key flow), `src/diagnostics/diagnostics-snapshot.ts` (`buildSnapshot`, `shouldShowDiagnosticsIcon`, `createDiagnosticsIcon`, `isDiagnosticsHotkey`), `src/diagnostics/types.ts` (snapshot/labels/doc-key shapes), `src/visual.ts` (`openDiagnostics`, the `update()` triple gate, `diagnosticsLabels`), `src/visual-constants.ts` (`diagnostics` block: ids, caps, docs URL map), `capabilities.json` (`enableDiagnostics` bool), `style/visual.less` (`.hc-diagnostics`).

## Related

- [../ui-bugs/show-raw-html-dev-tools-serializer-2026-05-15.md](../ui-bugs/show-raw-html-dev-tools-serializer-2026-05-15.md) — the diagnostics dialog's Raw HTML tab reuses this custom serializer; "dev-tools fidelity vs. round-trippability" rationale. The dialog supersedes the standalone Show Raw HTML toggle's UX (not its serializer).
- [../design-patterns/identity-keyed-dom-reconcile-stateful-entries-2026-06-15.md](../design-patterns/identity-keyed-dom-reconcile-stateful-entries-2026-06-15.md) — shares the iframe-isolation, settings-fingerprint snapshot channel, capabilities.json opt-in, and no-innerHTML / pure-DOM discipline.
- [../design-patterns/report-page-tooltip-three-gate-measure-only-2026-06-12.md](../design-patterns/report-page-tooltip-three-gate-measure-only-2026-06-12.md) — prior "multiple independent gates" precedent; parallels the triple-gated edit-mode visibility.
