# Tree-shakable Sanitizer (Lean Base Editions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Physically exclude the sanitizer subtree (`dompurify`, `postcss`/`postcss-value-parser` via `css-sanitizer`, `svg-payload-scan`) from the `standalone`/`standard` bundles via module-graph separation, while the certified edition keeps the real sanitizer as the committed, auditable default.

**Architecture:** A light `src/sanitize/index.ts` seam owns markdown + parsing and delegates sanitizing to a build-selected backend. `backend.certified.ts` (the heavy half of today's `sanitize-pipeline.ts`) is the sole importer of the heavy deps; `backend.passthrough.ts` is a dependency-free stub. A generated one-line `backend.ts` selects between them. Edition selection flows through `pbiviz.mjs` + an explicit `scripts/select-edition.mjs` prestep writing git-ignored artifacts.

**Tech Stack:** TypeScript (ESM, `module: es6`), Vitest (jsdom), `powerbi-visuals-tools@7.1` (webpack 5), Node ESM scripts (`.mjs`).

**Design doc:** `docs/brainstorms/2026-06-20-tree-shakable-sanitizer-editions.md`

**Branch:** create a fresh branch off `2.0.0` (e.g. `feat/tree-shakable-sanitizer`).

---

## Background facts (read before starting)

- **Today's flag is a runtime read:** `src/sanitize-pipeline.ts:2` does `import * as config from '../config/visual.json'` and branches on `config.sanitize`. `config/visual.json` is `{ "sanitize": true }`. The base packager (`bin/package-custom`) merges `{ "sanitize": false }` over it, runs `pbiviz package`, then reverts. Nothing tree-shakes because the flag is runtime and the heavy imports are static side-effectful edges.
- **Only two runtime readers of the flag:** `src/sanitize-pipeline.ts` (internal) and `src/visual.ts:560` (`sanitizeEnabled: config.sanitize`).
- **Only `domain-utils.ts` consumes the sanitizer** (`src/domain-utils.ts:22-28`): `getParsedHtmlAsDom`, `getSanitizedCss`, `parseAndSanitizeInContext`, `sanitizeFragmentInPlace`, `SanitizeOptions`; it re-exports `getParsedHtmlAsDom` (`src/domain-utils.ts:36`).
- **`css-sanitizer.ts` and `svg-payload-scan.ts` are imported only by `sanitize-pipeline.ts`** and do not move.
- **`capabilities.mjs` is NOT honored at package time** (the webpack plugin `JSON.parse`s the raw path). Per-edition privileges ride on the capabilities **path** that `pbiviz.mjs` points to.
- **Edition base values** (`pbiviz.json`): displayName `HTML Content (lite)`, guid `htmlContent443BE3AD55E043BF878BED274D3A6865`, icon `assets/palette_icon_lite.png`, `capabilities: "capabilities.json"`. This base IS the certified edition.
- Test files importing `../src/sanitize-pipeline`: `sanitize-pipeline.test.ts`, `sanitize-pipeline-svg.test.ts`, `body-styling.test.ts`, `diagnostics-sink-instrumentation.test.ts`, `hyperlinks-rendering.test.ts`, `lorem-rendering.test.ts`, `stylesheet-rendering.test.ts`.

## File Structure

- Create `src/sanitize/options.ts` — the `SanitizeOptions` type (relocated; type-only, zero deps).
- Create `src/sanitize/backend.passthrough.ts` — dependency-free stub backend.
- Create `src/sanitize/backend.ts` — generated selector (default → certified). Git-ignored.
- Create `src/sanitize/index.ts` — light public seam (markdown/parse + delegate + re-exports).
- Move `src/sanitize-pipeline.ts` → `src/sanitize/backend.certified.ts` — heavy backend.
- Modify `src/domain-utils.ts`, `src/visual.ts`, `src/diagnostics/types.ts` — import-path churn.
- Modify the seven test files — retarget imports.
- Delete `config/visual.json`.
- Create `config/editions.mjs`, `pbiviz.mjs`, `scripts/select-edition.mjs`, `scripts/check-no-sanitizer.mjs`.
- Modify `package.json` (scripts), `.gitignore`. Repurpose/delete `config/package.json`, `bin/package-custom`.

---

## Task 1: Create the sanitize seam, keep behavior identical

This is a refactor (a move + split). The test strategy is **keep the existing suite green** at every step; the certified backend is the default, so all current behavior is preserved.

**Files:**
- Create: `src/sanitize/options.ts`, `src/sanitize/backend.passthrough.ts`, `src/sanitize/backend.ts`, `src/sanitize/index.ts`
- Move: `src/sanitize-pipeline.ts` → `src/sanitize/backend.certified.ts`
- Modify: `src/domain-utils.ts:22-36`, `src/visual.ts`, `src/diagnostics/types.ts`
- Delete: `config/visual.json`

- [ ] **Step 1: Create the relocated options type**

Create `src/sanitize/options.ts`:

```ts
/** Options threaded through the sanitize seam to the active backend. */
export type SanitizeOptions = {
    allowHyperlinks?: boolean;
};
```

- [ ] **Step 2: Move the heavy module to the certified backend**

```bash
git mv src/sanitize-pipeline.ts src/sanitize/backend.certified.ts
```

- [ ] **Step 3: Fix imports in the moved file (deeper path; drop now-unused deps)**

In `src/sanitize/backend.certified.ts`:

- Internal imports move from `./` to `../`.
- `marked` and `RenderFormat` are dropped — they were used only by the three light wrappers (`getParsedHtmlAsDom`, `parseAndSanitizeInContext`) that move to `index.ts` in Step 4. Leaving them would fail eslint.
- The `config` import and the local `SanitizeOptions` definition are replaced by the relocated type.

Make the top-of-file external + internal import block read:

```ts
// External dependencies
import DOMPurify from 'dompurify';
import type {
    DOMPurify as DOMPurifyType,
    Config,
    UponSanitizeAttributeHookEvent
} from 'dompurify';

// Internal dependencies
import { VisualConstants } from '../visual-constants';
import { sanitizeCss } from '../css-sanitizer';
import {
    hasDangerousSvgPayload,
    isSafeImageDataUri,
    SAFE_IMAGE_MIME_TYPES
} from '../svg-payload-scan';
import { recordRemoval } from '../diagnostics/diagnostics-sink';
import { SanitizeOptions } from './options';
```

This removes the former `import { marked } from 'marked';`, `import { RenderFormat } from './types';`, and `import * as config from '../config/visual.json';` lines. Then delete the local `export type SanitizeOptions = { allowHyperlinks?: boolean; };` block (now imported from `./options`).

- [ ] **Step 4: Remove the light wrappers from the certified backend (they move to index.ts)**

Delete these three exported functions from `src/sanitize/backend.certified.ts` — `getParsedHtmlAsDom`, `parseAndSanitizeInContext`, and `getSanitizedCss`. (Keep everything else: `getSanitizedContent`, `sanitizeFragmentInPlace`, `getSanitizedDataUri`, `getSanitizedHtmlForTesting`, `preprocessStyleTags`, `dpConfig`, the hooks, `withSanitizerHooks`, `recordCoreRemovals`, `isInPlaceSanitizableRoot`.)

- [ ] **Step 5: Drop the dead `config.sanitize` guard in `sanitizeFragmentInPlace`**

In `src/sanitize/backend.certified.ts`, `sanitizeFragmentInPlace` is now only ever the certified path, so the guard is always-false-to-skip. Remove these lines from the top of its body:

```ts
    // The unsanitized (standalone) edition renders author HTML as-is. Match
    // getParsedHtmlAsDom/parseAndSanitizeInContext: when sanitization is
    // disabled this is a no-op, so body templates are NOT sanitized while
    // row content is left raw — the two paths stay consistent per edition.
    if (!config.sanitize) return;
```

So the function begins directly with `withSanitizerHooks((purify) => {`.

- [ ] **Step 6: Expose the backend contract names + `enabled`**

Append to `src/sanitize/backend.certified.ts`:

```ts
// --- Sanitizer backend contract (certified) ---------------------------------
// These are the names the seam (src/sanitize/index.ts) delegates to. The
// passthrough backend exposes the same names as identity/no-ops.

/** Certified: full preprocess + DOMPurify. */
export const sanitizeHtmlString = getSanitizedContent;

/** Certified: the <style>-tag preprocessing applied before context-parsing. */
export const preprocessHtmlString = preprocessStyleTags;

/** Certified: run the CSS sanitizer on a custom stylesheet. */
export const sanitizeCssString = (css: string): string =>
    sanitizeCss(css, 'stylesheet');

/** This edition runs the sanitizer. */
export const enabled = true;
```

Note: `preprocessStyleTags` is currently a non-exported `function` (`src/sanitize/backend.certified.ts:174`). Add `export` to its declaration: `export function preprocessStyleTags(input: string): string {`.

- [ ] **Step 7: Create the passthrough backend (dependency-free)**

Create `src/sanitize/backend.passthrough.ts`:

```ts
/**
 * Passthrough sanitizer backend for the base (standalone/standard) editions.
 * Identity/no-ops — zero heavy imports — so dompurify / postcss / css-sanitizer
 * / svg-payload-scan never enter this edition's module graph. Behavior matches
 * today's `config.sanitize === false` path exactly: author HTML/CSS render as-is.
 */
import { SanitizeOptions } from './options';

export const sanitizeHtmlString = (
    html: string,
    _options?: SanitizeOptions
): string => html;

export const preprocessHtmlString = (html: string): string => html;

export const sanitizeFragmentInPlace = (
    _fragment: DocumentFragment | Element,
    _options?: SanitizeOptions
): void => {
    /* base editions trust author input; nothing to sanitize */
};

export const sanitizeCssString = (css: string): string => css;

export const enabled = false;
```

- [ ] **Step 8: Create the generated selector (default → certified)**

Create `src/sanitize/backend.ts`:

```ts
// GENERATED by scripts/select-edition.mjs — do not edit.
// Default committed state targets the certified backend so a plain build,
// `npm test`, and a fresh clone all compile the real sanitizer.
export * from './backend.certified';
```

- [ ] **Step 9: Create the light seam (index.ts)**

Create `src/sanitize/index.ts`. The three wrappers are the former bodies with the `config.sanitize` branch replaced by an unconditional backend delegation:

```ts
// External dependencies
import { marked } from 'marked';

// Internal dependencies
import { RenderFormat } from '../types';
import { SanitizeOptions } from './options';
import {
    sanitizeHtmlString,
    preprocessHtmlString,
    sanitizeFragmentInPlace,
    sanitizeCssString,
    enabled
} from './backend';

export { SanitizeOptions } from './options';
export { sanitizeFragmentInPlace } from './backend';

/**
 * Whether this edition runs the sanitizer (the certified backend). Replaces the
 * former `config.sanitize` read (e.g. visual.ts's diagnostics `sanitizeEnabled`).
 */
export const sanitizerEnabled = enabled;

/**
 * Parse the supplied HTML string and return a DOM fragment. The active backend
 * decides whether the string is sanitized first (certified) or passed through
 * unchanged (base editions).
 */
export const getParsedHtmlAsDom = (
    content: string,
    format: RenderFormat,
    options?: SanitizeOptions
) => {
    const parse = Range.prototype.createContextualFragment.bind(
        document.createRange()
    );
    const converted =
        format === 'markdown' ? marked.parse(content).toString() : content;
    return parse(sanitizeHtmlString(converted, options));
};

/**
 * Parse `content` in the content model of `contextEl` (so `<tr>` etc. survive
 * instead of being foster-parented), then sanitize the parsed node(s) in place
 * via the active backend. Tokens must already be substituted before this call.
 */
export const parseAndSanitizeInContext = (
    content: string,
    format: RenderFormat,
    contextEl: Element,
    options?: SanitizeOptions
): DocumentFragment => {
    const converted =
        format === 'markdown' ? marked.parse(content).toString() : content;
    const preprocessed = preprocessHtmlString(converted);
    const range = document.createRange();
    range.selectNodeContents(contextEl);
    const fragment = range.createContextualFragment(preprocessed);
    sanitizeFragmentInPlace(fragment, options);
    return fragment;
};

/** Sanitize CSS content (custom stylesheet entry point). */
export const getSanitizedCss = (css: string): string => {
    if (!css || typeof css !== 'string') {
        return '';
    }
    return sanitizeCssString(css);
};
```

- [ ] **Step 10: Rewire `domain-utils.ts`**

In `src/domain-utils.ts`, change the import block (lines 22-28) and the re-export (line 36) to point at the seam:

```ts
import {
    getParsedHtmlAsDom,
    getSanitizedCss,
    parseAndSanitizeInContext,
    sanitizeFragmentInPlace,
    SanitizeOptions
} from './sanitize';
```

```ts
export { getParsedHtmlAsDom } from './sanitize';
```

- [ ] **Step 11: Rewire `visual.ts`**

In `src/visual.ts`, remove the config import line `import * as config from '../config/visual.json';` and add an import of the seam flag. Add near the other internal imports:

```ts
import { sanitizerEnabled } from './sanitize';
```

Then change the diagnostics snapshot field (currently `sanitizeEnabled: config.sanitize,` at `src/visual.ts:560`) to:

```ts
            sanitizeEnabled: sanitizerEnabled,
```

- [ ] **Step 12: Update the stale comment in diagnostics/types.ts**

In `src/diagnostics/types.ts` (~line 97) the doc comment references `config.sanitize`. Update the wording to `sanitizerEnabled (the active sanitizer backend)`. No code change.

- [ ] **Step 13: Retarget test imports**

`getSanitizedHtmlForTesting`, `getSanitizedContent`, `getSanitizedDataUri`, and `SanitizeOptions` live in the certified backend; `getSanitizedCss` and `parseAndSanitizeInContext` live in the seam. Apply:

- `test/body-styling.test.ts:9` → `import { getSanitizedHtmlForTesting } from '../src/sanitize/backend.certified';`
- `test/hyperlinks-rendering.test.ts:6` → same retarget to `'../src/sanitize/backend.certified'`
- `test/lorem-rendering.test.ts:6` → same retarget to `'../src/sanitize/backend.certified'`
- `test/diagnostics-sink-instrumentation.test.ts:2` → `getSanitizedHtmlForTesting` from `'../src/sanitize/backend.certified'`; line 4 `import type { SanitizeOptions } from '../src/sanitize/options';`
- `test/sanitize-pipeline-svg.test.ts` → retarget its `'../src/sanitize-pipeline'` import to `'../src/sanitize/backend.certified'` (check whether it also uses `parseAndSanitizeInContext`/`getSanitizedCss`; those come from `'../src/sanitize'`).
- `test/sanitize-pipeline.test.ts:2-6` → `getSanitizedHtmlForTesting` from `'../src/sanitize/backend.certified'`; `getSanitizedCss` and `parseAndSanitizeInContext` from `'../src/sanitize'`.
- `test/stylesheet-rendering.test.ts` → `getSanitizedCss` from `'../src/sanitize'` (and any `getSanitizedHtmlForTesting` from `'../src/sanitize/backend.certified'`).

Run `grep -rn "src/sanitize-pipeline" test/` afterward; expect **no** matches.

- [ ] **Step 14: Delete the runtime flag file**

```bash
git rm config/visual.json
```

- [ ] **Step 15: Run the full suite**

Run: `npx vitest run`
Expected: all suites PASS (same count as before the refactor — the certified backend is the default, behavior is unchanged).

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "refactor: split sanitizer into a build-selectable seam (certified default)"
```

---

## Task 2: Passthrough backend parity test

**Files:**
- Create: `test/sanitize-passthrough.test.ts`

- [ ] **Step 1: Write the parity test**

Create `test/sanitize-passthrough.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import * as pass from '../src/sanitize/backend.passthrough';

describe('passthrough sanitizer backend', () => {
    it('reports disabled', () => {
        expect(pass.enabled).toBe(false);
    });

    it('sanitizeHtmlString returns input unchanged', () => {
        const dirty = '<img src=x onerror=alert(1)><script>boom()</script>';
        expect(pass.sanitizeHtmlString(dirty)).toBe(dirty);
    });

    it('preprocessHtmlString returns input unchanged', () => {
        const input = '<style>a{color:red}</style>';
        expect(pass.preprocessHtmlString(input)).toBe(input);
    });

    it('sanitizeCssString returns input unchanged', () => {
        const css = 'a{background:url(javascript:alert(1))}';
        expect(pass.sanitizeCssString(css)).toBe(css);
    });

    it('sanitizeFragmentInPlace leaves the fragment untouched', () => {
        const dom = new JSDOM('<!DOCTYPE html><body></body>');
        const range = dom.window.document.createRange();
        range.selectNodeContents(dom.window.document.body);
        const frag = range.createContextualFragment(
            '<div onclick="x()">hi</div>'
        );
        const before = frag.childNodes.length;
        pass.sanitizeFragmentInPlace(frag as unknown as DocumentFragment);
        expect(frag.childNodes.length).toBe(before);
        const div = frag.firstChild as HTMLElement;
        expect(div.getAttribute('onclick')).toBe('x()');
    });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/sanitize-passthrough.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add test/sanitize-passthrough.test.ts
git commit -m "test: passthrough sanitizer backend parity"
```

---

## Task 3: Build/edition wiring (pbiviz.mjs + select-edition prestep)

**Files:**
- Create: `config/editions.mjs`, `pbiviz.mjs`, `scripts/select-edition.mjs`
- Modify: `package.json`, `.gitignore`
- Delete: `config/package.json`, `bin/package-custom`

- [ ] **Step 1: Create the single edition data source**

Create `config/editions.mjs` (values lifted from today's `config/package.json`):

```js
// Single source of truth for per-edition build configuration.
// `certified` is the default (the committed pbiviz.json base): sanitized, no
// WebAccess privilege, audited by Microsoft. The base editions disable the
// sanitizer (handled by the code seam) and request WebAccess.
export const editions = {
    certified: {
        visual: {},
        assets: {},
        capabilities: 'capabilities.json',
        sanitize: true,
        privileges: []
    },
    standard: {
        visual: {
            displayName: 'HTML Content',
            guid: 'htmlContent443BE3AD55E043BF878BED274D3A6855',
            description:
                'Visualize column or measure values as HTML in your Power BI reports.'
        },
        assets: { icon: 'assets/palette_icon_standard.png' },
        capabilities: 'capabilities.webaccess.json',
        sanitize: false,
        privileges: [{ name: 'WebAccess', parameters: ['*'] }]
    },
    standalone: {
        visual: {
            displayName: 'HTML Content - STANDALONE VERSION',
            guid: 'STANDALONEhtmlContent443BE3AD55E043BF878BED274D3A6855',
            description:
                'Visualize column or measure values as HTML in your Power BI reports.'
        },
        assets: { icon: 'assets/palette_icon_standalone.png' },
        capabilities: 'capabilities.webaccess.json',
        sanitize: false,
        privileges: [{ name: 'WebAccess', parameters: ['*'] }]
    }
};
```

- [ ] **Step 2: Create `pbiviz.mjs` (computed metadata, honored by the tools)**

Create `pbiviz.mjs` at the repo root. It reads the committed `pbiviz.json` as the certified base, then applies the active edition's overrides:

```js
// Honored by powerbi-visuals-tools (>=6.0.0): a `.mjs` config is dynamically
// imported in preference to the `.json`. This computes the per-edition pbiviz
// config from `config/editions.mjs` + the active edition written by
// scripts/select-edition.mjs. Defaults to `certified` when no edition is selected.
import { readFileSync } from 'node:fs';
import { editions } from './config/editions.mjs';

const base = JSON.parse(
    readFileSync(new URL('./pbiviz.json', import.meta.url), 'utf8')
);

let edition = 'certified';
try {
    edition =
        (await import('./config/active-edition.mjs')).default ?? 'certified';
} catch {
    /* no active edition selected yet: certified default */
}

const e = editions[edition] ?? editions.certified;

export default {
    ...base,
    visual: { ...base.visual, ...e.visual },
    assets: { ...base.assets, ...e.assets },
    capabilities: e.capabilities ?? base.capabilities
};
```

- [ ] **Step 3: Create the select-edition prestep**

Create `scripts/select-edition.mjs`:

```js
// Prestep run before `pbiviz package`/`start`/`test`. Writes the git-ignored
// edition artifacts: the sanitizer backend selector, the active-edition handoff
// for pbiviz.mjs, and (for base editions) the WebAccess capabilities file.
import { readFileSync, writeFileSync } from 'node:fs';
import { editions } from '../config/editions.mjs';

const edition = process.argv[2] ?? 'certified';
const e = editions[edition];
if (!e) {
    console.error(`Unknown edition: ${edition}`);
    process.exit(1);
}

const backend = e.sanitize ? 'backend.certified' : 'backend.passthrough';
writeFileSync(
    new URL('../src/sanitize/backend.ts', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `export * from './${backend}';\n`
);

writeFileSync(
    new URL('../config/active-edition.mjs', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `export default '${edition}';\n`
);

if (!e.sanitize) {
    const caps = JSON.parse(
        readFileSync(new URL('../capabilities.json', import.meta.url), 'utf8')
    );
    caps.privileges = e.privileges;
    writeFileSync(
        new URL('../capabilities.webaccess.json', import.meta.url),
        JSON.stringify(caps, null, 4) + '\n'
    );
}

console.log(
    `Selected edition: ${edition} (sanitize=${e.sanitize}, backend=${backend})`
);
```

- [ ] **Step 4: Verify the prestep writes the certified default**

Run: `node scripts/select-edition.mjs certified`
Expected stdout: `Selected edition: certified (sanitize=true, backend=backend.certified)`
Then confirm `src/sanitize/backend.ts` ends with `export * from './backend.certified';` and `config/active-edition.mjs` exists.

- [ ] **Step 5: Verify the standalone prestep writes passthrough + capabilities**

Run: `node scripts/select-edition.mjs standalone`
Expected stdout: `Selected edition: standalone (sanitize=false, backend=backend.passthrough)`
Confirm `src/sanitize/backend.ts` now targets `./backend.passthrough` and `capabilities.webaccess.json` exists with a `privileges` array containing `WebAccess`.
Then reset to certified: `node scripts/select-edition.mjs certified`

- [ ] **Step 6: Git-ignore the generated artifacts**

Append to `.gitignore`:

```
# Generated per-edition build artifacts (scripts/select-edition.mjs)
src/sanitize/backend.ts
config/active-edition.mjs
capabilities.webaccess.json
```

Then untrack the now-committed selector if git is tracking it:

```bash
git rm --cached src/sanitize/backend.ts
```

- [ ] **Step 7: Update npm scripts**

In `package.json`, replace the `package-standard`/`package-standalone` scripts and add lifecycle hooks. The relevant `scripts` entries become:

```jsonc
"package":            "node scripts/select-edition.mjs certified && pbiviz package",
"package-standard":   "node scripts/select-edition.mjs standard && pbiviz package",
"package-standalone": "node scripts/select-edition.mjs standalone && pbiviz package",
"prestart":           "node scripts/select-edition.mjs certified",
"pretest":            "node scripts/select-edition.mjs certified",
"postinstall":       "node scripts/select-edition.mjs certified"
```

(Keep all other scripts unchanged. `start` and `test` stay as-is; their `pre*` hooks run the selector first.)

- [ ] **Step 8: Remove the superseded packager**

```bash
git rm bin/package-custom config/package.json
```

Confirm nothing else references them: `grep -rn "package-custom\|config/package.json" . --include=*.json --include=*.js --include=*.mjs -l` (expect no matches outside `node_modules`).

- [ ] **Step 9: Verify tests still pass through the new pretest hook**

Run: `npm test`
Expected: the `pretest` selector logs `certified`, then all Vitest suites PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "build: edition selection via pbiviz.mjs + select-edition prestep"
```

---

## Task 4: Anti-regression guard (no sanitizer bytes in the base bundle)

**Files:**
- Create: `scripts/check-no-sanitizer.mjs`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write the guard script**

Create `scripts/check-no-sanitizer.mjs`. It scans the bundled `visual.js` (webpack drop) for a DOMPurify fingerprint — DOMPurify creates a Trusted Types policy named `dompurify`, a string literal that survives minification:

```js
// Fails if the freshly-built bundle contains sanitizer code. Intended to run
// immediately after `npm run package-standalone` (or package-standard). The
// webpack drop is the unzipped bundle; adjust BUNDLE if the drop folder differs.
import { existsSync, readFileSync } from 'node:fs';

const BUNDLE = '.tmp/drop/visual.js';
if (!existsSync(BUNDLE)) {
    console.error(
        `Bundle not found at ${BUNDLE}. Run a package build first.`
    );
    process.exit(1);
}

const source = readFileSync(BUNDLE, 'utf8');
// DOMPurify's trusted-types policy name is the literal "dompurify"; postcss
// ships its package name in error/Symbol strings. Either presence means the
// sanitizer subtree leaked into a base-edition bundle.
const fingerprints = [/dompurify/i, /postcss-value-parser/i];
const hits = fingerprints
    .filter((re) => re.test(source))
    .map((re) => re.source);

if (hits.length > 0) {
    console.error(
        `FAIL: sanitizer fingerprint(s) in base bundle: ${hits.join(', ')}`
    );
    process.exit(1);
}
console.log('OK: no sanitizer fingerprint in the base bundle.');
```

- [ ] **Step 2: Add a combined guarded-package script**

In `package.json` add:

```jsonc
"verify-standalone-lean": "npm run package-standalone && node scripts/check-no-sanitizer.mjs"
```

- [ ] **Step 3: Prove the guard PASSES for the standalone bundle**

Run: `npm run verify-standalone-lean`
Expected: package completes, then `OK: no sanitizer fingerprint in the base bundle.`
(If the drop path differs, confirm the real path with `ls .tmp/drop/` and update `BUNDLE`.)

- [ ] **Step 4: Prove the guard CATCHES a leak (negative check)**

Temporarily build the certified bundle into the same drop and confirm the guard fails:

Run: `node scripts/select-edition.mjs certified && pbiviz package && node scripts/check-no-sanitizer.mjs`
Expected: `FAIL: sanitizer fingerprint(s) in base bundle: dompurify` and a non-zero exit.
Then reset: `node scripts/select-edition.mjs certified`

This confirms the guard is wired to real bundle content, not a no-op.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-no-sanitizer.mjs package.json
git commit -m "test: guard that base bundles contain no sanitizer bytes"
```

---

## Task 5: Verify all three editions build + measure the win

**Files:** none (verification only)

- [ ] **Step 1: Build certified and confirm sanitizer present**

Run: `npm run package && node -e "const s=require('fs').readFileSync('.tmp/drop/visual.js','utf8');console.log('dompurify present:', /dompurify/i.test(s))"`
Expected: `dompurify present: true` (certified must keep the sanitizer).

- [ ] **Step 2: Build standalone + standard and confirm lean**

Run: `npm run verify-standalone-lean`
Then: `npm run package-standard && node scripts/check-no-sanitizer.mjs`
Expected: both print the `OK:` line.

- [ ] **Step 3: Record the bundle-size delta**

Compare `.tmp/drop/visual.js` size (or the `dist/*.pbiviz`) between a certified build and a standalone build, and note the reduction in the design doc's "Goal" section (replace the estimate with the measured figure). Reference the Statoscope report (`webpack.statistics.prod.html`) to confirm `dompurify`/`postcss` modules are absent from the standalone graph.

- [ ] **Step 4: Reset working tree to certified default**

Run: `node scripts/select-edition.mjs certified`
Confirm `git status` shows no tracked changes from the builds (generated artifacts are git-ignored; `.tmp/` and `dist/` already ignored).

- [ ] **Step 5: Commit any doc measurement update**

```bash
git add docs/brainstorms/2026-06-20-tree-shakable-sanitizer-editions.md
git commit -m "docs: record measured base-bundle size reduction"
```

---

## Self-Review notes

- **Spec coverage:** seam (Task 1), passthrough parity (Task 2), build wiring incl. `pbiviz.mjs`/capabilities path/`editions.mjs`/deletions (Task 3), anti-regression guard (Task 4), three-edition verification + size measurement (Task 5). All design sections mapped.
- **Parity:** Task 1 preserves byte-identical behavior (certified default); existing suite is the regression net. Steps 5/15 explicitly re-run it.
- **Type/name consistency:** backend contract names (`sanitizeHtmlString`, `preprocessHtmlString`, `sanitizeFragmentInPlace`, `sanitizeCssString`, `enabled`) are identical across `backend.certified.ts`, `backend.passthrough.ts`, and the `index.ts` import. `SanitizeOptions` is defined once in `src/sanitize/options.ts` and imported everywhere.
- **Known follow-up to confirm during execution:** the exact webpack drop path (`.tmp/drop/visual.js`) — Task 4 Step 3 verifies it; and whether `test/sanitize-pipeline-svg.test.ts` imports any seam-level function (Task 1 Step 13 calls this out).
```
