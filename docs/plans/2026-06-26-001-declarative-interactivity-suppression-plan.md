# Declarative Interactivity Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let report authors mark a DOM node (and its descendants) inert to the visual's cross-filter, context-menu, and tooltip handling via a `data-hc-suppress` markup attribute — and land it on a consolidated `src/interactivity/` surface, extracting the interactivity code currently scattered across `behavior.ts` and the `domain-utils.ts` grab-bag.

**Architecture:** Two phases. **Phase A** consolidates the existing interactivity API into `src/interactivity/` (behavior, tooltips, hyperlinks) — behavior-preserving moves, suite green after each. **Phase B** adds the new `resolveInteractivity` resolver and wires the existing delegated handlers to bail out early when an ancestor carries `data-hc-suppress`; the sample report marks its modal overlay as the end-to-end proof.

**Tech Stack:** TypeScript, d3-selection, Power BI visuals API, Vitest (jsdom), DAX/TMDL (sample measures).

**Spec:** `docs/brainstorms/2026-06-26-declarative-interactivity-suppression.md`

---

## File structure

**Target `src/interactivity/`:**

| File | Responsibility | Origin |
|---|---|---|
| `src/interactivity/index.ts` | Barrel — the public interactivity surface | New |
| `src/interactivity/behavior.ts` | `BehaviorManager`, `IHtmlBehaviorOptions` | Moved from `src/behavior.ts` |
| `src/interactivity/tooltips.ts` | `resolveHover` (+ standard/manual binders) | Extracted from `domain-utils.ts` |
| `src/interactivity/hyperlinks.ts` | `resolveHyperlinkHandling` | Extracted from `domain-utils.ts` |
| `src/interactivity/policy.ts` | `resolveInteractivity`, `InteractionToken` | New (the feature) |

**Other changes:**

| File | Change |
|---|---|
| `src/visual-constants.ts` | Add `suppressAttr` / `suppressAllToken` to the `dom` block |
| `src/visual.ts` | Repoint interactivity imports to `./interactivity` |
| `src/domain-utils.ts` | Remove the extracted functions + their now-unused diagnostics imports |
| `test/behavior.test.ts` | Repoint import; add suppression tests |
| `test/domain-utils.test.ts` | Repoint `resolveHover` / `resolveHyperlinkHandling` imports to `../src/interactivity` (test bodies stay) |
| `test/interactivity-policy.test.ts` | New — resolver unit tests |
| `test/interactivity-tooltips-suppress.test.ts` | New — tooltip suppression test |
| `sample-for-templates/.../_Measures.tmdl` | Mark modal overlay `data-hc-suppress='all'` — **untracked UAT scratch, edited locally, not committed** |

> **Deliberately left alone.** `shouldDimPoint` stays in `domain-utils.ts` (a render-time selection predicate used 4× there; moving it only creates a back-import). The rest of `domain-utils.ts` (styling/templating/reconcile) is a separate, larger cleanup — out of scope. Test files are repointed, not physically relocated, to avoid churning shared describe/setup blocks.

> **Author-facing documentation is out of scope for this plan.** The v2 author guide lives in the untracked `docs/v2/` working set and is maintained separately by the maintainer — do not edit or reference it from code or commits.

> **The sample report is untracked UAT scratch.** `sample-for-templates/` is a local working asset (too data-heavy to be a permanent corpus) and will stay untracked. Task 7 edits it locally to exercise the feature, but **does not commit it** — do not `git add` anything under `sample-for-templates/`. A lighter, committable UAT corpus for this feature is a separate follow-up.

---

# Phase A — Consolidate the interactivity surface (behavior-preserving)

## Task 1: Move `behavior.ts` into `src/interactivity/`

**Files:**
- Move: `src/behavior.ts` → `src/interactivity/behavior.ts`
- Create: `src/interactivity/index.ts`
- Modify: `src/visual.ts` (import on line 42), `test/behavior.test.ts` (import on line 2)

- [ ] **Step 1: Move the file with git**

```bash
mkdir -p src/interactivity
git mv src/behavior.ts src/interactivity/behavior.ts
```

