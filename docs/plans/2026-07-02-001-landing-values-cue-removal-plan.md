# Landing Values Cue Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the fake "drop a field here" Values cue from the landing splash and serve one unified body message at every container size.

**Architecture:** Pure presentation prune, no new states. The hero loses its two-column (copy + cue) layout and becomes headline + single lede; the compact container query stops swapping in a separate short string and instead keeps the lede visible. Strings, DOM builders, styles, and unit tests shrink accordingly.

**Tech Stack:** TypeScript (strict), Less, Vitest + JSDOM, pbiviz toolchain.

**Spec:** `docs/brainstorms/2026-07-02-landing-values-cue-removal.md` (approved). Key verified fact: Power BI never routes field-drag events into the sandboxed iframe, so an in-visual dropzone is impossible — the cue must go.

**Branch:** `refactor/splash-comprehension` (already checked out).

**Toolchain gotchas for the executor:**
- `npm test` has a `pretest` hook that flips the edition to `certified` (rewrites generated config). Use `npx vitest run …` for focused runs to avoid churning the working tree; the edition flip is harmless but noisy.
- Files are formatted with Prettier (4-space indent, single quotes). Run `npm run prettier-check` before the final commit if unsure.
- The five files below are the **only** consumers of the cue strings/classes (verified by grep); historical docs under `docs/` mention them and are intentionally left alone.

---

### Task 1: Failing test — no cue, unified lede

