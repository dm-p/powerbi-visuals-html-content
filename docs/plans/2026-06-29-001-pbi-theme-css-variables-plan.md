# Power BI theme CSS variables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the host theme's colors as `--pbi-theme-*` CSS custom properties (numbered data colors + curated named colors) on the document root, plus a `.pbi-theme-hc` high-contrast signal, so authors style content against the live theme declaratively.

**Architecture:** A pure builder (`src/theme-variables.ts`) turns the host `colorPalette` into a `:root { … }` CSS string; the constructor writes it once into a dedicated `<style>` element and toggles the HC class on `documentElement`. All logic lives in the unit-tested builder; the constructor change is trivial glue (matching this codebase, which has no `visual.ts` test). A self-contained DAX measure provides the UAT probe.

**Tech Stack:** TypeScript, d3-selection (already used for the existing `<style>` element), vitest (jsdom), `powerbi-visuals-api` types.

> **Post-implementation amendment (2026-06-29):** after a naming audit against the
> theme JSON schema (`test-uat/.../BaseThemes/CY25SU11.json`), the named contract
> changed from what the Task 2/4 code blocks below show. Sentiment variables were
> renamed to mirror the JSON keys — `--pbi-theme-positive`/`-negative` → **`--pbi-theme-good`/`-bad`**
> (still reading the runtime `positive`/`negative` members) — and the **divergent
> endpoints `--pbi-theme-min` / `-center` / `-max` were added** (`max` reads
> `maximium ?? maximum`). The builder's `NAMED` entries now map a suffix to a list
> of candidate members (first present-and-valid wins). The **spec is the source of
> truth** for the final contract; the Task 2/4 snippets below are pre-amendment.
>
> The Task 4 UAT probe also moved: the standalone `test-uat/theme-probe.dax` was
> removed and the probe now lives as the `Theme Color Probe` measure in the UAT
> semantic model (`stylesheet` table), redesigned into five `flex-wrap` sections
> (Theme / Sentiment / Divergent / High contrast / Other) and verified via the
> Desktop Bridge.

---

## Pre-flight notes (read once, no action)

- **Spec:** `docs/brainstorms/2026-06-29-pbi-theme-css-variables.md`. This plan implements it verbatim.
- **Sanitizer is already compatible — no sanitizer task needed.** Author content that references `var(--pbi-theme-*)` survives `src/css-sanitizer.ts` untouched: custom properties are walked like any declaration (see its header comment, "CSS custom properties (`--foo`) are covered"), and `var()` is not a denied function and trips none of the `url(`/`expression(`/`-moz-binding(`/`attr(` guards. Our own `:root` block is written directly to a style element we control and never passes through the author sanitizer — it is guarded only by the hex/rgb validation in this plan.
- **Constructor-re-run assumption.** The design assumes Power BI re-instantiates the visual (new constructor) on a theme/contrast switch. Verified manually in Task 5. If it proves false, the only change is to also call the builder from `update()`; nothing else in the design moves.
- **No `visual.ts` integration test exists** (every test targets pure modules). We keep that pattern: the builder is fully tested; the constructor glue is verified by typecheck + manual UAT.
- **CI gates — run before each commit that touches `src/`:** `npm run prettier-check` (gates `src,spec,style` only — `test/` and `test-uat/` are outside the glob) and `npm run eslint` (gates everything). If prettier-check flags the new source file, run `npm run prettier-format` and re-stage. `npm test` auto-selects the certified edition via the `pretest` hook — no manual edition switch needed.

---

## File structure

- **Create** `src/theme-variables.ts` — pure: `isValidColorValue()` guard + `buildThemeVariablesCss()`. One responsibility: palette → CSS string.
- **Create** `test/theme-variables.test.ts` — unit tests for both exports.
- **Modify** `src/visual-constants.ts` — add two `dom` constants (`themeVarsIdSelector`, `themeHighContrastClass`).
- **Modify** `test/visual-constants.test.ts` — assert the two new constants.
- **Modify** `src/visual.ts` — constructor: write the `<style>` block + toggle the HC class.
- **Create** `test-uat/theme-probe.dax` — self-contained UAT probe measure.
- **Modify** `docs/uat.md` — short section on binding the probe.

