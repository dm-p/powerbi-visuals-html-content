# Landing Page Redesign + Shared Diagnostics Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare W3.CSS landing splash with the high-fidelity in-visual splash, factor the visual language into a shared light-only CSS-custom-property token layer, restyle the diagnostics dialog onto those tokens, and make `VisualConstants` edition-accurate.

**Architecture:** One `:root { --hc-* }` token block in `style/visual.less` is consumed by both the splash (main visual iframe) and the diagnostics dialog (its modal iframe already inherits `visual.less` — no new plumbing). The splash is cert-safe pure DOM (no `innerHTML`, no W3.CSS): the active edition's brand/edition mark is a source-controlled `assets/*.svg` imported as a data URI (rendered as `<img>`) via a build-time generated module so only that one mark is bundled; the themeable link icons (GitHub/heart/coffee) are inline `createElementNS` SVG. The running edition, the resolved visual config, and the active mark are all surfaced as generated build-time modules (extending the existing `select-edition.mjs` pattern). Footprints are CSS container queries.

**Tech Stack:** TypeScript (ESM, `module: es6`), LESS, Vitest (jsdom), `powerbi-visuals-tools@7.1` (webpack 5; `.svg` → `asset/inline`), Node ESM scripts (`.mjs`).

**Design doc:** `docs/brainstorms/2026-06-25-landing-page-and-diagnostics-restyle.md`

**Branch:** continue on `feat/update-branding`.

> **Note on `design_landing/`:** that folder is the design reference and will be **removed** after implementation. This plan is self-contained — every value/path-data it needs is inline here or in committed `assets/*.svg`. Do not add durable references to `design_landing/` in code or docs.

---

## Background facts (read before starting)

- **Current splash** (`src/landing-page-handler.ts`) is a d3 + W3.CSS card: `h5` title, version, 4 localized overview paragraphs (`Landing_Page_Overview_1–4`), a circular `?` button → `host.launchUrl(VisualConstants.visual.supportUrl)`, then `resolveScrollableContent(container.node())`.
- **`VisualConstants.visual` is read in exactly 3 places — all inside the old `render()` being replaced** (`displayName`, `version`, `supportUrl` at `landing-page-handler.ts:107,110,124`). `displayName` (the only per-edition-varying field used) drops out entirely after the rebuild. `VisualConstants` currently does `import { visual } from '../pbiviz.json'` (`visual-constants.ts:2`) — the **unmerged base**, not the edition-resolved config. Importing `pbiviz.mjs` into the bundle is impossible (it uses `node:fs` + async `import`), so the fix is a generated resolved-config module (Task 2).
- **W3.CSS** is imported once (`src/visual.ts:4`, `import 'w3-css/w3.css';`) and used **only** by the splash. `style/visual.less:75–142` holds `.w3-theme-*`/`.w3-theme` overrides that exist solely to retint W3 for the splash. All removable after the rebuild.
- **Diagnostics CSS** is the `.hc-diagnostics` block in `style/visual.less` (from ~line 188), with hardcoded light colors (`#0078d4`, `#f5f5f5`, `#242424`, `#ddd`, `#d1d1d1`, `#f3f6fb`, …). The dialog runs in a separate modal iframe but has no CSS of its own — it inherits `visual.less` via the bundle, so `:root` custom properties reach it.
- **Edition plumbing:** `config/editions.mjs` defines `certified`/`standard`/`standalone`. `scripts/select-edition.mjs <edition>` (run by `prestart`/`pretest`/`postinstall`/`package*`) writes git-ignored generated files (`src/sanitize/backend.ts`, `config/active-edition.mjs`). `pbiviz.mjs` merges `editions[key].visual/assets/capabilities` over `pbiviz.json` at package time. Base `pbiviz.json` visual: `displayName:"HTML Content (lite)"`, `version:"2.0.0.0"`, `supportUrl:"https://www.html-content.com"`, `gitHubUrl:"https://github.com/dm-p/powerbi-visuals-html-content"`. `npm test` runs `pretest` → selects `certified`.
- **Edition → presentation** (certified = the "Secure" design edition):

  | Build key | `edition` | Name | Suffix text | Suffix style | Mark asset | Accent |
  |---|---|---|---|---|---|---|
  | `standard` | `flagship` | HTML Content | — | — | `assets/shield.svg` | `var(--hc-accent-flagship)` |
  | `certified` | `secure` | HTML Content | `Secure` | gold ink, 700 | `assets/shield-secure.svg` | `var(--hc-accent-secure)` |
  | `standalone` | `standalone` | HTML Content | `(Standalone)` | fg3, 600 | `assets/shield-standalone.svg` | `var(--hc-accent-standalone)` |

  The splash name is **`HTML Content` + suffix** (not `VisualConstants.visual.displayName`). The edition **badge is baked into the mark SVG** (`shield-secure.svg` carries a gold ✓; `shield-standalone.svg` a slate ⤓; `shield.svg` none) — so the builder renders ONE `<img>` per edition and does not draw a separate badge node.
- **Asset facts:** `assets/*.svg` are full-logo shield marks (`viewBox="0 0 512 512"`, fixed brand colors). powerbi-visuals-tools webpack maps `.svg` → `asset/inline`, so `import url from '../assets/shield.svg'` yields a base64 data URI usable as an `<img src>` (cert-safe; no `innerHTML`). The needed files currently live in `design_landing/assets/` and are **moved (and renamed) into `assets/`** (Task 3): `shield.svg` (flagship), `store-secure.svg` → `shield-secure.svg`, `store-standalone.svg` → `shield-standalone.svg`. The `palette-*` variants in `design_landing/assets/` (plain colored dot, no glyph) are the unused alternative to the `store-*` art (dot + glyph); this plan uses the `store-*` art (renamed) to match the screenshots' glyph badge.
- **Per-edition single-mark bundling:** a static `import` of an `asset/inline` SVG bakes that data URI into the bundle. To avoid shipping all three marks in every (single-edition) package, the active mark is selected at build time via a **generated module** (`src/landing-mark.generated.ts`, emitted by `select-edition.mjs` like `backend.ts`) that imports ONLY the active edition's SVG. Nothing else imports the marks, so the other two are never in the module graph. The per-mark saving is small (each SVG is a few hundred bytes) but it matches the repo's tree-shaking posture and is free given the generator.
- **Cert-safe rule:** the certified edition keeps a no-`innerHTML` posture. SVG built in JS uses `document.createElementNS`. Static brand marks come in via `<img>` data URIs (also no `innerHTML`).
- **Tests:** Vitest + jsdom, config at `vitest.config.ts` (has `resolve.alias` for `@`). `test/landing-page-handler.test.ts` asserts the OLD splash and is rewritten in Task 5. `test/diagnostics-dialog.test.ts` asserts DOM structure (not CSS) and must stay green.