**Files:**
- Modify: `test/landing-splash.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the existing `describe('buildSplash', …)` block (after the SVG-namespace test):

```ts
    it('renders a single unified body message and no Values cue', () => {
        const el = buildSplash(doc, {
            edition: 'standalone',
            version: '2.0.0.0',
            markUrl: 'x',
            labels,
            urls,
            onLaunch: vi.fn()
        });
        expect(el.querySelector('.hc-landing-lede')?.textContent).toBe(
            labels.body
        );
        expect(el.querySelector('.hc-landing-values')).toBeNull();
        expect(el.querySelector('.hc-landing-dropzone')).toBeNull();
        expect(el.querySelector('.hc-landing-compact-body')).toBeNull();
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/landing-splash.test.ts`
Expected: FAIL — the new test's `.hc-landing-values` assertion fails (element exists); the four pre-existing tests still pass.

### Task 2: Prune the hero DOM

**Files:**
- Modify: `src/landing/splash.ts:215-250` (`buildHero`)

- [ ] **Step 1: Replace buildHero**

Replace the whole `buildHero` function (currently builds copy + Values cue) with:

```ts
/**
 * Builds the hero: headline + the single body message. There is no drop cue —
 * field drags never reach the sandboxed iframe, so an in-visual dropzone can
 * never work (see docs/brainstorms/2026-07-02-landing-values-cue-removal.md).
 */
const buildHero = (doc: Document, opts: SplashOptions): HTMLElement => {
    const { labels } = opts;
    const hero = node(doc, 'div', 'hc-landing-hero');
    hero.appendChild(node(doc, 'h1', 'hc-landing-headline', labels.headline));
    hero.appendChild(node(doc, 'p', 'hc-landing-lede', labels.body));
    return hero;
};
```

Notes: the `hc-landing-copy` wrapper div is dropped too (the hero has one column now); the `hc-landing-compact-body` paragraph is gone (unified message). Update `buildSplash`'s hero comment (`// Hero: headline + lede beside the Values cue…`) to `// Hero: headline + body message. Grows to fill spare height.`

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run test/landing-splash.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add test/landing-splash.test.ts src/landing/splash.ts
git commit -m "refactor: remove Values drop cue from landing hero"
```

### Task 3: Shrink the labels contract and strings

**Files:**
- Modify: `src/landing/splash.ts:4-17` (`LandingLabels`)
- Modify: `src/landing/handler.ts:76-88` (labels wiring)
- Modify: `test/landing-splash.test.ts:5-17` (fixture)
- Modify: `stringResources/en-US/resources.resjson`

- [ ] **Step 1: Remove the four dead keys from LandingLabels**

In `src/landing/splash.ts`, the interface becomes:

```ts
/** Localised display strings for every text slot on the splash. */
export interface LandingLabels {
    headline: string;
    body: string;
    quickStart: string;
    whatsNew: string;
    sandboxNote: string;
    sandboxNoteLink: string;
    openDocs: string;
}
```

(`valuesLabel`, `valuesField`, `valuesHint`, `compactBody` deleted.)

- [ ] **Step 2: Remove the wiring in handler.ts**

In `render()`, delete these four lines from the `labels` object:

```ts
            valuesLabel: get('Landing_ValuesLabel'),
            valuesField: get('Landing_ValuesField'),
            valuesHint: get('Landing_ValuesHint'),
            compactBody: get('Landing_CompactBody'),
```

- [ ] **Step 3: Update the test fixture**

In `test/landing-splash.test.ts`, the fixture becomes:

```ts
const labels: LandingLabels = {
    headline: 'Ready when you are.',
    body: 'Add a measure or field that returns HTML to the Values well.',
    quickStart: 'Quick start',
    whatsNew: "What's new",
    sandboxNote: 'Some browser features are limited inside the sandbox.',
    sandboxNoteLink: 'see the docs',
    openDocs: 'Open the docs'
};
```

- [ ] **Step 4: Update resources.resjson**

Reword `Landing_Body` (keep the file's existing plain "-" dash style) and delete the four superseded keys (`Landing_ValuesLabel`, `Landing_ValuesField`, `Landing_ValuesHint`, `Landing_CompactBody`):

```json
    "Landing_Body": "Add a measure or field that returns HTML to the Values well in the Visualizations pane, and it renders right here - live on the canvas.",
```

en-US is the only locale directory — no other resjson files to touch.

- [ ] **Step 5: Verify types and tests**

Run: `npx tsc --noEmit`
Expected: no output (clean).
Run: `npx vitest run test/landing-splash.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/landing/splash.ts src/landing/handler.ts test/landing-splash.test.ts stringResources/en-US/resources.resjson
git commit -m "refactor: unify landing body message, drop cue strings"
```

### Task 4: Styles — delete cue rules, keep lede in compact

**Files:**
- Modify: `style/visual.less` (all inside the `.hc-landing { … }` block)

- [ ] **Step 1: Simplify the hero/copy rules (~lines 462-496)**

The hero is single-column now. Replace:

```less
    // Hero row: copy flows beside the Values cue (no overlap). Positioned so it
    // paints above the watermark.
    .hc-landing-hero {
        position: relative;
        z-index: 1;
        flex: none;
        display: flex;
        gap: 12px;
        align-items: flex-start;
    }
```

with:

```less
    // Hero: headline + body message. Positioned so it paints above the
    // watermark.
    .hc-landing-hero {
        position: relative;
        z-index: 1;
        flex: none;
    }
```

Delete the now-orphaned `.hc-landing-copy` rule:

```less
    .hc-landing-copy {
        flex: 1;
        min-width: 0;
    }
```

- [ ] **Step 2: Delete the cue rules (~lines 531-584)**

Remove the whole block from the comment `// In-flow flex item beside the copy …` through `.hc-landing-drophint { … }` — i.e. the rules for `.hc-landing-values`, `.hc-landing-values-label`, `.hc-landing-dropzone`, `.hc-landing-chip`, `.hc-landing-chip-text`, `.hc-landing-chip-grip`, `.hc-landing-drophint`.

- [ ] **Step 3: Remove the compact-body base rule (~lines 586-589)**

Replace:

```less
    .hc-landing-compact-body,
    .hc-landing-opendocs {
        display: none;
    }
```

with:

```less
    .hc-landing-opendocs {
        display: none;
    }
```

- [ ] **Step 4: Rework the compact container block (~lines 591-609)**

The lede stays visible in compact; only links/sandbox collapse. Replace:

```less
    @container (max-width: 360px) {
        .hc-landing-values,
        .hc-landing-lede,
        .hc-landing-links,
        .hc-landing-sandbox {
            display: none;
        }
        .hc-landing-name {
            font-size: 8pt;
        }
        .hc-landing-compact-body {
            display: block;
            font-size: 10pt;
            line-height: 1.45;
            color: var(--hc-fg2);
            margin: 6px 0 0;
        }
```

with:

```less
    @container (max-width: 360px) {
        .hc-landing-links,
        .hc-landing-sandbox {
            display: none;
        }
        .hc-landing-name {
            font-size: 8pt;
        }
        // Unified message: same string as the wide layout, tighter metrics.
        // The width clamp is lifted — nothing competes for the row any more.
        .hc-landing-lede {
            max-width: none;
            margin: 6px 0 0;
        }
```

(Everything after — `.hc-landing-opendocs`, `.hc-landing-headline`, header wrap rules — stays untouched; the compact header icon-wrap behavior is explicitly preserved.)

- [ ] **Step 5: Verify the bundle builds and tests still pass**

Run: `npx tsc --noEmit`
Expected: clean.
Run: `npx vitest run`
Expected: all suites PASS (Less isn't unit-tested; full compile is verified in Task 5).

- [ ] **Step 6: Commit**

```bash
git add style/visual.less
git commit -m "style: drop landing cue rules, keep lede at compact breakpoint"
```

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint, format, full unit suite**

Run: `npm run eslint`
Expected: no errors.
Run: `npm run prettier-check`
Expected: "All matched files use Prettier code style!"
Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 2: Dev build + manual check (user-assisted)**

Run: `npm run start-standalone` (or reuse the running dev server — webpack hot-recompiles).
In Power BI Desktop with the developer visual unbound:
- Wide container: headline + one body sentence naming the Values well / Visualizations pane; no card, no dashed dropzone.
- Narrow the visual below ~360px: same sentence (smaller chrome), headline at 10pt, links/sandbox note hidden, "Open the docs" shown, GitHub/Sponsor/Coffee icons wrap under the logo/title.

- [ ] **Step 3: Flag the docs follow-up**

Remind the user: the landing-page screenshot in `docs/v2/HTML-Content-v2-Guide.md` needs re-taking after this change (out of code scope, tracked in the spec).
