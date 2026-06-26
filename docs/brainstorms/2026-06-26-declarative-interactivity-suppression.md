# Declarative interactivity suppression

**Date:** 2026-06-26
**Status:** Approved (design) — pending implementation plan
**Issue context:** Reviewer feedback on the Team Cards sample (issue #127 / PR #164)

## Problem

The Team Cards sample renders a per-row modal dialog inside each employee card.
A reviewer reported two behaviours, both traced to one structural fact:

In `Team Card Content` the modal is concatenated **inside** the `emp-card`
element, and the card *is* the visual's data-point element (`behavior.ts` binds
click / contextmenu / tooltip on each row root via `pointSelection`). One modal
per row, nested in the card.

- **Cross-filter on modal click** — a click inside the modal bubbles to the
  card's click handler and toggles that card's selection. (`stopPropagation` in
  `handleSelectionClick` is why it toggles rather than clears.)
- **Tooltip over the modal** — `mouseover` is bound on the same card root
  (`bindStandardTooltips`), so hovering the modal shows the card's tooltip; the
  underlying card sitting directly beneath compounds it. (The "highlights a row"
  effect is Power BI's native tooltip and is out of our control — but removing
  *our* tooltip over the modal removes the trigger.)

The reviewer's instinct — "I didn't expect a non-clickable thing to cause
cross-filter" — is correct: the modal is structurally part of a clickable data
point. The current workaround is to hand-write `event.stopPropagation()` in JS,
which is unavailable in the certified (no-scripting) edition and clumsy in the
unsanitised one.

## Goal

A declarative, markup-only way to mark a node and its descendants as inert to the
visual's delegated interactivity (cross-filter, context menu, tooltip), deferring
to the author's own and the browser's native behaviour. Works in both editions
because the visual reads the DOM itself — no author scripting required.

## The contract

One `data-` attribute:

| Attribute | Effect |
|---|---|
| `data-hc-suppress="filter context-menu tooltip"` | Disable the named interactions for this node **and its descendants** |

**Tokens** (space-separated):

- `filter` — cross-filter: both select-toggle and clear.
- `context-menu` — right-click context / drill menu.
- `tooltip` — hover tooltip (standard contextual **and** manual `tooltipEnabled`).
- `all` — expands to the three tokens above before resolution.

Unknown tokens are ignored (forward-compatible: new interaction types can be
added later without breaking older markup).

### Resolution — any suppressing ancestor wins, per token

For a given event and token, walk from the event's target up the parent chain.
If any element names that token in `data-hc-suppress` → **off**; if none do →
**on** (today's default behaviour, unchanged). `all` expands to its constituent
tokens before the walk.

No boundary tracking is needed: `hc-` tokens only ever exist inside author
content, so walking to the document root is safe and simpler than tracking the
bound `currentTarget`.

## Implementation

### New module — `src/interactivity-policy.ts`

A single pure function plus token parsing. This is the only genuinely new logic.

```ts
type InteractionToken = 'filter' | 'context-menu' | 'tooltip';

// true = interaction allowed (default), false = suppressed
resolveInteractivity(node: Element | null, token: InteractionToken): boolean
```

Attribute and token strings live in `VisualConstants.dom`.

The tooltip path calls this on `mousemove`, so it walks the parent chain per
move. Fine at normal DOM depth (one attribute read per node); leave a
`// ponytail:` note and only memoise if a profiler on multi-MB content complains.

### Wiring into existing handlers (no new event bindings)

- **`behavior.ts` `bindClick`** — if `filter` resolves off for `event.target`:
  `event.stopPropagation()` (so it does not fall through to the clear-catcher)
  and return; otherwise the existing toggle.
- **`behavior.ts` `bindClearCatcher`** — if `filter` is off for the target: skip
  the clear.
- **`behavior.ts` `bindContextMenu`** (row + clear-catcher) — if `context-menu`
  is off: `event.preventDefault()` and return, so **no menu shows** (neither our
  drill menu nor the browser's native one). Suppression means "nothing here".
- **`domain-utils.ts` `bindStandardTooltips`** — if `tooltip` is off:
  `tooltipService.hide(...)` and return instead of showing.
- **`domain-utils.ts` `bindManualTooltips`** — same check before showing a manual
  tooltip.

Authors' own inner handlers (the close ✕'s `onclick`, task-link `href`) are
untouched — we only skip *our* delegated logic. Hyperlink handling is a separate
resolver and is unaffected.

## Sample report changes

Both `Team Card Body Template` and `Team Card Content`:

- `modal-overlay` gets `data-hc-suppress='all'` — a fully inert backdrop. This is
  the end-to-end proof of the feature against the original reviewer complaint.

## Documentation

- Document the attribute, the token vocabulary, and the resolution rule in
  `docs/v2/HTML-Content-v2-Guide.md`.
- Mirror into `docs/v2/scripting-unsanitized-edition.md` where relevant, noting
  this is the declarative replacement for hand-written `stopPropagation()`.

## Testing

- Unit tests for `resolveInteractivity`: single suppress, `all` expansion, nested
  suppress, unknown-token ignore, default-on.
- `behavior.test.ts`: click on a suppressed subtree does not toggle and does not
  clear; `context-menu` suppression shows no menu (and calls `preventDefault`).
- Tooltip tests: hover over a `tooltip`-suppressed subtree hides rather than shows.

## Out of scope (YAGNI)

- **`data-hc-force` (re-enable under a suppressing ancestor)** — deferred: no real
  consumer today. The resolver stays a cheap upgrade away (the parent-chain walk
  would compare nearest `suppress` vs `force` instead of first-suppress-wins). Add
  when a real layout needs to punch a hole in a suppressed region.
- Restructuring modals out of the row subtree (a shared modal + JS repopulation) —
  the marker makes it unnecessary.
- A JavaScript opt-in API — the declarative attribute covers the need and works in
  the certified edition.
- Per-token suppression of hyperlinks — separate concern, not requested.