- [ ] **Step 2: Fix the moved file's relative imports**

In `src/interactivity/behavior.ts`, the imports now sit one directory deeper. Update these five import paths (add `../`):

```ts
import { IHtmlEntry, IViewModel } from '../view-model';
import { VisualConstants } from '../visual-constants';
import { shouldDimPoint } from '../domain-utils';
import { recordEvent } from '../diagnostics/event-recorder';
import { tooltipContext, TooltipItem } from '../diagnostics/host-events';
```

(The `powerbi-visuals-utils-interactivityutils` import at the top is a package import — leave it unchanged.)

- [ ] **Step 3: Create the barrel**

Create `src/interactivity/index.ts`:

```ts
// Public interactivity surface. Consumers import from './interactivity'
// rather than reaching into individual modules.
export { BehaviorManager, IHtmlBehaviorOptions } from './behavior';
```

- [ ] **Step 4: Repoint `visual.ts`**

In `src/visual.ts`, replace the behavior import on line 42:

```ts
import { BehaviorManager, IHtmlBehaviorOptions } from './behavior';
```

with:

```ts
import { BehaviorManager, IHtmlBehaviorOptions } from './interactivity';
```

- [ ] **Step 5: Repoint the test**

In `test/behavior.test.ts`, change line 2:

```ts
import { BehaviorManager } from '../src/behavior';
```

to:

```ts
import { BehaviorManager } from '../src/interactivity';
```

- [ ] **Step 6: Run the suite — must stay green**

Run: `npx vitest run`
Expected: PASS (no behaviour changed; only paths moved).

- [ ] **Step 7: Commit**

```bash
git add -A src/interactivity src/visual.ts test/behavior.test.ts
git commit -m "refactor(interactivity): move BehaviorManager into src/interactivity

Pure relocation + barrel. No behaviour change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extract tooltips into `src/interactivity/tooltips.ts`

**Files:**
- Create: `src/interactivity/tooltips.ts`
- Modify: `src/domain-utils.ts` (remove `resolveHover` + the two binders, lines ~532–657, and the now-unused imports on lines 31–32), `src/interactivity/index.ts`, `src/visual.ts`, `test/domain-utils.test.ts`

- [ ] **Step 1: Create the new module with its import header**

Create `src/interactivity/tooltips.ts` with this header, then (Step 2) paste the moved bodies beneath it:

```ts
// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import TooltipShowOptions = powerbi.extensibility.TooltipShowOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

// External dependencies
import { select, Selection } from 'd3-selection';