---

## Task 1: DOM constants

**Files:**
- Modify: `src/visual-constants.ts` (the `dom` object, ends at line 271 — add keys before the closing `}`)
- Test: `test/visual-constants.test.ts`

- [ ] **Step 1: Add the two constants**

In `src/visual-constants.ts`, inside the `dom: { … }` object, add after the `suppressAllToken: 'all'` line (keep the trailing comma on that line):

```typescript
        suppressAllToken: 'all',
        // Theme CSS variables. The constructor writes a dedicated <style>
        // (themeVarsIdSelector) holding the :root { --pbi-theme-* } block, and
        // reflects host high-contrast state as themeHighContrastClass on
        // documentElement so authors can branch in pure CSS (`.pbi-theme-hc …`).
        // `hc-` is NOT used: it is this project's html-content token namespace.
        themeVarsIdSelector: 'pbiThemeVars',
        themeHighContrastClass: 'pbi-theme-hc'
```

- [ ] **Step 2: Add assertions**

In `test/visual-constants.test.ts`, after the `manualTooltipDataValue` assertion (around line 91), add:

```typescript
            expect(VisualConstants.dom.themeVarsIdSelector).toBe('pbiThemeVars');
            expect(VisualConstants.dom.themeHighContrastClass).toBe(
                'pbi-theme-hc'
            );
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run test/visual-constants.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/visual-constants.ts test/visual-constants.test.ts
git commit -m "feat(theme): add DOM constants for theme variables + HC class"
```

---

## Task 2: The pure builder (`src/theme-variables.ts`)

**Files:**
- Create: `src/theme-variables.ts`
- Test: `test/theme-variables.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/theme-variables.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
    isValidColorValue,
    buildThemeVariablesCss
} from '../src/theme-variables';

// Minimal palette stand-in: the builder only reads `.colors`, the named
// members, and `.value` on each — a plain literal cast suffices (no host mock).
const palette = (overrides: Record<string, unknown>): any => ({ ...overrides });

describe('isValidColorValue', () => {
    it('accepts hex (3/4/6/8) and rgb/rgba', () => {
        for (const v of [
            '#fff',
            '#ffff',
            '#ffffff',
            '#ffffffff',
            'rgb(1, 2, 3)',
            'rgba(1,2,3,.5)'
        ]) {
            expect(isValidColorValue(v)).toBe(true);
        }
    });

    it('rejects empty, undefined, named colors, and injection attempts', () => {
        for (const v of [
            '',
            undefined,
            'red',
            'transparent',
            'red; } body { display: none }'
        ]) {
            expect(isValidColorValue(v as any)).toBe(false);
        }
    });
});

describe('buildThemeVariablesCss', () => {
    it('emits 1-indexed numbered colors from colors[]', () => {
        const css = buildThemeVariablesCss(
            palette({
                colors: [{ value: '#111111' }, { value: '#222222' }]
            })
        );
        expect(css).toContain('--pbi-theme-color-1: #111111;');
        expect(css).toContain('--pbi-theme-color-2: #222222;');
        expect(css).not.toContain('--pbi-theme-color-0');
        expect(css.startsWith(':root {')).toBe(true);
    });

    it('emits curated named colors, including optional sentiment', () => {
        const css = buildThemeVariablesCss(
            palette({
                foreground: { value: '#000000' },
                background: { value: '#ffffff' },
                foregroundSelected: { value: '#0078d4' },
                hyperlink: { value: '#0563c1' },
                positive: { value: '#107c10' }
            })
        );
        expect(css).toContain('--pbi-theme-fg: #000000;');
        expect(css).toContain('--pbi-theme-bg: #ffffff;');
        expect(css).toContain('--pbi-theme-fg-selected: #0078d4;');
        expect(css).toContain('--pbi-theme-hyperlink: #0563c1;');
        expect(css).toContain('--pbi-theme-positive: #107c10;');
    });

    it('skips missing members and invalid values', () => {
        const css = buildThemeVariablesCss(
            palette({
                foreground: { value: '#000000' },
                background: { value: 'red; }evil' }, // invalid → skipped
                colors: [{ value: 'not-a-color' }] // invalid → skipped
            })
        );
        expect(css).toContain('--pbi-theme-fg: #000000;');
        expect(css).not.toContain('--pbi-theme-bg');
        expect(css).not.toContain('--pbi-theme-color-1');
    });

    it('handles a missing colors[] array (named only)', () => {
        const css = buildThemeVariablesCss(
            palette({ foreground: { value: '#000000' } })
        );
        expect(css).toContain('--pbi-theme-fg: #000000;');
        expect(css).not.toContain('--pbi-theme-color');
    });

    it('returns empty string when nothing valid is present', () => {
        expect(buildThemeVariablesCss(palette({}))).toBe('');
    });

    it('does not translate values in high contrast (pass-through)', () => {
        const css = buildThemeVariablesCss(
            palette({
                isHighContrast: true,
                foreground: { value: '#ffffff' },
                colors: [{ value: '#ff0000' }]
            })
        );
        // numbered color keeps its true value — no collapse to foreground
        expect(css).toContain('--pbi-theme-color-1: #ff0000;');
        expect(css).toContain('--pbi-theme-fg: #ffffff;');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/theme-variables.test.ts`
