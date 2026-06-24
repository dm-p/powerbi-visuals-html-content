# Landing page redesign + shared styling for the diagnostics dialog

**Date:** 2026-06-25
**Status:** Design approved, pending plan
**Branch:** `feat/update-branding` (current) — implementation may branch from here

## Goal

Replace the bare W3.CSS landing splash with the high-fidelity **in-visual splash**
designed in Claude Design (`design_landing/`), and factor the visual language into
a small **shared token layer** so the diagnostics dialog can be restyled to match.

One design, two footprints, **light theme only**. The splash carries the brand
(shield + edition badge), version, a Docs button, GitHub/Sponsor/Coffee links, the
"Ready when you are" copy, and a **Values** drop cue. The diagnostics dialog adopts
the same tokens and gets a layout-polish pass.

Reference: `design_landing/README.md` (handoff), `In-Visual Landing.dc.html`
(prototype — ignore the preview harness), `screenshots/`, and the promoted SVGs in
`design_landing/assets/`. Per the handoff, colors/type/spacing/shadows/copy are
**final** — reproduce as-is.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Scope | Landing splash **and** diagnostics dialog, sharing one token system. Nothing else. |
| Theme | **Light only.** No dark tokens, no host-theme detection. |
| W3.CSS | **Dropped entirely** — import, dependency, all `w3-*` classes, and dead `.w3-theme-*` overrides. |
| Shield/badge | **Inline SVG**, promoted from `design_landing/assets/` into source assets. |
| Edition source | **Explicit `edition` constant** added to `config/editions.mjs`, surfaced via `VisualConstants`. No runtime sniffing. |
| Copy | **Localized** — new string keys; remove `Landing_Page_Overview_1–4`. |
| Diagnostics depth | **Restyle + layout polish.** Tab structure, behavior, and DOM stay intact. |
| Footprints | **CSS container queries** (single DOM; CSS drops elements at the compact breakpoint). |
| Values cue | **Decorative/instructional** only — not wired to field-well state. |
| Header icons | GitHub mark (inline SVG) · Fluent `HeartRegular` → Sponsor · Fluent `DrinkCoffeeRegular` → Coffee. |
| Link URLs | Docs → `supportUrl` · GitHub → `gitHubUrl` · Sponsor → `https://github.com/sponsors/dm-p` · Coffee → `https://buymeacoffee.com/dmp`. |

## Why a shared token layer (and why it's cheap)

The diagnostics dialog runs in a **separate** modal-dialog iframe, yet it has **no
CSS injection of its own** — its `.hc-diagnostics` rules already live in
`style/visual.less` and reach the dialog iframe through the existing visual bundle.
So a single `:root { --hc-* }` custom-property block placed in `visual.less` is
available to **both** the main visual (splash) and the dialog with **no new
plumbing**. CSS custom properties also match the prototype's own `var(--…)` idiom.

Rejected alternatives: inline-styled DOM mirroring the prototype 1:1 (zero reuse,
duplicated values); a full design-system refactor across rendered-content chrome
too (out of scope).

## Implementation units

### U1 — Token layer (`style/visual.less`)
A light-only `:root` block of `--hc-*` custom properties transcribed from the
prototype's `:root` (brand `#E34F26` / hover `#C7401C` / tint `#FCEEE9`; surfaces
`#ffffff` / `#f5f4f3` / `#eceae9`; text `#242424` / `#494949` / `#707070`; strokes
`#dcdad6` / `#ededeb`; shadows s4/s8/s16; edition accents — Secure gold `#FFB100`,
Standalone slate `#5b6470`). Single source of truth consumed by U3 and U6.

### U2 — Explicit edition constant
Add `edition: 'flagship' | 'secure' | 'standalone'` to each entry in
`config/editions.mjs` (certified → `secure`, standard → `flagship`, standalone →
`standalone`) and surface it through the existing edition-selection build step so
`VisualConstants` exposes the running edition. Drives the badge graphic, edition
label, and accent color in U3.

### U3 — Splash rebuild (`src/landing-page-handler.ts`)
Rebuild as **pure DOM** (mirroring the diagnostics `el()` cert-safe pattern — no
`innerHTML`, no W3.CSS, no d3 class chains), in a `.hc-landing` block styled from U1:

- **Header:** edition accent bar · shield SVG + edition badge · `HTML Content` name
  + edition label · version · **Docs ↗** button · icon row (GitHub / Heart / Coffee).
- **Body:** headline *"Ready when you are."* · paragraph · Quick start / Examples /
  What's new · sandbox note.
- **Values cue:** dashed drop-zone panel (`⠿ Report HTML` / "drop a field here").
- **Footprints (CSS container queries):** **Compact** (~≤300×210) drops the Values
  panel, secondary copy, and Docs button; collapses to icon links + headline +
  one-line instruction + "Open the docs ↗". **Roomy** (~≥620×420) shows everything.
  Brand, version, headline, and the help link are **never** dropped.

### U4 — Icons & assets
Promote `design_landing/assets/{shield,palette-secure,palette-standalone,
store-secure,store-standalone}.svg` into source assets. Author a tiny
`createElementNS`-based SVG builder (cert-safe; the certified build keeps its
no-`innerHTML` posture). GitHub mark and Fluent `HeartRegular` / `DrinkCoffeeRegular`
path data live as constants. Select the badge variant by U2's edition constant.

### U5 — Links & localization
- Named URL constants for Docs / GitHub / Sponsor / Coffee, all launched via
  `host.launchUrl` (http(s) only — already enforced).
- New localization keys: headline, body paragraph, the three quick links, sandbox
  note, Values label + hint, compact body, compact link. Remove
  `Landing_Page_Overview_1–4`. Author across the repo's existing locale files.

### U6 — Diagnostics restyle + layout polish (`diagnostics-dialog.ts` CSS in `visual.less`)
Re-skin tabs, banners, buttons, tables, and console/event lines onto U1 tokens; add
the splash's accent-bar / header treatment; tighten spacing. **Behavior, tab
structure, and DOM are unchanged** — CSS-only plus minimal class hooks if needed.

### U7 — Remove W3.CSS
Delete `import 'w3-css/w3.css'` from `src/visual.ts`, drop `w3-css` from
`package.json`, and remove the now-dead `.w3-theme-*` overrides (lines ~75–142 of
`visual.less`). Confirm no remaining `w3-*` references.

## Out of scope

- Dark theme / host-theme detection.
- Rendered-content chrome, error/empty states beyond the splash, format-pane defaults.
- Wiring the Values cue to live field-well/drag state.
- Changing diagnostics tab structure, behavior, or data flow.

## Open items

None blocking. Compact breakpoint thresholds (~300×210 / ~620×420) are starting
values from the handoff and may be tuned during implementation against real
viewports.
