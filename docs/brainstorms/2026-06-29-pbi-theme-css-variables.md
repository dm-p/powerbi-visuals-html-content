# Power BI theme colors as CSS variables

**Date:** 2026-06-29
**Status:** Approved (design) — pending implementation plan
**Merge target:** `2.0.0`
**Reference:** Deneb's `pbiColor` scheme — [runtime](https://github.com/deneb-viz/deneb/blob/next/packages/vega-runtime/src/lib/extensibility/scheme/powerbi.ts), [compat shim/types](https://github.com/deneb-viz/deneb/tree/next/packages/powerbi-compat/src/lib/theme); MS [high-contrast support](https://learn.microsoft.com/en-us/power-bi/developer/visuals/high-contrast-support)

## Problem

Authors styling content in this visual have no first-class access to the host's
active theme colors. To match a report's theme they hand-copy hex values into
their HTML/CSS — duplicating what the host already knows and breaking the moment
the report theme changes. Deneb solves the equivalent problem for Vega specs with
`pbiColor` (numbered data colors + named colors); we want the same ergonomics for
plain CSS, declaratively, with no author scripting (so it works in the certified
edition).

## Goal

Expose the host theme's colors as `--pbi-theme-*` CSS custom properties on the
document root, so an author writes `color: var(--pbi-theme-color-1)` and gets the
live theme color — recoloring automatically on theme switch. Colors only; fonts
are explicitly out of scope.

## The contract

A `:root` block of `--pbi-theme-*` custom properties, sourced from
`options.host.colorPalette`.

### Numbered data colors

One variable per entry in `colorPalette.colors[]` (the theme's discrete data
palette). **1-indexed** to match the Power BI UI's "Color 1…N" labels (the array
is 0-indexed, so emit `--pbi-theme-color-${i + 1}`). N is dynamic — themes define
different palette lengths.

`colors` is **not** declared on `ISandboxExtendedColorPalette` (only `getColor(key)`
is) — it is present on the host palette at runtime but reached via a narrow cast,
mirroring Deneb. Guard with `Array.isArray` before iterating; if it is ever absent
we emit zero numbered variables (the named set still works). Chosen over looping
`getColor("0"…"k")` because `colors[]` yields the true palette length, keeping N
dynamic without a hard-coded ceiling.

```
--pbi-theme-color-1 … --pbi-theme-color-N
```

### Named colors (curated)

Each variable is emitted **only when the host actually provides the value** — this
naturally handles sparse high-contrast palettes and missing extension members.

| Variable | Host source |
|---|---|
| `--pbi-theme-fg` | `colorPalette.foreground` |
| `--pbi-theme-fg-neutral-secondary` | `colorPalette.foregroundNeutralSecondary` |
| `--pbi-theme-fg-neutral-tertiary` | `colorPalette.foregroundNeutralTertiary` |
| `--pbi-theme-bg` | `colorPalette.background` |
| `--pbi-theme-bg-light` | `colorPalette.backgroundLight` |
| `--pbi-theme-bg-neutral` | `colorPalette.backgroundNeutral` |
| `--pbi-theme-fg-selected` | `colorPalette.foregroundSelected` |
| `--pbi-theme-hyperlink` | `colorPalette.hyperlink` |
| `--pbi-theme-good` | `colorPalette.positive` |
| `--pbi-theme-bad` | `colorPalette.negative` |
| `--pbi-theme-neutral` | `colorPalette.neutral` |
| `--pbi-theme-min` | `colorPalette.minimum` |
| `--pbi-theme-center` | `colorPalette.center` |
| `--pbi-theme-max` | `colorPalette.maximium ?? colorPalette.maximum` |

**Variable names mirror the JSON theme-schema keys** (what a theme author sees in
the theme file), not the runtime palette member names where the two differ:

- **Sentiment:** the theme JSON uses `good` / `bad` / `neutral`; the runtime
  palette members are `positive` / `negative` / `neutral`. We read the runtime
  members but name the variables `--pbi-theme-good` / `-bad` / `-neutral`. (Both
  the theme-editor UI and the runtime API say "positive/negative", so this is a
  deliberate choice to follow the JSON schema — consistent with `center` below.)
- **Divergent:** `--pbi-theme-center` matches the JSON key exactly; `--pbi-theme-min`
  / `-max` trim `minimum` / `maximum` to match the `fg` / `bg` convention.

Typing notes: `positive` / `negative` / `neutral` are declared on
`ISandboxExtendedColorPalette` (optional) — no cast. The divergent members
(`minimum` / `center` / `maximium`) are **not** on the typed interface and are
reached via the same narrow cast used for `colors[]`. `--pbi-theme-max` reads
`maximium ?? maximum`: the runtime object historically carries the upstream
`maximium` typo, while the theme JSON uses the correct `maximum`. Every member is
still emitted only when present and valid, so a theme that omits any of these just
skips the variable.

## Injection

- **One dedicated `<style id="pbiThemeVars">` element**, appended in the
  **constructor** and written once. It is separate from the existing head
  `<style>` that `resolveStyling` (`src/domain-utils.ts`) rewrites every update —
  so the theme variables are never clobbered.
- **No update-time refresh, no memoization.** A theme or contrast switch re-runs
  the constructor, which re-reads the palette and rewrites the block.
  - **Assumption to verify at implementation:** that Power BI re-instantiates the
    visual (new constructor) on theme/contrast change. If that proves false, the
    fallback is to also write the block from `update()`; the design does not
    otherwise change.
