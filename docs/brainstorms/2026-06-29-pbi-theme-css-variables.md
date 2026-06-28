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

```
--pbi-theme-color-1 … --pbi-theme-color-N
```

### Named colors (curated)

Each variable is emitted **only when the host actually provides the value** — this
naturally handles sparse high-contrast palettes and missing extension members.

| Variable | Host source |
|---|---|
| `--pbi-theme-foreground` | `colorPalette.foreground` |
| `--pbi-theme-foreground-neutral-secondary` | `colorPalette.foregroundNeutralSecondary` |
| `--pbi-theme-foreground-neutral-tertiary` | `colorPalette.foregroundNeutralTertiary` |
| `--pbi-theme-background` | `colorPalette.background` |
| `--pbi-theme-background-light` | `colorPalette.backgroundLight` |
| `--pbi-theme-background-neutral` | `colorPalette.backgroundNeutral` |
| `--pbi-theme-foreground-selected` | `colorPalette.foregroundSelected` |
| `--pbi-theme-hyperlink` | `colorPalette.hyperlink` |
| `--pbi-theme-positive` | extension `positive` |
| `--pbi-theme-negative` | extension `negative` |
| `--pbi-theme-neutral` | extension `neutral` |
| `--pbi-theme-min` | extension `minimum` |
| `--pbi-theme-center` | extension `center` |
| `--pbi-theme-max` | extension `maximium ?? maximum` |

The sentiment (`positive`/`negative`/`neutral`) and divergent
(`minimum`/`center`/`maximium`) members are **not** in the typed
`ISandboxExtendedColorPalette` but are present on the host palette at runtime
(this is the gap Deneb's `PowerBIColorPaletteExtension` type fills). Access them
through a typed cast mirroring Deneb's extension. `--pbi-theme-max` reads
`maximium ?? maximum` to absorb the known upstream typo while remaining correct if
it is ever fixed.

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

- The constructor reflects `colorPalette.isHighContrast` onto `documentElement`
  as the class **`pbi-theme-hc`** (a single `classList.toggle('pbi-theme-hc', isHC)`).
  Present only in high-contrast mode.
- Authors branch in **pure CSS** — no scripting, certified-edition safe:

  ```css
  /* normal: themed; high contrast: collapse to the four HC-safe colors */
  .badge { color: var(--pbi-theme-color-1); }
  .pbi-theme-hc .badge {
      color: var(--pbi-theme-foreground);
      background: var(--pbi-theme-background);
  }
  ```

- Per MS guidance, the four colors safe to rely on in high contrast are
  `foreground`, `background`, `foreground-selected`, and `hyperlink`. Authors who
  follow that guidance read those four under `.pbi-theme-hc`.

### Naming note

The `hc-` prefix in this codebase is the project's **html-content** namespace
(`--hc-bg1`, `.hc-landing`, `.hc-diagnostics`, `data-hc-suppress`, …) — it does
**not** mean high contrast. The high-contrast signal is therefore namespaced under
`pbi-theme-` (`pbi-theme-hc`) to avoid that collision and to sit alongside the
variables it pairs with.

## UAT corpus

A committed `.dax` snippet — a single measure returning an HTML swatch grid — that
drops into the UAT workbook's model and recolors live on theme switch.

- One labelled swatch per variable: a fixed numbered probe range
  (`--pbi-theme-color-1` … `-12`) plus every named variable.
- Each swatch uses a fallback chain so unset slots degrade visibly rather than
  rendering nothing:
  `background: var(--pbi-theme-color-3, var(--pbi-theme-foreground, transparent))`.
- Ships with a small layout stylesheet snippet that is `.pbi-theme-hc`-aware, so
  toggling Windows high contrast doubles as a visual check of the signal.
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
- **No non-Power-BI shim.** The visual only ever runs inside the host; the Deneb
  shim exists for environments this visual never targets.
- **No value translation in high contrast.** The author opts in via `.pbi-theme-hc`;
  we do not silently rewrite colors.
- **No update-time refresh** (see Injection assumption).

## Open questions

None blocking. The single implementation-time check is the constructor-re-runs-on-
theme-switch assumption noted under Injection.
