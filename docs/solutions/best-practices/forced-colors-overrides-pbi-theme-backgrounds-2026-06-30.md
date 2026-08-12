---
title: "Theme --pbi-theme-* backgrounds appear blank under Windows high contrast (forced-colors)"
date: 2026-06-30
category: best-practices
module: theme-css-variables
problem_type: best_practice
component: frontend_stimulus
severity: low
applies_when:
  - "Styling rendered HTML with var(--pbi-theme-*) background-color or color"
  - "Windows high contrast (e.g. the Aquatic theme) is active"
  - "Branching content on the .pbi-theme-hc class set on #htmlContent"
  - "Building debug or probe surfaces that must show raw theme swatches"
symptoms:
  - "Swatches using background: var(--pbi-theme-fg) render as uniform or empty boxes"
  - "Author background-color and color appear ignored under high contrast"
  - "--pbi-theme-* variables look like they are not populating"
tags:
  - high-contrast
  - forced-colors
  - "forced-color-adjust"
  - accessibility
  - css-custom-properties
  - theme-palette
  - power-bi
  - "windows-hc"
related_components:
  - theme-variables.ts
  - visual.ts
  - visual-constants.ts
---

# Theme `--pbi-theme-*` backgrounds appear blank under Windows high contrast (forced-colors)

## Context

Under Windows high contrast (e.g. the "Aquatic" theme), the visual exposes the host palette as `--pbi-theme-*` CSS custom properties on `:root`, and sets `.pbi-theme-hc` on `#htmlContent` when `host.colorPalette.isHighContrast` is true. A debug probe rendered swatches with `background: var(--pbi-theme-*)` — and every swatch came out uniform/empty, as if the variables had failed to populate. It looked like a broken feature.

It is not. The variables carry correct HC values (Power BI's `colorPalette` returns HC values, the constructor re-runs on the contrast switch, and `.pbi-theme-hc` is present). What changed is the *browser*: Windows HC puts the embedded Chromium (WebView2) into CSS **forced-colors mode** (`forced-colors: active`), and the user agent overrides author `background-color`/`color`/border/shadow with the OS system-color palette as an accessibility safeguard. The swatches paint the system `Canvas` colour, so they look empty even though the variables are fine.

There are two independent layers at play:

1. **Power BI's HC palette** — supplies correct HC values into the `--pbi-theme-*` variables.
2. **The browser's forced-colors enforcement** — refuses to paint author backgrounds/colours regardless of what those variables hold.

## Guidance

Respect forced-colors **by default**. It is an accessibility feature, not a rendering bug — do not blanket-override it across your content.

When you genuinely need to show a specific colour (a debug surface, a swatch, or a deliberately themed element), opt **that element** out narrowly with `forced-color-adjust: none`:

```css
/* Debug/probe surface whose entire job is to display colours */
.swatch {
  background: var(--pbi-theme-fg);
  forced-color-adjust: none; /* deliberate, narrow opt-out */
}
```

For controlled HC theming of normal content, opt specific elements out **and** restrict yourself to the four Microsoft HC-safe colours, scoped under `.pbi-theme-hc`:

```css
.pbi-theme-hc .callout {
  forced-color-adjust: none;
  color: var(--pbi-theme-fg);
  background: var(--pbi-theme-bg);
}
.pbi-theme-hc .callout a {
  color: var(--pbi-theme-hyperlink);
}
.pbi-theme-hc .callout .is-selected {
  color: var(--pbi-theme-fg-selected);
}
```

The four HC-safe variables: `--pbi-theme-fg`, `--pbi-theme-bg`, `--pbi-theme-fg-selected`, `--pbi-theme-hyperlink`. The visual's CSS sanitizer passes `forced-color-adjust` through (it is benign), so this works in the certified edition too.

## Why This Matters

The failure mode is indistinguishable from a real bug at a glance: colours don't show, so the natural conclusion is "the variables aren't populating." That sends you debugging the wrong layer — inspecting `theme-variables.ts`, re-checking the constructor, doubting `colorPalette` — when the values were correct the whole time. Knowing the two layers are independent (PBI HC palette vs browser forced-colors) tells you immediately *where* to look: the variables are honest pass-through; the browser is the one withholding paint.

It also matters for accessibility. Forced-colors exists so users who need high-contrast or specific colour schemes get a predictable, legible palette. Blanket-applying `forced-color-adjust: none` to "fix" the appearance defeats that safeguard and can make content *less* accessible for the very users HC serves. The opt-out is a scalpel, not a switch: use it on the few elements that truly need a known colour, and prefer the HC-safe vars so what you paint stays legible under HC.

## When to Apply

- Styling elements with `--pbi-theme-*` variables and targeting (or testing under) Windows high contrast.
- Debugging a "theme colours don't show / swatches are empty in HC" report — confirm `forced-colors: active` before suspecting the variable pipeline.
- Building debug probes, swatches, or colour-preview surfaces that must display real colours regardless of forced-colors.
- Authoring deliberately HC-themed content under `.pbi-theme-hc` (use the four HC-safe vars; opt out per element).

## Examples

**Before — swatch looks empty under Windows HC:**

```css
.swatch {
  background: var(--pbi-theme-fg); /* paints system Canvas under forced-colors -> appears empty */
}
```

**After — opt the probe surface out so the real value shows:**

```css
.swatch {
  background: var(--pbi-theme-fg);
  forced-color-adjust: none; /* reveals the actual HC value the variable carries */
}
```

**Recommended — controlled HC theming with the HC-safe palette:**

```css
.pbi-theme-hc .panel {
  forced-color-adjust: none;
  color: var(--pbi-theme-fg);
  background: var(--pbi-theme-bg);
  border: 1px solid var(--pbi-theme-fg);
}
.pbi-theme-hc .panel a {
  color: var(--pbi-theme-hyperlink);
}
.pbi-theme-hc .panel .selected {
  background: var(--pbi-theme-fg-selected);
  color: var(--pbi-theme-bg);
}
```

## Related

- **Design spec (canonical mechanism + rationale):** `docs/brainstorms/2026-06-29-pbi-theme-css-variables.md` — see *High contrast > Forced-colors interaction (important)*. Explains the same root cause and the "respect by default, opt out narrowly" rule, and why the UAT probe's `forced-color-adjust: none` is a debug-only display choice.
- **Author-facing guide:** `docs/v2/HTML-Content-v2-Guide.md` — *Theme colours > High contrast / Forced colours*, with Microsoft's four HC-safe colours and a worked `.pbi-theme-hc` example.
- **Source:** `src/theme-variables.ts` (builds the `:root { --pbi-theme-* }` block; honest pass-through, never translated for HC), `src/visual.ts` (sets `.pbi-theme-hc` on `#htmlContent` from `host.colorPalette.isHighContrast`), `src/visual-constants.ts` (`themeHighContrastClass: 'pbi-theme-hc'`).
- No related `docs/solutions/` entries and no matching GitHub issues at time of writing.