Expected: FAIL — cannot resolve `../src/theme-variables` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `src/theme-variables.ts`:

```typescript
/**
 * Build the `:root { --pbi-theme-* }` CSS block exposing the host theme's
 * colors as custom properties. Pure (no DOM) so it is unit-tested directly;
 * the constructor writes the result into a dedicated <style> element.
 *
 * Values are honest pass-through — never translated for high contrast. The
 * author opts into HC handling via the `.pbi-theme-hc` class (set elsewhere).
 */
import powerbi from 'powerbi-visuals-api';
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;

// `colors` (the numbered data palette) is present on the host palette at
// runtime but NOT declared on ISandboxExtendedColorPalette (only getColor is).
// Reached via this narrow shape, mirroring Deneb's PowerBIColorPaletteExtension.
interface PaletteColors {
    colors?: { value?: string }[];
}

// Curated named contract: variable suffix → palette member name. Order is the
// public contract order. Sentiment members are optional on the interface and
// simply absent on themes that don't define them (the guard below skips them).
// Divergent endpoints (min/center/max) are deliberately excluded — see spec.
const NAMED: { suffix: string; member: string }[] = [
    { suffix: 'fg', member: 'foreground' },
    { suffix: 'fg-neutral-secondary', member: 'foregroundNeutralSecondary' },
    { suffix: 'fg-neutral-tertiary', member: 'foregroundNeutralTertiary' },
    { suffix: 'bg', member: 'background' },
    { suffix: 'bg-light', member: 'backgroundLight' },
    { suffix: 'bg-neutral', member: 'backgroundNeutral' },
    { suffix: 'fg-selected', member: 'foregroundSelected' },
    { suffix: 'hyperlink', member: 'hyperlink' },
    { suffix: 'positive', member: 'positive' },
    { suffix: 'negative', member: 'negative' },
    { suffix: 'neutral', member: 'neutral' }
];

// Trust-boundary guard: only hex (#rgb/#rgba/#rrggbb/#rrggbbaa) or rgb()/rgba()
// values are written into our <style>. Anything else (named colors the host
// never emits, or an injection attempt like "red; }…") is dropped. Consistent
// with the visual's CSS-sanitizer posture; cheap defense-in-depth.
const COLOR_VALUE =
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\([0-9.,\s%]+\)$/i;

export function isValidColorValue(value: string | undefined): boolean {
    return typeof value === 'string' && COLOR_VALUE.test(value.trim());
}

export function buildThemeVariablesCss(
    palette: ISandboxExtendedColorPalette
): string {
    const decls: string[] = [];

    // Numbered data colors — 1-indexed to match the PBI UI's "Color 1…N".
    const numbered = (palette as unknown as PaletteColors).colors;
    if (Array.isArray(numbered)) {
        numbered.forEach((c, i) => {
            if (isValidColorValue(c?.value)) {
                decls.push(`--pbi-theme-color-${i + 1}: ${c.value};`);
            }
        });
    }

    // Curated named colors — emit only when present and valid.
    const bag = palette as unknown as Record<string, { value?: string }>;
    for (const { suffix, member } of NAMED) {
        const info = bag[member];
        if (info && isValidColorValue(info.value)) {
            decls.push(`--pbi-theme-${suffix}: ${info.value};`);
        }
    }

    return decls.length ? `:root { ${decls.join(' ')} }` : '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/theme-variables.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/theme-variables.ts test/theme-variables.test.ts
git commit -m "feat(theme): build --pbi-theme-* CSS from the host palette"
```

