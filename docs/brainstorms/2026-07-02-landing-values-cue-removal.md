# Landing page: remove the Values drop cue, unify the body message

**Date:** 2026-07-02
**Status:** Design approved, pending plan
**Branch:** `refactor/splash-comprehension` (current)

## Goal

Remove the **Values drop cue** (the "drop a field here" card) from the landing
splash and replace the two-string body copy (lede + compact body) with **one
unified message** used at every container size. The responsive header behavior —
including the GitHub/Sponsor/Coffee icon row wrapping under the logo/title at
the compact breakpoint — is kept exactly as it is today.

## Why (verified, not assumed)

The cue is styled as a dropzone (dashed brand border, "drop a field here"), so
users — including doc testers — try to drag fields onto it. It can never work:

- **Verified 2026-07-02 via an instrumented dev build** (temporary capture-phase
  listeners on the sandbox document + on-screen event ticker): during a field
  drag from the Data pane, **zero** `dragenter`/`dragover`/`drop` — and no
  pointer events — reach the visual's sandboxed iframe. Pointer events flow
  normally outside of a drag, confirming the probe worked.
- The spot where a field drop *does* bind the visual is host chrome (container
  padding) **outside** the iframe — Power BI's canvas layer handles field drops
  and never routes the drag into the sandbox.
- Consequently no visual-side change (transparent backgrounds,
  `pointer-events: none`, drag handlers) can make an in-visual dropzone real,
  and the visuals API offers no "bind a field" affordance. A live dropzone is
  **impossible**; the only honest cue is instructional.

Restyle options (pane illustration, de-affordanced well) were mocked up and
rejected in favor of removal: copy-only avoids all residual "is this a target?"
ambiguity, and frees horizontal room for the message.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Values cue | **Removed entirely** — DOM, styles, and strings. Not restyled. |
| Body copy | **One string at all sizes**: "Add a measure or field that returns HTML to the Values well in the Visualizations pane, and it renders right here — live on the canvas." Replaces `Landing_Body` ("Drop … into … right here", which invited canvas-dropping) *and* `Landing_CompactBody`. |
| Deleted strings | `Landing_ValuesLabel`, `Landing_ValuesField`, `Landing_ValuesHint`, `Landing_CompactBody` (en-US is the only locale). |
| Compact breakpoint | `@container (max-width: 360px)` retained as-is. The lede now **stays visible** in compact (smaller type scale, per today's compact treatment); links + sandbox note still collapse; "Open the docs" still appears; headline still drops 14pt → 10pt. |
| Compact header | **Unchanged**: icon row (GitHub/Sponsor/Coffee) keeps wrapping under the logo/title exactly as now. |
| Lede sizing | ~9pt in compact; the `max-width: 34ch` clamp can be relaxed in compact where the cue no longer competes for width. |
| Breakpoint retune | Out of scope — 360px is conservative with the cue gone, but retuning is a separate concern. |

## Implementation units

### U1 — Strings (`stringResources/en-US/resources.resjson`)
Reword `Landing_Body` to the unified message; delete the four superseded keys.

### U2 — DOM (`src/landing/splash.ts`, `src/landing/handler.ts`)
`buildHero` loses the cue block (`hc-landing-values` subtree) and the
compact-body paragraph — hero becomes headline + single lede. `LandingLabels`
drops `valuesLabel`/`valuesField`/`valuesHint`/`compactBody`; handler wiring
shrinks to match.

### U3 — Styles (`style/visual.less`)
Delete the cue rules (`.hc-landing-values`, `-values-label`, `-dropzone`,
`-chip`, `-chip-text`, `-chip-grip`, `-drophint`) and all
`.hc-landing-compact-body` rules. In the compact container block: stop hiding
`.hc-landing-lede`, size it per the decision above. Hero row flex/gap can be
simplified now that copy is its only child.

### U4 — Tests (`test/landing-splash.test.ts`)
Drop cue assertions; replace compact-body assertions with "single lede present
at all sizes"; update `LandingLabels` fixtures.

## Out of scope / follow-ups

- Re-taking the landing-page screenshot in the v2 tester guide
  (`docs/v2/HTML-Content-v2-Guide.md`) after implementation.
- Compact-breakpoint retuning.
- Persisted-property concerns: none — the splash has no formatting-model
  surface.

## Verification

- Unit tests green (`landing-splash.test.ts` updated).
- Typecheck + lint clean.
- Manual: dev build in Desktop at wide and ≤360px container widths — unified
  message at both sizes, icon row wraps under the title in compact, no cue.