// Internal dependencies
import { VisualConstants } from '../visual-constants';
import { IHtmlEntry } from '../view-model';
import { recordTooltipEvent } from '../diagnostics/event-recorder';
import { tooltipContext, TooltipItem } from '../diagnostics/host-events';
```

- [ ] **Step 2: Move the three functions verbatim**

Cut these three functions **verbatim** from `src/domain-utils.ts` (the contiguous block at lines ~532–657 — the `resolveHover` JSDoc + `export function resolveHover`, then `bindManualTooltips`, then `bindStandardTooltips`) and paste them into `src/interactivity/tooltips.ts` below the header. `resolveHover` keeps its `export`; the two `bind*` helpers stay module-private (no `export`). Do not change their bodies in this task.

- [ ] **Step 3: Remove the now-orphaned imports from `domain-utils.ts`**

The tooltip functions were the only users of these. Delete lines 31–32:

```ts
import { recordTooltipEvent } from './diagnostics/event-recorder';
import { tooltipContext, TooltipItem } from './diagnostics/host-events';
```

…and the two tooltip type imports on lines 5–6, which are also now unused (they
appeared only in the moved binders):

```ts
import TooltipShowOptions = powerbi.extensibility.TooltipShowOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
```

Verify nothing else references any of them:

Run: `grep -n "recordTooltipEvent\|tooltipContext\|TooltipItem\|TooltipShowOptions\|VisualTooltipDataItem" src/domain-utils.ts`
Expected: no matches.

> Note: **do not** remove `IVisualHost` (line 3) yet — `resolveHyperlinkHandling`
> still uses it until Task 3. Also leave `import { select, Selection } from
> 'd3-selection';` — other functions there still use `select` (e.g. lines
> 964/1011/1047).

- [ ] **Step 4: Add to the barrel**

In `src/interactivity/index.ts`, add:

```ts
export { resolveHover } from './tooltips';
```

- [ ] **Step 5: Repoint `visual.ts`**

In `src/visual.ts`, remove `resolveHover` from the `from './domain-utils'` import group (lines 27–40) and add it to the interactivity import (the line edited in Task 1), which becomes:

```ts
import {
    BehaviorManager,
    IHtmlBehaviorOptions,
    resolveHover
} from './interactivity';
```

- [ ] **Step 6: Repoint the tooltip tests**

In `test/domain-utils.test.ts`, the `resolveHover` symbol is imported in the `from '../src/domain-utils'` group (around lines 1–18, `resolveHover` is on line 17). Remove `resolveHover` from that group and add a new import near the top of the file:

```ts
import { resolveHover } from '../src/interactivity';
```

(Leave the `resolveHover(...)` test bodies — around lines 1841–1900 — exactly where they are.)

- [ ] **Step 7: Run the suite — must stay green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/interactivity src/domain-utils.ts src/visual.ts test/domain-utils.test.ts
git commit -m "refactor(interactivity): extract resolveHover/tooltips from domain-utils

Move the hover + standard/manual tooltip binders into
src/interactivity/tooltips.ts and drop the now-unused diagnostics
imports from domain-utils. No behaviour change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract hyperlinks into `src/interactivity/hyperlinks.ts`

**Files:**
- Create: `src/interactivity/hyperlinks.ts`
- Modify: `src/domain-utils.ts` (remove `resolveHyperlinkHandling`, lines ~440–480), `src/interactivity/index.ts`, `src/visual.ts`, `test/domain-utils.test.ts`

- [ ] **Step 1: Create the new module with its import header**

Create `src/interactivity/hyperlinks.ts` with this header, then (Step 2) paste the moved body beneath it:

```ts
// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

// External dependencies
import { select, Selection } from 'd3-selection';
```

- [ ] **Step 2: Move the function verbatim**

Cut `resolveHyperlinkHandling` **verbatim** from `src/domain-utils.ts` (the JSDoc, if any, + `export function resolveHyperlinkHandling` through its closing brace — lines ~440–480) and paste it into `src/interactivity/hyperlinks.ts` below the header. Keep its `export`. Do not change the body.

- [ ] **Step 3: Remove the now-orphaned `IVisualHost` import from `domain-utils.ts`**

`resolveHyperlinkHandling` was the last user of `IVisualHost` (the tooltip
functions that also used it left in Task 2). Delete line 3:

```ts
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
```

`select` and `Selection` stay — other functions still use them. Verify both the
symbol and the orphaned import are gone:

Run: `grep -n "resolveHyperlinkHandling\|IVisualHost" src/domain-utils.ts`
Expected: no matches.

- [ ] **Step 4: Add to the barrel**

In `src/interactivity/index.ts`, add:

```ts
export { resolveHyperlinkHandling } from './hyperlinks';
```

- [ ] **Step 5: Repoint `visual.ts`**

In `src/visual.ts`, remove `resolveHyperlinkHandling` from the `from './domain-utils'` import group and add it to the interactivity import, which becomes:

```ts
import {
    BehaviorManager,
    IHtmlBehaviorOptions,
    resolveHover,
    resolveHyperlinkHandling
} from './interactivity';
```

- [ ] **Step 6: Repoint the hyperlink tests**

In `test/domain-utils.test.ts`, remove `resolveHyperlinkHandling` from the `from '../src/domain-utils'` import group (line 8) and add it to the interactivity import added in Task 2:

```ts
import { resolveHover, resolveHyperlinkHandling } from '../src/interactivity';
```

(Leave the `resolveHyperlinkHandling` test body — the `describe` at line ~930 — where it is.)

- [ ] **Step 7: Run the suite — must stay green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/interactivity src/domain-utils.ts src/visual.ts test/domain-utils.test.ts
git commit -m "refactor(interactivity): extract resolveHyperlinkHandling from domain-utils

Move link-click delegation into src/interactivity/hyperlinks.ts.
The interactivity surface is now consolidated. No behaviour change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Phase B — Add `data-hc-suppress` on the clean surface

## Task 4: Resolver module + constants

**Files:**
- Modify: `src/visual-constants.ts` (the `dom: { ... }` block, ends ~line 264)
- Create: `src/interactivity/policy.ts`
- Modify: `src/interactivity/index.ts`
- Test: `test/interactivity-policy.test.ts`

- [ ] **Step 1: Add the constants**

In `src/visual-constants.ts`, inside the `dom: {` object, add a comma after the `contentSlotMarker: 'HC:CONTENT'` line and append:

```ts
        contentSlotMarker: 'HC:CONTENT',
        // Declarative interactivity suppression. An author adds
        // data-hc-suppress="filter context-menu tooltip" (or "all") to a node to
        // make it + its descendants inert to the visual's cross-filter / context
        // menu / tooltip handling, deferring to their own / native behaviour.
        // Works in every edition because the visual reads the markup itself.
        suppressAttr: 'data-hc-suppress',
        suppressAllToken: 'all'
```

- [ ] **Step 2: Write the failing unit test**

Create `test/interactivity-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveInteractivity } from '../src/interactivity';