## File Structure

- **Modify** `style/visual.less` — `:root` tokens (T1); `.hc-landing` block (T5); `.hc-diagnostics` → tokens + accent (T7); delete `.w3-theme-*` and the dead `.html-display-watermark`/`-help`/`-minimised` rules (T8).
- **Modify** `config/editions.mjs` — add `edition` per entry (T2).
- **Modify** `scripts/select-edition.mjs` — also emit `src/visual-config.generated.ts` (T2).
- **Create (generated, git-ignored)** `src/visual-config.generated.ts` (T2).
- **Modify** `.gitignore` — ignore that file (T2).
- **Modify** `src/visual-constants.ts` — import resolved config + `edition`; drop the `pbiviz.json` import; add `landingUrls` (T2, T5).
- **Create** `src/svg.d.ts` — `declare module '*.svg'` (T3).
- **Move + rename** `design_landing/assets/` marks → `assets/`: `shield.svg`, `store-secure.svg`→`shield-secure.svg`, `store-standalone.svg`→`shield-standalone.svg` (T3).
- **Create** `src/landing-icons.ts` — inline themeable SVG builders (GitHub/heart/coffee) (T3).
- **Modify** `scripts/select-edition.mjs` — also emit `src/landing-mark.generated.ts` importing only the active edition's mark (T3); **Create (generated, git-ignored)** `src/landing-mark.generated.ts`; **Modify** `.gitignore` (T3).
- **Create** `src/landing-splash.ts` — pure-DOM splash builder (T4).
- **Modify** `src/landing-page-handler.ts` — delegate to `buildSplash` (T5).
- **Modify** `stringResources/en-US/resources.resjson` — new `Landing_*` keys, remove `Landing_Page_Overview_1–4` (T5).
- **Modify** `vitest.config.ts` + **Create** `test/stubs/svg.ts` — alias `.svg` to a stub in tests (T3).
- **Modify** `src/visual.ts`, `package.json` — drop `w3-css` (T8).
- **Create** `test/edition-config.test.ts`, `test/landing-icons.test.ts`, `test/landing-splash.test.ts`; **rewrite** `test/landing-page-handler.test.ts`.

---

## Task 1: Add the shared token layer

**Files:** Modify `style/visual.less` (very top, before `#htmlViewer`). No unit test (CSS) — verified by the LESS build in T8/T9 and UAT.

- [ ] **Step 1: Add the `:root` token block at the top of `style/visual.less`**

```less
// Shared design tokens (light only) — consumed by the landing splash
// (.hc-landing) and the diagnostics dialog (.hc-diagnostics). The dialog runs
// in its own modal iframe but inherits these via the visual bundle, so this is
// the single source of truth for both surfaces. Dark theme intentionally omitted.
:root {
    --hc-brand: #e34f26;
    --hc-brand-hover: #c7401c;
    --hc-brand-tint: #fceee9;
    --hc-brand-fg: #ffffff;

    --hc-bg1: #ffffff;
    --hc-bg2: #f5f4f3;
    --hc-bg3: #eceae9;
    --hc-canvas: #eceae8;

    --hc-fg1: #242424;
    --hc-fg2: #494949;
    --hc-fg3: #707070;

    --hc-stroke1: #dcdad6;
    --hc-stroke2: #ededeb;

    --hc-gold: #ffb100;
    --hc-gold-ink: #b07a00;
    --hc-slate: #5b6470;

    --hc-shadow4: 0 2px 4px rgba(0, 0, 0, 0.1), 0 0 2px rgba(0, 0, 0, 0.06);
    --hc-shadow8: 0 4px 10px rgba(0, 0, 0, 0.1), 0 0 2px rgba(0, 0, 0, 0.06);
    --hc-shadow16: 0 10px 26px rgba(0, 0, 0, 0.14), 0 0 2px rgba(0, 0, 0, 0.08);

    --hc-accent-flagship: var(--hc-brand);
    --hc-accent-secure: var(--hc-gold);
    --hc-accent-standalone: var(--hc-slate);
}
```

- [ ] **Step 2: Commit**

```bash
git add style/visual.less
git commit -m "feat(style): add shared light-theme design tokens"
```

---

## Task 2: Generated resolved visual config + edition constant

Make `VisualConstants` edition-accurate and expose the running edition, by generating a merged config module (the same generated-file pattern as `backend.ts`).

**Files:** Modify `config/editions.mjs`, `scripts/select-edition.mjs`, `src/visual-constants.ts`, `.gitignore`; create (generated) `src/visual-config.generated.ts`; test `test/edition-config.test.ts`.

- [ ] **Step 1: Add an `edition` designation to each `config/editions.mjs` entry**

`certified` → `edition: 'secure'`, `standard` → `edition: 'flagship'`, `standalone` → `edition: 'standalone'`. Example:

```js
    certified: {
        visual: {},
        assets: {},
        capabilities: 'capabilities.json',
        sanitize: true,
        edition: 'secure'
    },
```

- [ ] **Step 2: Make `select-edition.mjs` emit the resolved config module**

In `scripts/select-edition.mjs`, change the import to include `readFileSync` and add the merged-config write after the existing `active-edition.mjs` write:

```js
import { readFileSync, writeFileSync } from 'node:fs';
```

```js
const base = JSON.parse(
    readFileSync(new URL('../pbiviz.json', import.meta.url), 'utf8')
);
const resolvedVisual = { ...base.visual, ...e.visual };
writeFileSync(
    new URL('../src/visual-config.generated.ts', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `export type Edition = 'flagship' | 'secure' | 'standalone';\n` +
        `export const EDITION: Edition = '${e.edition}';\n` +
        `export const RESOLVED_VISUAL = ${JSON.stringify(
            resolvedVisual,
            null,
            4
        )} as const;\n`
);
```