---

## Task 3: Wire the builder into the constructor

**Files:**
- Modify: `src/visual.ts` (imports near line 25; constructor body around lines 156–160)

- [ ] **Step 1: Add the import**

In `src/visual.ts`, after the existing internal imports (e.g. after the `VisualConstants` import on line 25), add:

```typescript
import { buildThemeVariablesCss } from './theme-variables';
```

- [ ] **Step 2: Write the style block + toggle the HC class**

In the constructor, immediately after the `this.styleSheetContainer = select('head')…` block (which currently ends at line 160 with `.attr('type', 'text/css');`), insert:

```typescript
        // Expose the host theme palette as --pbi-theme-* custom properties for
        // authors to consume in content / custom stylesheet. Written once: a
        // theme or contrast switch re-runs the constructor, refreshing this.
        // This <style> is intentionally separate from styleSheetContainer,
        // which resolveStyling() overwrites on every update.
        select('head')
            .append('style')
            .attr('id', VisualConstants.dom.themeVarsIdSelector)
            .attr('type', 'text/css')
            .text(buildThemeVariablesCss(this.host.colorPalette));
        // Declarative high-contrast signal: authors branch with `.pbi-theme-hc`
        // in pure CSS (no scripting; certified-edition safe). Values themselves
        // are honest pass-through — the author decides how to adapt.
        document.documentElement.classList.toggle(
            VisualConstants.dom.themeHighContrastClass,
            !!this.host.colorPalette.isHighContrast
        );
```

(`this.host` is assigned just above, on line 148, so `this.host.colorPalette` is available here.)

- [ ] **Step 3: Typecheck + full test suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS (existing suite unaffected; new theme tests pass).

- [ ] **Step 4: Commit**

```bash
git add src/visual.ts
git commit -m "feat(theme): inject --pbi-theme-* vars and HC class in constructor"
```

---

## Task 4: UAT probe measure + docs

**Files:**
- Create: `test-uat/theme-probe.dax`
- Modify: `docs/uat.md`

- [ ] **Step 1: Create the probe measure**

Create `test-uat/theme-probe.dax`. It is a single self-contained HTML string: a `<style>` block (layout + `.pbi-theme-hc` demo) followed by labelled swatches. Each swatch falls back to `--pbi-theme-fg` then `transparent`, so unset numbered slots (and HC) degrade visibly. Bind this measure to an **HTML Content** visual's data field.

It is committed as a standalone artifact — intentionally **not** wired into `scripts/generate-uat-corpus.ts`. That generator produces the sanitization-regression CSVs from payload matrices; a single static theme probe doesn't belong in it, and `<style>`-in-data is already covered there as sanitization surface 2.