- **Value validation guard.** Each color value is tested against a simple
  hex / `rgb()` / `rgba()` pattern before being written into the stylesheet.
  Host values are trusted, but this is a cheap trust-boundary guard consistent
  with the visual's existing CSS sanitizer. Values that fail the test are skipped
  (their variable is simply not emitted).

## High contrast

Values are **honest pass-through** — variables always carry their true palette
value, never a translated one. The decision to adapt for high contrast belongs to
the author, who is given a declarative signal to act on.

- The constructor reflects `colorPalette.isHighContrast` onto the **`#htmlContent`**
  container as the class **`pbi-theme-hc`** (a single `.classed('pbi-theme-hc', isHC)`).
  Present only in high-contrast mode. `#htmlContent` (not `documentElement`) is
  chosen deliberately: it is the serialized root of the **Show raw HTML** debug
  view, so the cue appears as `<div id="htmlContent" class="pbi-theme-hc">` when an
  author inspects their markup. It remains an ancestor of all rendered content, so
  `.pbi-theme-hc .foo` author selectors still match.
- Authors branch in **pure CSS** — no scripting, certified-edition safe:

  ```css
  /* normal: themed; high contrast: collapse to the four HC-safe colors */
  .badge { color: var(--pbi-theme-color-1); }
  .pbi-theme-hc .badge {
      color: var(--pbi-theme-fg);
      background: var(--pbi-theme-bg);
  }
  ```

- Per MS guidance, the four colors safe to rely on in high contrast are
  `fg`, `bg`, `fg-selected`, and `hyperlink`. Authors who follow that guidance
  read those four under `.pbi-theme-hc`.

### Forced-colors interaction (important)

In Windows high contrast the embedded browser also enters CSS **forced-colors
mode** (`forced-colors: active`), which overrides author `background-color` /
`color` with the OS system palette. The theme variables still hold the correct
HC values, but the browser won't *paint* `background: var(--pbi-theme-*)` unless
the element opts out with `forced-color-adjust: none`. So:

- For most content, **let forced-colors win** — it's the accessibility default;
  don't blanket-override it.
- An author who needs controlled theming in HC opts a specific element out
  (`forced-color-adjust: none`) and then applies the HC-safe vars under
  `.pbi-theme-hc`.
- The UAT probe sets `forced-color-adjust: none` on its swatches precisely
  because its job is to *display* the palette — a debug-only choice, not a
  pattern to copy into production content.

### Naming note

The `hc-` prefix in this codebase is the project's **html-content** namespace
(`--hc-bg1`, `.hc-landing`, `.hc-diagnostics`, `data-hc-suppress`, …) — it does
**not** mean high contrast. The high-contrast signal is therefore namespaced under
`pbi-theme-` (`pbi-theme-hc`) to avoid that collision and to sit alongside the
variables it pairs with.

## UAT corpus

A `Theme Color Probe` measure in the UAT semantic model (`stylesheet` table of
`test-uat/html-content-uat.SemanticModel`) returning an HTML swatch grid, bound to
an **HTML Content** visual and recoloring live on theme switch. It supersedes the
earlier standalone `test-uat/theme-probe.dax` (removed once the measure was added
to the workbook).

- One labelled swatch per variable, grouped into five `flex-wrap` sections that
  reflow on resize: **Theme colors** (`--pbi-theme-color-1` … `-12`),
  **Sentiment colors** (`good`/`bad`/`neutral`), **Divergent colors**
  (`min`/`center`/`max`), **High contrast colors** (the four MS-documented HC-safe
  colors: `fg`/`bg`/`fg-selected`/`hyperlink`, for eyeballing under Windows high
  contrast), and **Other colors** (the remaining structural set).
- Each swatch uses a fallback chain so unset slots degrade visibly rather than
  rendering nothing:
  `background: var(--pbi-theme-color-3, var(--pbi-theme-fg, transparent))`.
- The layout is `.pbi-theme-hc`-aware, so toggling Windows high contrast doubles
  as a visual check of the signal.
- **Verified via the Desktop Bridge** (TOM measure edit + reload/screenshot)
  against the `CY25SU11` theme in both editions: every variable populates,
  including the divergent `min`/`center`/`max` — confirming the runtime
  `host.colorPalette` exposes the divergent members.
- **Limitation by design:** CSS cannot print a variable's resolved hex as text
  (there is no var→text). The corpus debugs colors **visually** (swatch + label),
  not as hex strings. For exact values, authors use DevTools or the diagnostics
  dialog.

## Known limitation (documented, not fixed)

Inline `srcdoc` iframes inside author content are separate documents — neither the
`:root` variables nor the `.pbi-theme-hc` class cascade into them. Authors styling
content directly (the common case) get both. This matches the existing iframe
caveat for templated content.

## Deliberately out of scope (YAGNI)

- **No enable/disable toggle.** The variables are inert until an author references
  them; injecting them always is harmless and one fewer property to persist.
- **No fonts / typography.** Colors only, per the brief.
- **No `tableAccent` / `visitedHyperlink` / `null` (empty) colors.** Present in the
  theme schema but out of scope for the first cut; additive later if asked.
- **No value translation in high contrast.** The author opts in via `.pbi-theme-hc`;
  we do not silently rewrite colors.
- **No update-time refresh** (see Injection assumption).

## Open questions

None blocking. The single implementation-time check is the constructor-re-runs-on-
theme-switch assumption noted under Injection.