- [ ] **Step 3: Regenerate for the certified (test/dev) default**

Run: `node scripts/select-edition.mjs certified`
Expected: `src/visual-config.generated.ts` exists with `EDITION: Edition = 'secure'` and `RESOLVED_VISUAL` containing `"displayName": "HTML Content (lite)"`, `"version": "2.0.0.0"`.

- [ ] **Step 4: Git-ignore the generated module**

In `.gitignore`, beside `config/active-edition.mjs`, add:

```
src/visual-config.generated.ts
```

- [ ] **Step 5: Point `VisualConstants` at the resolved config**

In `src/visual-constants.ts`: remove `import { visual } from '../pbiviz.json';` and add:

```ts
import { RESOLVED_VISUAL, EDITION } from './visual-config.generated';
```

Replace the `visual: visual,` property with `visual: RESOLVED_VISUAL,` and add `edition: EDITION,` next to it.

- [ ] **Step 6: Verify nothing else imports the raw pbiviz.json**

Run: `git grep -n "pbiviz.json" -- src || echo "clean"`
Expected: `clean` (only `pbiviz.mjs` and `scripts/` reference it, which are outside `src`).

- [ ] **Step 7: Write the failing test**

Create `test/edition-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { VisualConstants } from '../src/visual-constants';

describe('VisualConstants edition + resolved config', () => {
    it('exposes the design edition for the certified test build', () => {
        expect(VisualConstants.edition).toBe('secure');
    });

    it('resolves the base visual config fields used at runtime', () => {
        expect(VisualConstants.visual.version).toBe('2.0.0.0');
        expect(VisualConstants.visual.supportUrl).toMatch(/^https:\/\//);
        expect(VisualConstants.visual.gitHubUrl).toContain('github.com');
    });
});
```

- [ ] **Step 8: Run the test**

Run: `npx vitest run test/edition-config.test.ts`
Expected: PASS (Step 3 generated `EDITION='secure'`).

- [ ] **Step 9: Commit**

```bash
git add config/editions.mjs scripts/select-edition.mjs src/visual-constants.ts .gitignore test/edition-config.test.ts
git commit -m "refactor(constants): generate edition-resolved visual config + edition constant"
```

---

## Task 3: Icons — inline themeable builders, generated edition mark, test plumbing

**Files:** create `src/landing-icons.ts`, `src/svg.d.ts`, `test/stubs/svg.ts`, `test/landing-icons.test.ts`; modify `scripts/select-edition.mjs`, `.gitignore`, `vitest.config.ts`; generate `src/landing-mark.generated.ts`; move 3 SVGs into `assets/`.

- [ ] **Step 1: Move the brand/edition marks into source-controlled `assets/`**

```bash
git mv design_landing/assets/shield.svg assets/shield.svg
git mv design_landing/assets/store-secure.svg assets/shield-secure.svg
git mv design_landing/assets/store-standalone.svg assets/shield-standalone.svg
```

(If the files are untracked, use `mv` instead of `git mv`, then `git add assets/shield.svg assets/shield-secure.svg assets/shield-standalone.svg`.)

- [ ] **Step 2: Declare the `.svg` module type**

Create `src/svg.d.ts`:

```ts
// powerbi-visuals-tools webpack maps .svg to asset/inline → a base64 data URI.
declare module '*.svg' {
    const url: string;
    export default url;
}
```

- [ ] **Step 3: Generate the active-edition mark module from `select-edition.mjs`**

Extend `scripts/select-edition.mjs` to import only the active edition's mark. After the existing generated writes, add (the map is keyed by `e.edition`, the design name added in Task 2):

```js
const MARK_FILE = {
    flagship: 'shield.svg',
    secure: 'shield-secure.svg',
    standalone: 'shield-standalone.svg'
};
writeFileSync(
    new URL('../src/landing-mark.generated.ts', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `import mark from '../assets/${MARK_FILE[e.edition]}';\n` +
        `export const MARK_URL: string = mark;\n`
);
```

Only the active edition's `.svg` is imported, so the other two are never in the module graph and are not bundled.

- [ ] **Step 4: Regenerate + git-ignore the mark module**

Run: `node scripts/select-edition.mjs certified`
Expected: `src/landing-mark.generated.ts` exists and contains `import mark from '../assets/shield-secure.svg';`.
In `.gitignore`, beside the other generated artifacts, add:

```
src/landing-mark.generated.ts
```

- [ ] **Step 5: Alias `.svg` to a stub for vitest**

Create `test/stubs/svg.ts`:

```ts
export default 'data:image/svg+xml;base64,STUB';
```

In `vitest.config.ts`, change `resolve.alias` from the object form to the array form so a regex alias can be added:

```ts
import path from 'path';
// ...
    resolve: {
        alias: [
            { find: '@', replacement: path.resolve(__dirname, './src') },
            {
                find: /\.svg$/,
                replacement: path.resolve(__dirname, './test/stubs/svg.ts')
            }
        ],
        extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']
    }
```

- [ ] **Step 6: Write the failing test for the inline icons**

Create `test/landing-icons.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { githubIcon, heartIcon, coffeeIcon } from '../src/landing-icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('landing-icons', () => {
    let doc: Document;
    beforeEach(() => {
        doc = new JSDOM('<!DOCTYPE html><body></body>').window.document;
    });

    it('builds namespaced SVG with paths and the requested size', () => {
        for (const make of [githubIcon, heartIcon, coffeeIcon]) {
            const svg = make(doc, 16, 16);
            expect(svg.namespaceURI).toBe(SVG_NS);
            expect(svg.getAttribute('width')).toBe('16');
            const p = svg.querySelector('path');
            expect(p?.namespaceURI).toBe(SVG_NS);
        }
    });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run test/landing-icons.test.ts`
Expected: FAIL with "Cannot find module '../src/landing-icons'".

- [ ] **Step 8: Implement `src/landing-icons.ts`**