```dax
-- UAT probe for the --pbi-theme-* CSS variables (spec 2026-06-29).
-- Bind to an HTML Content visual's field. Switch the report theme and toggle
-- Windows high contrast: swatches recolor live; the HC banner appears when the
-- host reports high-contrast mode. Unset numbered slots fall back to fg.
Theme Color Probe =
"<style>" &
".tcp{display:flex;flex-wrap:wrap;gap:6px;font:11px 'Segoe UI',sans-serif;align-items:flex-start}" &
".tcp .s{width:96px;height:56px;border:1px solid #ccc;border-radius:4px;display:flex;align-items:flex-end;padding:3px;box-sizing:border-box}" &
".tcp .s span{background:rgba(255,255,255,.78);padding:0 3px;border-radius:2px}" &
".tcp .hcflag{display:none;width:100%;font-weight:700;color:var(--pbi-theme-fg,#000)}" &
".pbi-theme-hc .tcp .hcflag{display:block}" &
".c1{background:var(--pbi-theme-color-1,var(--pbi-theme-fg,transparent))}" &
".c2{background:var(--pbi-theme-color-2,var(--pbi-theme-fg,transparent))}" &
".c3{background:var(--pbi-theme-color-3,var(--pbi-theme-fg,transparent))}" &
".c4{background:var(--pbi-theme-color-4,var(--pbi-theme-fg,transparent))}" &
".c5{background:var(--pbi-theme-color-5,var(--pbi-theme-fg,transparent))}" &
".c6{background:var(--pbi-theme-color-6,var(--pbi-theme-fg,transparent))}" &
".c7{background:var(--pbi-theme-color-7,var(--pbi-theme-fg,transparent))}" &
".c8{background:var(--pbi-theme-color-8,var(--pbi-theme-fg,transparent))}" &
".c9{background:var(--pbi-theme-color-9,var(--pbi-theme-fg,transparent))}" &
".c10{background:var(--pbi-theme-color-10,var(--pbi-theme-fg,transparent))}" &
".c11{background:var(--pbi-theme-color-11,var(--pbi-theme-fg,transparent))}" &
".c12{background:var(--pbi-theme-color-12,var(--pbi-theme-fg,transparent))}" &
".nfg{background:var(--pbi-theme-fg,transparent)}" &
".nfgs{background:var(--pbi-theme-fg-neutral-secondary,transparent)}" &
".nfgt{background:var(--pbi-theme-fg-neutral-tertiary,transparent)}" &
".nbg{background:var(--pbi-theme-bg,transparent)}" &
".nbgl{background:var(--pbi-theme-bg-light,transparent)}" &
".nbgn{background:var(--pbi-theme-bg-neutral,transparent)}" &
".nfgsel{background:var(--pbi-theme-fg-selected,transparent)}" &
".nhl{background:var(--pbi-theme-hyperlink,transparent)}" &
".npos{background:var(--pbi-theme-positive,transparent)}" &
".nneg{background:var(--pbi-theme-negative,transparent)}" &
".nneu{background:var(--pbi-theme-neutral,transparent)}" &
"</style>" &
"<div class='tcp'>" &
"<div class='hcflag'>HIGH CONTRAST ACTIVE (.pbi-theme-hc)</div>" &
"<div class='s c1'><span>color-1</span></div>" &
"<div class='s c2'><span>color-2</span></div>" &
"<div class='s c3'><span>color-3</span></div>" &
"<div class='s c4'><span>color-4</span></div>" &
"<div class='s c5'><span>color-5</span></div>" &
"<div class='s c6'><span>color-6</span></div>" &
"<div class='s c7'><span>color-7</span></div>" &
"<div class='s c8'><span>color-8</span></div>" &
"<div class='s c9'><span>color-9</span></div>" &
"<div class='s c10'><span>color-10</span></div>" &
"<div class='s c11'><span>color-11</span></div>" &
"<div class='s c12'><span>color-12</span></div>" &
"<div class='s nfg'><span>fg</span></div>" &
"<div class='s nfgs'><span>fg-neutral-secondary</span></div>" &
"<div class='s nfgt'><span>fg-neutral-tertiary</span></div>" &
"<div class='s nbg'><span>bg</span></div>" &
"<div class='s nbgl'><span>bg-light</span></div>" &
"<div class='s nbgn'><span>bg-neutral</span></div>" &
"<div class='s nfgsel'><span>fg-selected</span></div>" &
"<div class='s nhl'><span>hyperlink</span></div>" &
"<div class='s npos'><span>positive</span></div>" &
"<div class='s nneg'><span>negative</span></div>" &
"<div class='s nneu'><span>neutral</span></div>" &
"</div>"
```