// Build <root><mid [attr]><leaf></leaf></mid></root> and return leaf.
function tree(attr?: string): Element {
    const root = document.createElement('div');
    const mid = document.createElement('div');
    if (attr !== undefined) mid.setAttribute('data-hc-suppress', attr);
    const leaf = document.createElement('span');
    mid.appendChild(leaf);
    root.appendChild(mid);
    return leaf;
}

describe('resolveInteractivity', () => {
    it('allows everything when no ancestor suppresses', () => {
        const leaf = tree();
        expect(resolveInteractivity(leaf, 'filter')).toBe(true);
        expect(resolveInteractivity(leaf, 'tooltip')).toBe(true);
        expect(resolveInteractivity(leaf, 'context-menu')).toBe(true);
    });

    it('suppresses only the named token', () => {
        const leaf = tree('filter');
        expect(resolveInteractivity(leaf, 'filter')).toBe(false);
        expect(resolveInteractivity(leaf, 'tooltip')).toBe(true);
    });

    it('"all" suppresses every token', () => {
        const leaf = tree('all');
        expect(resolveInteractivity(leaf, 'filter')).toBe(false);
        expect(resolveInteractivity(leaf, 'tooltip')).toBe(false);
        expect(resolveInteractivity(leaf, 'context-menu')).toBe(false);
    });

    it('reads multiple space-separated tokens', () => {
        const leaf = tree('filter tooltip');
        expect(resolveInteractivity(leaf, 'filter')).toBe(false);
        expect(resolveInteractivity(leaf, 'tooltip')).toBe(false);
        expect(resolveInteractivity(leaf, 'context-menu')).toBe(true);
    });

    it('inherits suppression from an ancestor (descendants included)', () => {
        const leaf = tree('all'); // attr on mid, query the leaf below it
        expect(resolveInteractivity(leaf, 'filter')).toBe(false);
    });

    it('ignores unknown tokens', () => {
        const leaf = tree('foo bar');
        expect(resolveInteractivity(leaf, 'filter')).toBe(true);
    });

    it('treats a null node as allowed', () => {
        expect(resolveInteractivity(null, 'filter')).toBe(true);
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/interactivity-policy.test.ts`
Expected: FAIL — `resolveInteractivity` is not exported from `../src/interactivity`.

- [ ] **Step 4: Implement the resolver**

Create `src/interactivity/policy.ts`:

```ts
import { VisualConstants } from '../visual-constants';

/** Interaction categories an author can suppress via `data-hc-suppress`. */
export type InteractionToken = 'filter' | 'context-menu' | 'tooltip';

/**
 * Whether a given interaction is allowed for `node`. Walks from `node` up the
 * parent chain; if any ancestor's `data-hc-suppress` attribute names `token`
 * (or the `all` wildcard), the interaction is suppressed.
 *
 * No boundary is tracked — `data-hc-suppress` only ever appears inside author
 * content, so walking to the document root is safe.
 *
 * @param node  - the event target (or any element to test)
 * @param token - the interaction category
 * @returns true when allowed (default), false when suppressed
 */
export function resolveInteractivity(
    node: Element | null,
    token: InteractionToken
): boolean {
    const { suppressAttr, suppressAllToken } = VisualConstants.dom;
    let el: Element | null = node;
    while (el) {
        const raw = el.getAttribute(suppressAttr);
        if (raw) {
            // ponytail: linear parent-chain walk, called per click and per
            // mousemove. Fine at normal DOM depth; memoise only if a profiler on
            // multi-MB content complains.
            const tokens = raw.split(/\s+/);
            if (tokens.includes(token) || tokens.includes(suppressAllToken)) {
                return false;
            }
        }
        el = el.parentElement;
    }
    return true;
}
```

- [ ] **Step 5: Export from the barrel**

In `src/interactivity/index.ts`, add:

```ts
export { resolveInteractivity } from './policy';
```

(`InteractionToken` stays defined in `policy.ts` as its own param type — no
consumer imports it, so it is not re-exported from the barrel.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/interactivity-policy.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add src/visual-constants.ts src/interactivity/policy.ts src/interactivity/index.ts test/interactivity-policy.test.ts
git commit -m "feat(interactivity): add data-hc-suppress resolver

resolveInteractivity walks the parent chain for a data-hc-suppress
attribute naming filter / context-menu / tooltip (or all). Pure, no
wiring yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire suppression into behavior (cross-filter + context menu)

**Files:**
- Modify: `src/interactivity/behavior.ts` (`handleSelectionClick`, `handleContextMenu`, `bindClearCatcher`)
- Test: `test/behavior.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/behavior.test.ts`, add this `describe` block at the end of the file:

```ts
describe('interactivity suppression in behavior', () => {
    it('suppresses cross-filter when the target is under data-hc-suppress=filter', () => {
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);

        const modal = document.createElement('div');
        modal.setAttribute('data-hc-suppress', 'filter');
        const inner = document.createElement('button');
        modal.appendChild(inner);

        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), ctrlKey: false, target: inner } as any;
        mgr.handleSelectionClick(evt, { tooltips: [] } as any);

        expect(evt.stopPropagation).toHaveBeenCalled(); // don't fall through to clear-catcher
        expect(handler.handleSelection).not.toHaveBeenCalled();
    });

    it('still cross-filters when the target is outside any suppressed subtree', () => {
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);

        const inner = document.createElement('button'); // no suppressing ancestor
        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), ctrlKey: false, target: inner } as any;
        mgr.handleSelectionClick(evt, { tooltips: [] } as any);

        expect(handler.handleSelection).toHaveBeenCalled();
    });

    it('shows no context menu (but preventDefaults) under data-hc-suppress=all', () => {
        const mgr = new BehaviorManager<any>();
        const { options } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);

        const modal = document.createElement('div');
        modal.setAttribute('data-hc-suppress', 'all');
        const inner = document.createElement('span');
        modal.appendChild(inner);

        const evt = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 1, clientY: 2, target: inner } as any;
        mgr.handleContextMenu(evt, { tooltips: [] } as any);

        expect(evt.preventDefault).toHaveBeenCalled(); // swallow the native browser menu too
        expect(handler.handleContextMenu).not.toHaveBeenCalled();
    });

    it('skips the clear-catcher clear when the target is under data-hc-suppress=filter', () => {
        const mgr = new BehaviorManager<any>();
        const { options, clear } = makeOptions(vi.fn());
        const handler = { handleSelection: vi.fn(), handleContextMenu: vi.fn(), handleClearSelection: vi.fn() };
        mgr.bindEvents(options as any, handler as any);

        const modal = document.createElement('div');
        modal.setAttribute('data-hc-suppress', 'filter');
        const inner = document.createElement('div');
        modal.appendChild(inner);

        const clickCall = (clear.on as any).mock.calls.find((c: any[]) => c[0] === 'click');
        clickCall[1]({ preventDefault: vi.fn(), stopPropagation: vi.fn(), target: inner });

        expect(handler.handleClearSelection).not.toHaveBeenCalled();
    });
});
```

> Note: the existing `makeOptions` helper builds `viewModel: { hasCrossFiltering: true }`, so the clear-catcher click handler runs. The existing instrumentation tests pass mock events without `target`, so `resolveInteractivity(undefined, …)` returns `true` and their behaviour is unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/behavior.test.ts -t "interactivity suppression in behavior"`
Expected: FAIL — `handleSelection` / `handleClearSelection` still called.