```ts
// Cert-safe inline SVG builders for the themeable header link icons. Every node
// is created via createElementNS (no innerHTML). These three need currentColor
// theming (heart pink, coffee brown, GitHub hover) so they are inline rather
// than <img> data URIs. Path data: GitHub Octicons mark, GitHub Sponsors heart,
// a coffee-cup glyph.
const SVG_NS = 'http://www.w3.org/2000/svg';

interface PathSpec {
    d: string;
    fill?: string;
    stroke?: string;
}

const svg = (
    doc: Document,
    w: number,
    h: number,
    paths: PathSpec[],
    extra?: Record<string, string>
): SVGSVGElement => {
    const root = doc.createElementNS(SVG_NS, 'svg');
    root.setAttribute('viewBox', '0 0 16 16');
    root.setAttribute('width', String(w));
    root.setAttribute('height', String(h));
    if (extra) for (const [k, v] of Object.entries(extra)) root.setAttribute(k, v);
    for (const p of paths) {
        const path = doc.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', p.d);
        if (p.fill) path.setAttribute('fill', p.fill);
        if (p.stroke) path.setAttribute('stroke', p.stroke);
        root.appendChild(path);
    }
    return root;
};

export const githubIcon = (doc: Document, w = 16, h = 16): SVGSVGElement =>
    svg(
        doc,
        w,
        h,
        [
            {
                d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z',
                fill: 'currentColor'
            }
        ],
        { fill: 'currentColor' }
    );

export const heartIcon = (doc: Document, w = 16, h = 16): SVGSVGElement =>
    svg(
        doc,
        w,
        h,
        [
            {
                d: 'M4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.565 20.565 0 008 13.393a20.561 20.561 0 003.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.75.75 0 01-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5z',
                fill: 'currentColor'
            }
        ],
        { fill: 'currentColor' }
    );

export const coffeeIcon = (doc: Document, w = 16, h = 16): SVGSVGElement =>
    svg(
        doc,
        w,
        h,
        [
            { d: 'M3 6h8v3.5A2.5 2.5 0 0 1 8.5 12h-3A2.5 2.5 0 0 1 3 9.5V6z' },
            { d: 'M11 6.8h1.4a1.6 1.6 0 0 1 0 3.2H11' },
            { d: 'M3 14h8' },
            { d: 'M5.6 2.6v1.3M8 2.3v1.6' }
        ],
        {
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.4',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        }
    );
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run test/landing-icons.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add assets/shield.svg assets/shield-secure.svg assets/shield-standalone.svg src/svg.d.ts src/landing-icons.ts scripts/select-edition.mjs .gitignore test/stubs/svg.ts vitest.config.ts test/landing-icons.test.ts
git commit -m "feat(landing): per-edition generated mark + inline themeable icons"
```

---

## Task 4: Splash builder

**Files:** create `src/landing-splash.ts`, `test/landing-splash.test.ts`.