- [ ] **Step 2: Document binding it in `docs/uat.md`**

Append this section to the end of `docs/uat.md`:

```markdown
## Theme CSS variables (`--pbi-theme-*`)

The visual exposes the host theme's colors as `--pbi-theme-*` CSS custom
properties (numbered `--pbi-theme-color-1…N` plus curated named colors such as
`--pbi-theme-fg`, `--pbi-theme-bg`, `--pbi-theme-positive`). Authors consume them
directly in content or the Custom stylesheet — no need to hard-code hex values.

**Probe:** add the measure in `test-uat/theme-probe.dax` to the semantic model and
bind it to an **HTML Content** visual. It renders a labelled swatch grid driven
entirely by the variables.

Verify:

1. **Live theming** — switch the report theme (View > Themes). Every swatch
   recolors to the new palette without editing the measure.
2. **Dynamic count** — themes with fewer than 12 data colors leave the surplus
   numbered swatches falling back to the foreground color (the `var(…, fg)`
   chain), confirming we emit only the colors the host actually provides.
3. **High contrast** — enable Windows high contrast. The "HIGH CONTRAST ACTIVE"
   banner appears (the `.pbi-theme-hc` class is set on the document root) and the
   named `fg`/`bg`/`fg-selected`/`hyperlink` swatches take their HC values. Values
   are pass-through: the author decides how to adapt via `.pbi-theme-hc` in CSS.

**Known limitation:** inline `srcdoc` iframes in author content are separate
documents — neither the `:root` variables nor `.pbi-theme-hc` cascade into them.
```

- [ ] **Step 3: Commit**

```bash
git add test-uat/theme-probe.dax docs/uat.md
git commit -m "test(theme): add --pbi-theme-* UAT probe measure and docs"
```

---

## Task 5: Manual verification (closeout)

**No code.** Confirms the runtime behavior the unit tests can't (real host palette + the constructor-re-run assumption).

- [ ] **Step 1: Build the certified edition and confirm it compiles**

Run: `npm run package` (or the project's pbiviz build for the certified edition; see `package.json` scripts). Expected: builds without error.

- [ ] **Step 2: Load in Power BI Desktop with the probe**

- Import `test-uat/theme-probe.dax` as a measure; bind it to an HTML Content visual.
- Confirm the swatch grid renders with theme colors.

- [ ] **Step 3: Verify the constructor-re-run assumption**

- Switch the report theme. Confirm the swatches recolor. If they do **not** recolor until the visual is re-added, the assumption is false — in that case add a follow-up: call `buildThemeVariablesCss` + the class toggle from `update()` as well (write into the same `themeVarsIdSelector` element, creating it if absent). Record the outcome in the spec.

- [ ] **Step 4: Verify high contrast**

- Enable Windows high contrast. Confirm the HC banner appears and `fg`/`bg` swatches show HC values. Toggle off and confirm it reverts.

- [ ] **Step 5: Verify the certified (no-scripting) edition**

- Repeat Step 2 with the certified build. Confirm `var(--pbi-theme-*)` references in the probe render correctly (sanitizer preserves `var()` and custom properties).

---

## Self-review (completed during authoring)

- **Spec coverage:** numbered colors (Task 2), named incl. sentiment (Task 2), divergent excluded (Task 2 — absent by construction), dedicated `<style>` injection (Task 3), value-validation guard (Task 2), `.pbi-theme-hc` signal (Tasks 1+3), honest pass-through (Task 2 — no translation; asserted), UAT corpus (Task 4), constructor-re-run assumption (Task 5), iframe limitation (Task 4 docs), sanitizer compatibility (Pre-flight, verified — no task). YAGNI items (no toggle/fonts/shim/update-refresh) require no work.
- **Placeholders:** none — every code/test/DAX step is complete.
- **Type consistency:** `buildThemeVariablesCss` / `isValidColorValue` signatures and the `themeVarsIdSelector` / `themeHighContrastClass` constant names are identical across Tasks 1–3.
```