- [ ] **Step 3: Add the import**

At the top of `src/interactivity/behavior.ts`, after the `import { tooltipContext, TooltipItem } from '../diagnostics/host-events';` line, add:

```ts
import { resolveInteractivity } from './policy';
```

- [ ] **Step 4: Guard `handleSelectionClick`**

In `src/interactivity/behavior.ts`, replace the `handleSelectionClick` method body so the suppression guard runs first:

```ts
    handleSelectionClick(event: MouseEvent, d: IHtmlEntry) {
        if (!resolveInteractivity(event.target as Element | null, 'filter')) {
            // Inert region: don't toggle, and stop the click reaching the
            // clear-catcher (which would otherwise wipe the selection).
            event.stopPropagation();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.options.hideTooltip();
        // `d.selected` is the PRE-toggle state, so a Ctrl+click on an already-
        // selected point removes it from the selection, otherwise it adds it; a
        // plain click replaces the selection. Surfacing add/remove makes it
        // clear how each click changes the multi-select context.
        const op = event.ctrlKey ? (d.selected ? 'remove' : 'add') : 'select';
        recordEvent('cross-filter', op, this.pointContext(d) || undefined);
        this.selectionHandler.handleSelection(d, event.ctrlKey);
    }
```

- [ ] **Step 5: Guard `handleContextMenu`**