`buildSplash` returns a detached container built with `createElement` (cert-safe). It receives the edition, version, mark data URI, a typed `LandingLabels`, link `LandingUrls`, and an `onLaunch(url)` callback (the iframe can't call `launchUrl` directly — clicks delegate to the host). The full DOM is always emitted; footprint switching is pure CSS (T5).

- [ ] **Step 1: Write the failing test**

Create `test/landing-splash.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSplash, LandingLabels, LandingUrls } from '../src/landing-splash';

const labels: LandingLabels = {
    headline: 'Ready when you are.',
    body: 'Drop a measure or field that returns HTML into the Values well.',
    quickStart: 'Quick start',
    examples: 'Examples',
    whatsNew: "What's new",
    sandboxNote: 'Some browser features are limited inside the sandbox.',
    sandboxNoteLink: 'see the docs',
    valuesLabel: 'Values',
    valuesField: 'Report HTML',
    valuesHint: 'drop a field here',
    compactBody: 'Add a field with HTML to the Values well to render it here.',
    docs: 'Docs',
    openDocs: 'Open the docs'
};
const urls: LandingUrls = {
    docs: 'https://docs.example',
    github: 'https://gh.example',
    sponsor: 'https://sponsor.example',
    coffee: 'https://coffee.example'
};

describe('buildSplash', () => {
    let doc: Document;
    beforeEach(() => {
        doc = new JSDOM('<!DOCTYPE html><body></body>').window.document;
    });

    it('renders the Secure name + suffix and the edition mark image', () => {
        const el = buildSplash(doc, {
            edition: 'secure',
            version: '2.0.0.0',
            markUrl: 'data:image/svg+xml;base64,SECURE',
            labels,
            urls,
            onLaunch: vi.fn()
        });
        expect(el.querySelector('.hc-landing-name')?.textContent).toContain(
            'HTML Content'
        );
        expect(el.querySelector('.hc-landing-suffix')?.textContent).toBe('Secure');
        const img = el.querySelector('img.hc-landing-mark') as HTMLImageElement;
        expect(img.getAttribute('src')).toBe('data:image/svg+xml;base64,SECURE');
        expect(el.querySelector('.hc-landing-headline')?.textContent).toBe(
            'Ready when you are.'
        );
    });

    it('flagship has an empty suffix', () => {
        const el = buildSplash(doc, {
            edition: 'flagship',
            version: '2.0.0.0',
            markUrl: 'x',
            labels,
            urls,
            onLaunch: vi.fn()
        });
        expect(el.querySelector('.hc-landing-suffix')?.textContent).toBe('');
    });

    it('delegates link clicks to onLaunch instead of navigating', () => {
        const onLaunch = vi.fn();
        const el = buildSplash(doc, {
            edition: 'standalone',
            version: '2.0.0.0',
            markUrl: 'x',
            labels,
            urls,
            onLaunch
        });
        (el.querySelector('.hc-landing-docs') as HTMLElement).click();
        expect(onLaunch).toHaveBeenCalledWith(urls.docs);
        (el.querySelector('[data-link="github"]') as HTMLElement).click();
        expect(onLaunch).toHaveBeenCalledWith(urls.github);
        (el.querySelector('[data-link="sponsor"]') as HTMLElement).click();
        expect(onLaunch).toHaveBeenCalledWith(urls.sponsor);
        (el.querySelector('[data-link="coffee"]') as HTMLElement).click();
        expect(onLaunch).toHaveBeenCalledWith(urls.coffee);
    });

    it('inline link icons are SVG-namespaced (cert-safe)', () => {
        const el = buildSplash(doc, {
            edition: 'secure',
            version: '2.0.0.0',
            markUrl: 'x',
            labels,
            urls,
            onLaunch: vi.fn()
        });
        el.querySelectorAll('.hc-landing-iconlink svg').forEach((s) =>
            expect(s.namespaceURI).toBe('http://www.w3.org/2000/svg')
        );
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/landing-splash.test.ts`
Expected: FAIL with "Cannot find module '../src/landing-splash'".

- [ ] **Step 3: Implement `src/landing-splash.ts`**

```ts
import { Edition } from './visual-config.generated';
import { githubIcon, heartIcon, coffeeIcon } from './landing-icons';

export interface LandingLabels {
    headline: string;
    body: string;
    quickStart: string;
    examples: string;
    whatsNew: string;
    sandboxNote: string;
    sandboxNoteLink: string;
    valuesLabel: string;
    valuesField: string;
    valuesHint: string;
    compactBody: string;
    docs: string;
    openDocs: string;
}

export interface LandingUrls {
    docs: string;
    github: string;
    sponsor: string;
    coffee: string;
}

export interface SplashOptions {
    edition: Edition;
    version: string;
    markUrl: string;
    labels: LandingLabels;
    urls: LandingUrls;
    onLaunch: (url: string) => void;
}

interface EditionPresentation {
    suffix: string;
    suffixClass: string;
    accentVar: string;
}

const PRESENTATION: Record<Edition, EditionPresentation> = {
    flagship: { suffix: '', suffixClass: '', accentVar: 'var(--hc-accent-flagship)' },
    secure: {
        suffix: 'Secure',
        suffixClass: 'hc-landing-suffix--secure',
        accentVar: 'var(--hc-accent-secure)'
    },
    standalone: {
        suffix: '(Standalone)',
        suffixClass: 'hc-landing-suffix--standalone',
        accentVar: 'var(--hc-accent-standalone)'
    }
};

const node = (
    doc: Document,
    tag: string,
    cls?: string,
    text?: string
): HTMLElement => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
};

const iconLink = (
    doc: Document,
    cls: string,
    key: string,
    url: string,
    title: string,
    icon: SVGElement,
    onLaunch: (url: string) => void
): HTMLElement => {
    const a = node(doc, 'button', cls);
    a.setAttribute('type', 'button');
    a.setAttribute('title', title);
    a.setAttribute('aria-label', title);
    a.dataset.link = key;
    a.appendChild(icon);
    a.addEventListener('click', () => onLaunch(url));
    return a;
};

const textLink = (
    doc: Document,
    cls: string,
    text: string,
    url: string,
    onLaunch: (url: string) => void
): HTMLElement => {
    const b = node(doc, 'button', cls, text);
    b.setAttribute('type', 'button');
    b.addEventListener('click', () => onLaunch(url));
    return b;
};

export const buildSplash = (doc: Document, opts: SplashOptions): HTMLElement => {
    const { edition, version, markUrl, labels, urls, onLaunch } = opts;
    const p = PRESENTATION[edition];

    const root = node(doc, 'div', 'hc-landing');
    root.style.setProperty('--hc-edition-accent', p.accentVar);

    // ---- Header ----
    const header = node(doc, 'div', 'hc-landing-header');
    header.appendChild(node(doc, 'div', 'hc-landing-accent'));

    const mark = doc.createElement('img');
    mark.className = 'hc-landing-mark';
    mark.src = markUrl;
    mark.alt = '';
    header.appendChild(mark);

    const titleWrap = node(doc, 'div', 'hc-landing-title');
    const name = node(doc, 'div', 'hc-landing-name', 'HTML Content ');
    name.appendChild(
        node(doc, 'span', `hc-landing-suffix ${p.suffixClass}`.trim(), p.suffix)
    );
    titleWrap.appendChild(name);
    titleWrap.appendChild(
        node(doc, 'div', 'hc-landing-version', `Version ${version}`)
    );
    header.appendChild(titleWrap);

    const docsBtn = node(doc, 'button', 'hc-landing-docs', labels.docs);
    docsBtn.setAttribute('type', 'button');
    docsBtn.appendChild(node(doc, 'span', 'hc-landing-docs-arrow', '↗'));
    docsBtn.addEventListener('click', () => onLaunch(urls.docs));
    header.appendChild(docsBtn);

    const icons = node(doc, 'div', 'hc-landing-icons');
    icons.appendChild(
        iconLink(doc, 'hc-landing-iconlink', 'github', urls.github,
            'View source on GitHub', githubIcon(doc), onLaunch)
    );
    icons.appendChild(
        iconLink(doc, 'hc-landing-iconlink hc-landing-iconlink--heart', 'sponsor',
            urls.sponsor, 'Sponsor on GitHub', heartIcon(doc), onLaunch)
    );
    icons.appendChild(
        iconLink(doc, 'hc-landing-iconlink hc-landing-iconlink--coffee', 'coffee',
            urls.coffee, 'Buy me a coffee', coffeeIcon(doc), onLaunch)
    );
    header.appendChild(icons);
    root.appendChild(header);

    // ---- Body ----
    const body = node(doc, 'div', 'hc-landing-body');

    const watermark = doc.createElement('img');
    watermark.className = 'hc-landing-watermark';
    watermark.src = markUrl;
    watermark.alt = '';
    body.appendChild(watermark);

    const copy = node(doc, 'div', 'hc-landing-copy');
    copy.appendChild(node(doc, 'h1', 'hc-landing-headline', labels.headline));
    copy.appendChild(node(doc, 'p', 'hc-landing-lede', labels.body));
    copy.appendChild(node(doc, 'p', 'hc-landing-compact-body', labels.compactBody));

    const links = node(doc, 'div', 'hc-landing-links');
    links.appendChild(textLink(doc,
        'hc-landing-link hc-landing-link--brand', labels.quickStart, urls.docs, onLaunch));
    links.appendChild(textLink(doc,
        'hc-landing-link', labels.examples, urls.docs, onLaunch));
    links.appendChild(textLink(doc,
        'hc-landing-link', labels.whatsNew, urls.docs, onLaunch));
    copy.appendChild(links);

    const sandbox = node(doc, 'p', 'hc-landing-sandbox', `${labels.sandboxNote} `);
    sandbox.appendChild(
        textLink(doc, 'hc-landing-sandbox-link', labels.sandboxNoteLink, urls.docs, onLaunch)
    );
    copy.appendChild(sandbox);

    const openDocs = textLink(doc, 'hc-landing-opendocs', labels.openDocs, urls.docs, onLaunch);
    openDocs.appendChild(node(doc, 'span', undefined, ' ↗'));
    copy.appendChild(openDocs);

    body.appendChild(copy);

    // ---- Values cue ----
    const cue = node(doc, 'div', 'hc-landing-values');
    const cueLabel = node(doc, 'div', 'hc-landing-values-label');
    cueLabel.appendChild(node(doc, 'span', 'hc-landing-values-box'));
    cueLabel.appendChild(node(doc, 'span', undefined, labels.valuesLabel));
    cue.appendChild(cueLabel);
    const drop = node(doc, 'div', 'hc-landing-dropzone');
    const chip = node(doc, 'div', 'hc-landing-chip');
    chip.appendChild(node(doc, 'span', 'hc-landing-chip-grip', '⠿'));
    chip.appendChild(node(doc, 'span', 'hc-landing-chip-text', labels.valuesField));
    drop.appendChild(chip);
    drop.appendChild(node(doc, 'span', 'hc-landing-drophint', labels.valuesHint));
    cue.appendChild(drop);
    body.appendChild(cue);

    root.appendChild(body);
    return root;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/landing-splash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/landing-splash.ts test/landing-splash.test.ts
git commit -m "feat(landing): pure-DOM splash builder"
```

---

## Task 5: Rewire the handler, add `.hc-landing` styles + localization

**Files:** modify `src/landing-page-handler.ts`, `style/visual.less`, `stringResources/en-US/resources.resjson`, `src/visual-constants.ts`; rewrite `test/landing-page-handler.test.ts`.

- [ ] **Step 1: Add the new localization keys; remove the old overview keys**

In `stringResources/en-US/resources.resjson`, delete `Landing_Page_Overview_1`–`_4` and add:

```json
    "Landing_Headline": "Ready when you are.",
    "Landing_Body": "Drop a measure or field that returns HTML into the Values well, and it renders right here — live on the canvas.",
    "Landing_QuickStart": "Quick start →",
    "Landing_Examples": "Examples",
    "Landing_WhatsNew": "What's new",
    "Landing_SandboxNote": "Some browser features are limited inside Power BI's sandbox —",
    "Landing_SandboxNoteLink": "see the docs",
    "Landing_ValuesLabel": "Values",
    "Landing_ValuesField": "Report HTML",
    "Landing_ValuesHint": "drop a field here",
    "Landing_CompactBody": "Add a field with HTML to the Values well to render it here.",
    "Landing_Docs": "Docs",
    "Landing_OpenDocs": "Open the docs",
```

- [ ] **Step 2: Add the `landingUrls` block to `VisualConstants`**

In `src/visual-constants.ts`, add to the exported object:

```ts
    landingUrls: {
        docs: RESOLVED_VISUAL.supportUrl,
        github: RESOLVED_VISUAL.gitHubUrl,
        sponsor: 'https://github.com/sponsors/dm-p',
        coffee: 'https://buymeacoffee.com/dmp'
    },
```

- [ ] **Step 3: Rewrite `src/landing-page-handler.ts` imports + `render()`**

Replace the W3 imports/usage. Set the top-of-file internal imports to:

```ts
import { VisualConstants } from './visual-constants';
import { resolveScrollableContent } from './domain-utils';
import { buildSplash, LandingLabels } from './landing-splash';
import { MARK_URL } from './landing-mark.generated';
```

Replace `render()` with:

```ts
    render(host: IVisualHost) {
        const get = (key: string) =>
            this.localisationManager.getDisplayName(key);
        const labels: LandingLabels = {
            headline: get('Landing_Headline'),
            body: get('Landing_Body'),
            quickStart: get('Landing_QuickStart'),
            examples: get('Landing_Examples'),
            whatsNew: get('Landing_WhatsNew'),
            sandboxNote: get('Landing_SandboxNote'),
            sandboxNoteLink: get('Landing_SandboxNoteLink'),
            valuesLabel: get('Landing_ValuesLabel'),
            valuesField: get('Landing_ValuesField'),
            valuesHint: get('Landing_ValuesHint'),
            compactBody: get('Landing_CompactBody'),
            docs: get('Landing_Docs'),
            openDocs: get('Landing_OpenDocs')
        };

        const el = this.element.node();
        const doc = el.ownerDocument as Document;
        const splash = buildSplash(doc, {
            edition: VisualConstants.edition,
            version: VisualConstants.visual.version,
            markUrl: MARK_URL,
            labels,
            urls: VisualConstants.landingUrls,
            onLaunch: (url: string) => host.launchUrl(url)
        });
        // Keep the existing container class prefix so external hooks still match.
        splash.classList.add(
            `${VisualConstants.dom.landingPageClassPrefix}-landing-page`
        );
        el.appendChild(splash);
        resolveScrollableContent(el);
    }
```

- [ ] **Step 4: Add the `.hc-landing` LESS block to `style/visual.less`**

```less
.hc-landing {
    container-type: inline-size;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: auto;
    display: flex;
    flex-direction: column;
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    color: var(--hc-fg1);
    background: var(--hc-bg1);

    .hc-landing-header {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 18px 22px 16px;
        border-bottom: 1px solid var(--hc-stroke2);
    }
    .hc-landing-accent {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 4px;
        background: var(--hc-edition-accent);
    }
    .hc-landing-mark { flex: none; width: 32px; height: 32px; display: block; }
    .hc-landing-title { flex: 1; min-width: 0; }
    .hc-landing-name { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
    .hc-landing-suffix--secure { color: var(--hc-gold-ink); font-weight: 700; }
    .hc-landing-suffix--standalone { color: var(--hc-fg3); font-weight: 600; }
    .hc-landing-version { font-size: 11.5px; color: var(--hc-fg3); font-weight: 500; margin-top: 2px; }
    .hc-landing-docs {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 13px;
        border: none;
        border-radius: 6px;
        background: var(--hc-brand);
        color: var(--hc-brand-fg);
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: var(--hc-shadow4);
    }
    .hc-landing-docs:hover { background: var(--hc-brand-hover); }
    .hc-landing-icons { flex: none; display: flex; align-items: center; gap: 7px; }
    .hc-landing-iconlink {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--hc-bg2);
        border: 1px solid var(--hc-stroke1);
        color: var(--hc-fg2);
        cursor: pointer;
        padding: 0;
    }
    .hc-landing-iconlink:hover { background: var(--hc-bg3); }
    .hc-landing-iconlink--heart { color: #d6336c; }
    .hc-landing-iconlink--coffee { color: #c17d3b; }

    .hc-landing-body { position: relative; flex: 1; padding: 24px 22px; overflow: hidden; }
    .hc-landing-watermark {
        position: absolute;
        right: -26px; bottom: -46px;
        width: 260px; height: 260px;
        opacity: 0.05;
        z-index: 0;
        pointer-events: none;
    }
    .hc-landing-copy { position: relative; z-index: 1; max-width: 34ch; }
    .hc-landing-headline { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
    .hc-landing-lede { font-size: 14px; line-height: 1.55; color: var(--hc-fg2); margin: 12px 0 0; }
    .hc-landing-links { display: flex; gap: 18px; margin-top: 20px; font-size: 12.5px; font-weight: 600; }
    .hc-landing-link { border: none; background: none; font: inherit; font-weight: 600; color: var(--hc-fg3); cursor: pointer; padding: 0; }
    .hc-landing-link--brand { color: var(--hc-brand); }
    .hc-landing-sandbox { font-size: 11px; line-height: 1.5; color: var(--hc-fg3); margin: 18px 0 0; max-width: 40ch; }
    .hc-landing-sandbox-link { border: none; background: none; font: inherit; color: var(--hc-fg2); cursor: pointer; padding: 0; }

    .hc-landing-values {
        position: absolute;
        right: 22px; top: 50%;
        transform: translateY(-50%);
        width: 184px;
        background: var(--hc-bg2);
        border: 1px solid var(--hc-stroke2);
        border-radius: 10px;
        padding: 13px;
        box-shadow: var(--hc-shadow4);
        z-index: 1;
    }
    .hc-landing-values-label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: var(--hc-fg2); margin-bottom: 9px; }
    .hc-landing-values-box { width: 11px; height: 11px; border: 1.6px solid var(--hc-fg3); border-radius: 2px; }
    .hc-landing-dropzone { border: 1.6px dashed var(--hc-brand); border-radius: 7px; background: var(--hc-brand-tint); padding: 10px; display: flex; flex-direction: column; gap: 7px; align-items: center; }
    .hc-landing-chip { width: 100%; display: flex; align-items: center; gap: 7px; background: var(--hc-bg1); border: 1px solid var(--hc-stroke1); border-radius: 5px; padding: 6px 8px; box-shadow: var(--hc-shadow4); }
    .hc-landing-chip-text { font-size: 11.5px; font-weight: 600; color: var(--hc-fg1); white-space: nowrap; }
    .hc-landing-chip-grip { color: var(--hc-fg3); font-size: 11px; letter-spacing: 1px; }
    .hc-landing-drophint { font-size: 10px; font-weight: 600; color: var(--hc-brand); }

    .hc-landing-compact-body,
    .hc-landing-opendocs { display: none; }

    @container (max-width: 360px) {
        .hc-landing-docs,
        .hc-landing-values,
        .hc-landing-lede,
        .hc-landing-links,
        .hc-landing-sandbox { display: none; }
        .hc-landing-compact-body { display: block; font-size: 11.5px; line-height: 1.45; color: var(--hc-fg2); margin: 6px 0 0; }
        .hc-landing-opendocs { display: inline-flex; align-items: center; gap: 5px; margin-top: 12px; border: none; background: none; font: inherit; font-size: 12px; font-weight: 700; color: var(--hc-brand); cursor: pointer; padding: 0; }
        .hc-landing-headline { font-size: 14.5px; }
        .hc-landing-header { padding: 12px 14px 11px; gap: 9px; }
        .hc-landing-mark { width: 24px; height: 24px; }
        .hc-landing-body { padding: 14px 16px; display: flex; flex-direction: column; justify-content: center; }
    }
}
```

- [ ] **Step 5: Rewrite `test/landing-page-handler.test.ts`**

Keep the constructor / handleLandingPage / clear blocks verbatim (they still hold). Replace the `render` block:

```ts
    describe('render', () => {
        it('renders the splash container with the class prefix', () => {
            handler.handleLandingPage(false, mockHost);
            const container = mockElement.select('.html-display-landing-page');
            expect(container.empty()).toBe(false);
            expect(container.classed('hc-landing')).toBe(true);
        });

        it('localizes the headline via the localisation manager', () => {
            handler.handleLandingPage(false, mockHost);
            expect(mockLocalisationManager.getDisplayName).toHaveBeenCalledWith(
                'Landing_Headline'
            );
        });

        it('launches the docs URL when the Docs button is clicked', () => {
            handler.handleLandingPage(false, mockHost);
            const docs = mockElement
                .node()
                .querySelector('.hc-landing-docs') as HTMLElement;
            docs.click();
            expect(mockHost.launchUrl).toHaveBeenCalled();
        });

        it('renders no W3.CSS classes', () => {
            handler.handleLandingPage(false, mockHost);
            expect(mockElement.node().innerHTML).not.toMatch(/\bw3-/);
        });
    });
```

- [ ] **Step 6: Run the landing tests**

Run: `npx vitest run test/landing-page-handler.test.ts test/landing-splash.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/landing-page-handler.ts style/visual.less stringResources/en-US/resources.resjson src/visual-constants.ts test/landing-page-handler.test.ts
git commit -m "feat(landing): rebuild splash onto shared tokens, drop W3 markup, localize copy"
```

---

## Task 6: Add the new localization keys to all other locales

**Files:** modify every `stringResources/*/resources.resjson` other than `en-US`.

- [ ] **Step 1: Enumerate locale folders**

Run: `ls stringResources`
If `en-US` is the only folder, **skip this task** (note it in the next commit). Otherwise, for each other locale add the 13 `Landing_*` keys from Task 5 Step 1 (English fallback is acceptable where translations aren't maintained) and remove `Landing_Page_Overview_1–4`.

- [ ] **Step 2: Commit (only if files changed)**

```bash
git add stringResources
git commit -m "chore(i18n): add landing splash keys across locales"
```

---

## Task 7: Restyle the diagnostics dialog onto the tokens

**Files:** modify `style/visual.less` (`.hc-diagnostics` block). CSS-only; `test/diagnostics-dialog.test.ts` must stay green.

- [ ] **Step 1: Replace hardcoded colors with tokens**

In `.hc-diagnostics`, swap: tab text `#424242`→`var(--hc-fg2)`; active `#242424`→`var(--hc-fg1)`; hover `#f5f5f5`→`var(--hc-bg2)`; borders `#ddd`/`#d1d1d1`→`var(--hc-stroke1)`; button bg `#fff`→`var(--hc-bg1)`; active press `#ededed`→`var(--hc-bg3)`; banner `#f3f6fb`→`var(--hc-brand-tint)`; active-tab underline `#0078d4`→`var(--hc-brand)`.

- [ ] **Step 2: Add the accent treatment + typography for cross-surface consistency**

```less
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    .hc-tabbar {
        border-top: 3px solid var(--hc-brand);
        border-bottom: 1px solid var(--hc-stroke2);
        padding-top: 6px;
    }
```

Do not rename classes or restructure nodes; tighten spacing only as needed.

- [ ] **Step 3: Confirm structure is intact**

Run: `npx vitest run test/diagnostics-dialog.test.ts test/diagnostics-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add style/visual.less
git commit -m "feat(diagnostics): restyle dialog onto shared tokens + accent treatment"
```

---

## Task 8: Remove W3.CSS entirely

**Files:** modify `src/visual.ts`, `package.json`, `style/visual.less`.

- [ ] **Step 1: Remove the import**

In `src/visual.ts`, delete `import 'w3-css/w3.css';` (line 4).

- [ ] **Step 2: Remove the dependency**

In `package.json`, remove the `w3-css` entry from `dependencies`. Run: `npm install` (updates the lockfile).

- [ ] **Step 3: Delete the dead `.w3-theme-*` overrides**

In `style/visual.less`, delete the block from `.w3-theme-l5 {` through the closing `}` of `.w3-theme` (≈ lines 75–142). These retinted W3 for the old splash only.

- [ ] **Step 4: Delete the dead legacy `.html-display-*` rules**

The rebuilt splash uses `.hc-landing-*` classes; the old handler's `-watermark`/`-help` classes are no longer applied (T5) and `.html-display-minimised` is already unreferenced. In `style/visual.less`, delete the `.html-display-watermark`, `.html-display-help`, and `.html-display-minimised` rule blocks (≈ lines 157–171). **Keep** `.html-display-landing-page` — the handler still adds that class to the container.

- [ ] **Step 5: Verify no W3 or dead landing references remain**

Run: `git grep -n "w3-\|html-display-watermark\|html-display-help\|html-display-minimised" -- src style || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Run the full suite + build**

Run: `npm test`
Expected: PASS.
Then: `node scripts/select-edition.mjs certified && npx pbiviz package`
Expected: LESS compiles, bundle builds without `w3-css`.

- [ ] **Step 7: Commit**

```bash
git add src/visual.ts package.json package-lock.json style/visual.less
git commit -m "chore: drop w3-css and dead legacy landing CSS"
```

---

## Task 9: Full verification + UAT checkpoint

**Files:** none (verification only).

- [ ] **Step 1: Build each edition to confirm wiring**

Run in turn:
`node scripts/select-edition.mjs standard && npx pbiviz package`
`node scripts/select-edition.mjs standalone && npx pbiviz package`
`node scripts/select-edition.mjs certified && npx pbiviz package`
Expected: each packages; `src/visual-config.generated.ts` shows `flagship` / `standalone` / `secure` respectively.

- [ ] **Step 2: Restore the dev default + run the full suite**

Run: `node scripts/select-edition.mjs certified && npm test`
Expected: all tests pass.

- [ ] **Step 3: Hold for Power BI Desktop UAT**

Hand off for visual verification: each edition's mark/badge/accent/name; Roomy vs Compact (resize narrow → Values cue + secondary copy drop, compact body + "Open the docs" appear); Docs/GitHub/Sponsor/Coffee links launching via the host prompt; diagnostics dialog reading as the same product. Do not merge until the author confirms.

- [ ] **Step 4: After UAT — design_landing cleanup (author)**

The `design_landing/` folder is reference-only and can be removed once the splash is confirmed. The three needed marks already live in `assets/`; nothing in `src/` or the plan depends on `design_landing/`.

---

## Self-review notes

- **Spec coverage:** U1→T1; U2 (edition constant) folded into T2 (resolved config + edition); U3→T4/T5; U4→T3/T4; U5→T5/T6; U6→T7; U7→T8; build/UAT→T9. The user's two refinements — edition-accurate `VisualConstants` and source-controlled `assets/*.svg` marks — are T2 and T3 respectively.
- **Type consistency:** `Edition` is defined once in `src/visual-config.generated.ts` and reused by `landing-splash.ts`, `landing-page-handler.ts`, and `VisualConstants`. The active mark is a single `MARK_URL: string` from the generated `landing-mark.generated.ts` (T3), passed to the splash's `markUrl` param (T4) — no per-edition lookup at runtime. `LandingLabels`/`LandingUrls`/`SplashOptions` are defined in `landing-splash.ts` and consumed by the handler. `.hc-landing-*` class hooks match across builder (T4), LESS (T5), and tests.
- **Bundle hygiene:** only the active edition's mark is imported (via the generated module), so a single-edition package never bundles the other two marks — consistent with the sanitizer tree-shaking already in the build.
- **Cert-safety:** no `innerHTML` anywhere — link icons via `createElementNS`, brand marks via `<img>` data URIs.
- **Self-contained:** all values/path-data are inline here or in committed `assets/*.svg`; no dependency on `design_landing/` (removed in T9 Step 4).
- **Open item:** the compact breakpoint (`max-width: 360px`) and the choice of the glyph-badge art (the renamed `store-*` → `shield-*`) over the plain-dot `palette-*` art are starting choices — tune in T9 UAT.
```
