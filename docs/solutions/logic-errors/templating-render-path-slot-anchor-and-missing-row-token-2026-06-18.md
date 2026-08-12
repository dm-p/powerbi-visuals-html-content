---
title: 'Templating render path: content-slot anchor skips text nodes; tokenless row template drops content silently'
date: 2026-06-18
category: logic-errors
module: src/domain-utils.ts
problem_type: logic_error
component: tooling
symptoms:
  - "Rows render before preceding bare text (e.g. 'Caption: ') instead of after, for non-structural body templates"
  - "marker.previousElementSibling returns null when a text node precedes the {{content}} slot, so the anchor is prepended"
  - "A row template lacking a {{row}} token renders every row as an empty wrapper, dropping all bound content"
  - "The content drop is silent — no error, no warning, no exception"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - templating
  - dom-traversal
  - text-nodes
  - render-path
  - silent-data-loss
  - edge-case
  - regex-lastindex
  - dompurify
---

# Templating render path: content-slot anchor skips text nodes; tokenless row template drops content silently

## Problem

Two bugs in the templating render path (`src/domain-utils.ts`) caused row content to land in the wrong place or vanish entirely with no diagnostic. A body template with bare text before the `{{content}}` slot (e.g. `<div>Caption: {{content}}</div>`) rendered every row *before* the caption text instead of after it; and a row template missing the `{{row}}` token (e.g. `<tr><td></td></tr>`) silently dropped all row content, producing empty wrappers with no error or warning.

## Symptoms

**Slot positioning**
- `<div>Caption: {{content}}</div>` rendered rows *before* the literal "Caption: " text, so the visual read "‹rows›Caption: " instead of "Caption: ‹rows›".
- Structural templates were unaffected: element siblings around the slot (`<section><h1>H</h1>{{content}}<footer>F</footer></section>`) and sole-child slots (`<div>{{content}}</div>`) positioned correctly — masking the bug during normal testing.
- The misplacement depended entirely on whether a *text node* (rather than an element) preceded the slot, so it surfaced only for caption/label-style templates.

**Tokenless row template**
- A row template with no `{{row}}` token rendered every row as an empty wrapper — the bound content was dropped.
- No error, no warning, no thrown exception: the console stayed clean while the visual rendered blank rows.
- Indistinguishable, from the author's side, from "my data binding is broken" — the failure gave no signal pointing at the template.

## What Didn't Work

**Slot positioning.** The code review's first suggestion was to *document the limitation* rather than fix it — i.e. tell template authors to always wrap the slot in an element (`<div><span>Caption: </span>{{content}}</div>` instead of bare text). This was rejected: it pushes a parser-internals footgun onto authors, leaves the silent-misplacement trap in place for anyone who doesn't read the docs, and the actual fix is a one-token change that resolves it at the source. A code fix that makes the obvious template "just work" beats a documented workaround.

## Solution

### Slot positioning

`resolveTemplateContainer` records the node immediately before the `{{content}}` slot to use as the row-insertion anchor. It used `previousElementSibling`, which **skips text nodes** — so for `<div>Caption: {{content}}</div>` the preceding "Caption: " text node was invisible, `prevEl` came back `null`, and the anchor was prepended to the container (rows before the caption). The fix switches to `previousSibling` (and renames `prevEl` → `prevNode`).

Before:

```ts
const prevEl = marker.previousElementSibling;
marker.remove();
// ...
const anchor = document.createComment(SLOT_MARKER);
if (prevEl && prevEl.parentNode === container) {
    prevEl.after(anchor);
} else {
    container.prepend(anchor);
}
```

After (`src/domain-utils.ts`):

```ts
// Anchor position reference: the node (element OR text) immediately before
// the slot, if any. previousSibling, NOT previousElementSibling, so the slot
// keeps its position even when bare text precedes it, e.g.
// `<div>Caption: {{content}}</div>` (rows render after "Caption: ", not
// before it). Captured pre-sanitize; a text node always survives, an element
// survives only if allowed — the guard below handles removal.
const prevNode = marker.previousSibling;
marker.remove();
// ...
const anchor = document.createComment(SLOT_MARKER);
if (prevNode && prevNode.parentNode === container) {
    prevNode.after(anchor);
} else {
    container.prepend(anchor);
}
```

The surviving-node guard is unchanged: text nodes always survive DOMPurify sanitization and support both `.after()` and `.parentNode`, so `if (prevNode && prevNode.parentNode === container)` works identically for a text node as it did for an element. (The guard tests `parentNode === container` rather than `isConnected` because `rootEl` may be detached under test, where `isConnected` would spuriously fail.)

### Tokenless row template

`buildRowRoot` substitutes the content into the row template via `substitute(d.rowTemplate, ROW_TOKEN, contentHtml)`. When the template has no `{{row}}`, `String.prototype.replace` finds nothing to replace and returns the template verbatim — content silently dropped. The fix adds a de-duplicated warning helper, called from `buildRowRoot` immediately before the substitution.

Before:

```ts
const rowHtml = substitute(d.rowTemplate, ROW_TOKEN, contentHtml);
```

After — new helper plus its call site:

```ts
// A row template with no {{row}} token leaves substitute() with nothing to
// replace: it returns the template unchanged, so every row renders as an empty
// wrapper and the row content is silently dropped. Warn once per offending
// template so a multi-row visual doesn't flood the console on every update.
const warnedTokenlessRowTemplates = new Set<string>();
function warnIfRowTemplateHasNoToken(rowTemplate: string): void {
    const hasToken = ROW_TOKEN.test(rowTemplate);
    ROW_TOKEN.lastIndex = 0; // ROW_TOKEN is global; .test() advances lastIndex
    if (hasToken || warnedTokenlessRowTemplates.has(rowTemplate)) {
        return;
    }
    warnedTokenlessRowTemplates.add(rowTemplate);
    console.warn(
        'HTML Content: row template has no {{row}} token — row content is ' +
            'dropped and every row renders empty. Template: ' +
            JSON.stringify(rowTemplate)
    );
}
```

```ts
// inside buildRowRoot, before the substitution:
warnIfRowTemplateHasNoToken(d.rowTemplate);
const rowHtml = substitute(d.rowTemplate, ROW_TOKEN, contentHtml);
```

## Why This Works

**Slot positioning.** The root cause is a DOM-API mismatch: `previousElementSibling` walks only the `Element` subset of siblings, but the author's intent ("put rows right here, after whatever precedes the slot") includes text. `{{content}}` is replaced by an HTML comment marker (`<!--SLOT_MARKER-->`) before parsing, and `previousSibling` returns the true adjacent node — element or text — that the marker sat next to. Recording that node and inserting the anchor with `.after()` reproduces the slot's exact position in the live tree. Because a text node always survives sanitization, the surviving-node guard still holds, and structural templates (which had an element sibling) keep behaving exactly as before — the fix is a strict superset of the old behavior.

**Tokenless row template.** The substitution can't fail loudly because `.replace` with no match is a valid no-op by design; the only way to make the failure observable is to detect the missing token *before* substituting. `ROW_TOKEN.test(rowTemplate)` does exactly that. Two subtleties make the helper correct:

- **Stateful-regex gotcha:** `ROW_TOKEN` is declared with the global (`/g`) flag, so `.test()` advances and persists `lastIndex` across calls. Without `ROW_TOKEN.lastIndex = 0` immediately after the test, the *next* call could begin matching mid-string and return a wrong answer. Resetting it restores stateless behavior.
- **De-duplication:** the module-level `warnedTokenlessRowTemplates` Set ensures a given offending template warns exactly once for the life of the module, so a 500-row visual updating on every interaction emits one warning, not 500 per render.

`console.warn` (rather than throwing) is the right severity — the render still completes, just emptily — and matches the codebase's existing diagnostic style in `src/css-sanitizer.ts` and the `launchUrl` handler in `domain-utils.ts`.

## Prevention

**Guardrails**
- Prefer `previousSibling` / `childNodes` over the `*Element*` DOM accessors anywhere a slot, anchor, or insertion point must respect mixed element/text content. The `Element`-only variants silently skip text and are a recurring source of position bugs.
- When using a global (`/g`) `RegExp` with `.test()` or `.exec()`, reset `lastIndex` (or use a non-global copy) — both methods mutate it across calls.
- De-duplicate hot-path warnings through a module-level Set keyed on the offending value, so a per-row/per-render warning fires once per distinct cause rather than once per occurrence.
- Make silent no-op transformations loud: a string `.replace` that finds no match is the canonical "drops data without complaining" failure — detect the precondition and warn before the no-op runs.

**Tests added** (`test/domain-utils.test.ts`)
- *Slot positioning:* "anchors after bare text preceding the slot" renders `<div>Caption: {{content}}</div>` and asserts `tc.anchor.previousSibling.nodeType === Node.TEXT_NODE` and `.textContent === 'Caption: '` — pinning that the anchor lands *after* the text node, which fails under the old `previousElementSibling`. A companion structural test asserts the unaffected element-sibling case (`previousSibling.nodeName === 'H1'`) so both paths stay covered.
- *Tokenless row template:* "warns once when the row template has no `{{row}}` token" renders two rows sharing one unique tokenless template `<tr><td>no-row-token-here</td></tr>` and asserts `console.warn` was called **exactly once** (`toHaveBeenCalledTimes(1)`) with a message containing `{{row}}` — locking in both the warning and the per-template de-dup. The template is deliberately unique so the module-level Set doesn't suppress the warning due to other tests.

Verified: 97 domain-utils tests pass, `tsc` clean, eslint 0 errors, prettier clean (commit `8dbfee5`, branch `feat/templating`).

## Related Issues
- [`identity-keyed-dom-reconcile-stateful-entries`](../design-patterns/identity-keyed-dom-reconcile-stateful-entries-2026-06-15.md) — the identity-keyed reconcile pattern this render path extends (parent architecture; both touch `src/domain-utils.ts`).
- [Templating paradigm plan](../../plans/2026-06-15-001-templating-paradigm-plan.md) — R2/R3/R8 define the token-substitution, content-model parse, and single-root-fallback contract; the tokenless-row bug is the R8 single-root fallback firing silently.
- [Templating paradigm brainstorm](../../brainstorms/2026-06-15-templating-paradigm.md) — origin of the `{{content}}` / `{{row}}` token design.
- Feature origin: user issues **#127** and **#138** (cited via the plan; `gh` not authenticated to link directly).