In `src/interactivity/behavior.ts`, replace the `handleContextMenu` method body so it always `preventDefault`s but shows nothing when suppressed:

```ts
    handleContextMenu(event: MouseEvent, d: IHtmlEntry | null) {
        // Always preventDefault so the browser's native menu never appears.
        event.preventDefault();
        if (!resolveInteractivity(event.target as Element | null, 'context-menu')) {
            // Inert region: show neither our drill menu nor the native one.
            return;
        }
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

- [ ] **Step 6: Guard the clear-catcher click**

In `src/interactivity/behavior.ts`, in `bindClearCatcher`, add the suppression check as the first statement inside the `if (hasCrossFiltering) {` block:

```ts
        clearCatcherSelection.on('click', (event) => {
            if (hasCrossFiltering) {
                if (!resolveInteractivity(event.target as Element | null, 'filter')) {
                    return; // inert region — don't clear
                }
                event.preventDefault();
                event.stopPropagation();
                this.options.hideTooltip();
                recordEvent('cross-filter', 'cleared');
                const mouseEvent: MouseEvent = <MouseEvent>event;
                mouseEvent && this.selectionHandler.handleClearSelection();
            }
        });
```

- [ ] **Step 7: Run the behavior tests to verify they pass**

Run: `npx vitest run test/behavior.test.ts`
Expected: PASS (all existing + 4 new).

- [ ] **Step 8: Commit**

```bash
git add src/interactivity/behavior.ts test/behavior.test.ts
git commit -m "feat(interactivity): honour data-hc-suppress for click and context menu

Cross-filter clicks under a suppressed subtree stopPropagation without
toggling (so they don't reach the clear-catcher); the clear-catcher
skips clearing for suppressed targets; context-menu suppression
preventDefaults and shows no menu at all.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire suppression into tooltips

**Files:**
- Modify: `src/interactivity/tooltips.ts` (`bindManualTooltips`, `bindStandardTooltips`)
- Test: `test/interactivity-tooltips-suppress.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/interactivity-tooltips-suppress.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveHover } from '../src/interactivity';

function makeHost() {
    return { tooltipService: { show: vi.fn(), hide: vi.fn() } } as any;
}

// Mock d3 selection that captures bound handlers and stubs selectAll.
function makeDataElements() {
    const handlers: Record<string, (e: any, d: any) => void> = {};
    const manual = { on: vi.fn().mockReturnThis() };
    const sel: any = {
        on: vi.fn((evt: string, cb: any) => {
            handlers[evt] = cb;
            return sel;
        }),
        selectAll: vi.fn(() => manual)
    };
    return { sel, handlers };
}

describe('contextual tooltip suppression', () => {
    it('hides instead of showing over a data-hc-suppress=tooltip subtree', () => {
        const { sel, handlers } = makeDataElements();
        const host = makeHost();
        resolveHover(sel, host, false);

        const row = document.createElement('div');
        const modal = document.createElement('div');
        modal.setAttribute('data-hc-suppress', 'tooltip');
        const inner = document.createElement('span');
        modal.appendChild(inner);
        row.appendChild(modal);

        handlers['mouseover mousemove'](
            { target: inner, currentTarget: row, clientX: 0, clientY: 0 },
            { tooltips: [{ displayName: 'x', value: 'y' }], identity: {} }
        );

        expect(host.tooltipService.hide).toHaveBeenCalled();
        expect(host.tooltipService.show).not.toHaveBeenCalled();
    });

    it('still shows the tooltip outside any suppressed subtree', () => {
        const { sel, handlers } = makeDataElements();
        const host = makeHost();
        resolveHover(sel, host, false);

        const row = document.createElement('div');
        const inner = document.createElement('span');
        row.appendChild(inner);

        handlers['mouseover mousemove'](
            { target: inner, currentTarget: row, clientX: 0, clientY: 0 },
            { tooltips: [{ displayName: 'x', value: 'y' }], identity: {} }
        );

        expect(host.tooltipService.show).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/interactivity-tooltips-suppress.test.ts`
Expected: FAIL — `show` is called in the first test (suppression not yet wired).

- [ ] **Step 3: Add the import**

At the top of `src/interactivity/tooltips.ts`, after the existing internal imports, add:

```ts
import { resolveInteractivity } from './policy';
```

- [ ] **Step 4: Guard `bindStandardTooltips`**

In `src/interactivity/tooltips.ts`, replace the `dataElements.on('mouseover mousemove', …)` handler in `bindStandardTooltips` so it bails out (hiding) over a suppressed target:

```ts
    dataElements.on('mouseover mousemove', (event, d) => {
        if (!resolveInteractivity(event.target as Element | null, 'tooltip')) {
            tooltipService.hide({ immediately: true, isTouchEvent: true });
            return;
        }
        select(event.currentTarget).classed(
            VisualConstants.dom.hoverClassSelector,
            true
        );
        if (hasGranularity || d.tooltips.length > 0) {
            const options: TooltipShowOptions = {
                coordinates: [event.clientX, event.clientY],
                isTouchEvent: true,
                dataItems: d.tooltips,
                identities: [d.identity]
            };
            tooltipService.show(options);
            recordTooltipEvent(
                'show',
                'contextual',
                tooltipContext(d.tooltips as TooltipItem[])
            );
        }
    });
```

- [ ] **Step 5: Guard `bindManualTooltips`**

In `src/interactivity/tooltips.ts`, in `bindManualTooltips`, add the same guard as the first statement inside the `manualTooltipElements.on('mouseover mousemove', (event) => {` handler:

```ts
    manualTooltipElements.on('mouseover mousemove', (event) => {
        if (!resolveInteractivity(event.target as Element | null, 'tooltip')) {
            tooltipService.hide({ immediately: true, isTouchEvent: true });
            return;
        }
        const dataset = event.currentTarget.dataset;
```

(Leave the rest of the handler unchanged.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/interactivity-tooltips-suppress.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS (no regressions).

- [ ] **Step 8: Commit**

```bash
git add src/interactivity/tooltips.ts test/interactivity-tooltips-suppress.test.ts
git commit -m "feat(interactivity): honour data-hc-suppress for tooltips

Standard and manual tooltip handlers hide and bail out when the hovered
target sits under a data-hc-suppress=tooltip (or all) subtree.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Mark the sample modal overlay (local UAT only — not committed)

**Files:**
- Modify **locally, do not commit**: `sample-for-templates/SampleReportML.SemanticModel/definition/tables/_Measures.tmdl` (lines 420 and 590 — the two `_modalHtml` definitions in `Team Card Body Template` and `Team Card Content`)

`sample-for-templates/` is untracked UAT scratch and stays that way. This task edits it only to exercise the feature in Power BI Desktop; there is no commit and no `git add`. No automated test — verified by manual UAT (clicking the modal must not cross-filter or show the card tooltip).

- [ ] **Step 1: Add the marker in `Team Card Body Template` (line 420)**

Find this exact substring on line 420:

```
<div id='modal_" & _empId & "' class='modal-overlay'>
```

Replace it with:

```
<div id='modal_" & _empId & "' class='modal-overlay' data-hc-suppress='all'>
```

- [ ] **Step 2: Add the marker in `Team Card Content` (line 590)**

Line 590 contains the identical substring. Apply the identical replacement there. Do not alter the adjacent `more-link` / `modal-close` spans.

- [ ] **Step 3: Verify both lines changed**

Run: `grep -n "data-hc-suppress='all'" sample-for-templates/SampleReportML.SemanticModel/definition/tables/_Measures.tmdl`
Expected: two matches (lines ~420 and ~590), each on a `modal-overlay` div.

- [ ] **Step 4: Do NOT commit**

Leave the edit in the working tree for UAT. `sample-for-templates/` is untracked and stays untracked — do not `git add` it. Confirm it is not staged:

Run: `git status --short sample-for-templates/`
Expected: shows the files as untracked (`??`) only — nothing staged.

---

## Final verification

- [ ] **Run the full test suite** — `npx vitest run` → all pass.
- [ ] **Type-check / build** — run the project's build (e.g. the configured `pbiviz` build) and confirm no TypeScript errors from the moved/added imports.
- [ ] **Confirm the surface** — `src/interactivity/` contains `index.ts`, `behavior.ts`, `tooltips.ts`, `hyperlinks.ts`, `policy.ts`; `grep -rn "from './behavior'\|resolveHover\|resolveHyperlinkHandling" src/domain-utils.ts` returns nothing.
- [ ] **Manual UAT (sample report)** — open the Team Cards sample in Power BI Desktop with cross-filtering on: clicking inside an open modal must **not** select/deselect the card or clear the selection; hovering the modal must **not** show the employee tooltip; the modal's ✕ close still works; clicking the card itself still cross-filters.

---

## Notes for the implementer

- **Phase A is behavior-preserving:** every move keeps the suite green. If a move turns a test red, the import path or a relative path inside the moved file is wrong — fix the path, don't change logic.
- **Why the existing behavior tests still pass after wiring:** they invoke handlers with mock events that have no `target`. `resolveInteractivity(undefined, …)` walks zero nodes and returns `true`, so unsuppressed behaviour is unchanged.
- **No new event bindings in Phase B:** every change is an early-out inside a handler that already exists. Don't add listeners.
- **`event.target` vs `event.currentTarget`:** always pass `event.target` (the actual element under the pointer/click) to `resolveInteractivity`, not `currentTarget` (the row root the handler is delegated on).
- **Out of scope (do not build):** `data-hc-force` re-enabling, restructuring modals out of the row, per-token hyperlink suppression, moving `shouldDimPoint`, and any further `domain-utils.ts` de-grab-bagging. See the spec's Out-of-scope section.
```
