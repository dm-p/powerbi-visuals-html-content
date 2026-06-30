# Sanitizer Complexity Cleanup, Relocation & Pattern Dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise CodeScene health across the sanitizer module by relocating two stray files, decomposing the flagged functions via behavior-preserving extraction, and unifying the duplicated dangerous-pattern lists into one canonical source.

**Architecture:** Three phases in increasing risk order. (1) `git mv` the two sanitizer files into `src/sanitize/`. (2) Behavior-preserving extraction — the cc=62 attribute hook becomes a thin dispatcher over pure gate functions in a new `attribute-policy.ts`; css/svg/visual helpers are extracted in place. (3) Pattern unification — a canonical `dangerous-patterns.ts` that all call sites derive from; this is the only phase that may *widen* detection, gated by a superset-assertion test and a hand-reviewed corpus diff.

**Tech Stack:** TypeScript, DOMPurify 3.4.11, postcss, vitest (unit), Playwright (integration), pbiviz/webpack build, CodeScene CLI.

**Spec:** `docs/brainstorms/2026-06-30-sanitizer-complexity-and-dedup.md`

---

## Conventions for every task

- **Behavior-preserving invariant (Phases 1–2, Tasks 1–9):** sanitizer *output* must not change. The proof is that `npm run docs:check` stays green **without** regenerating, and the full suites stay green. If `docs:check` ever fails during these tasks, you changed behavior — stop and revert.
- **Phase 3 (Tasks 10–13)** may widen detection only. Regenerate docs **and** the UAT corpus there (see `docs/solutions/conventions/regenerate-sanitizer-derived-artifacts-2026-06-30.md`).
- **CodeScene CLI:** `cs review` is at
  `C:/Users/DanielMarsh-Patrick/.vscode/extensions/codescene.codescene-vscode-0.27.2-win32-x64/cs-win32-x64.exe`.
  Score one file: `"$CS" review <file> | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).score))'`
- **Branch:** `refactor/sanitizer-health` (already checked out; spec committed at its tip).
- **Baseline health:** backend.certified.ts 5.7 · css-sanitizer.ts 8.19 · svg-payload-scan.ts 8.63 · visual.ts 8.16.

---

## File Structure (target)

```
src/sanitize/
  backend.certified.ts      # hooks become thin dispatchers; helpers extracted out
  attribute-policy.ts        # NEW — pure uponSanitizeAttribute gate functions + Verdict type
  css.ts                     # MOVED from src/css-sanitizer.ts; sanitizeCss decomposed
  svg-payload-scan.ts        # MOVED from src/svg-payload-scan.ts; hasDangerousSvgPayload flattened
  dangerous-patterns.ts      # NEW (Phase 3) — canonical dangerous-scheme source of truth
  backend.passthrough.ts     # comment ref update only
  backend.ts, index.ts, options.ts   # unchanged
src/
  visual.ts                  # openDiagnostics/update/buildRenderSteps split into private methods
  visual-constants.ts        # cssDangerousPatterns promoted to derive from dangerous-patterns.ts
```

---

## Phase 1 — Relocation

### Task 1: Move `svg-payload-scan.ts` into `src/sanitize/`

**Files:**
- Move: `src/svg-payload-scan.ts` → `src/sanitize/svg-payload-scan.ts`
- Modify imports: `src/css-sanitizer.ts`, `src/sanitize/backend.certified.ts`, `test/svg-payload-scan.test.ts`

- [ ] **Step 1: Move the file with git**

```bash
git mv src/svg-payload-scan.ts src/sanitize/svg-payload-scan.ts
```

- [ ] **Step 2: Update the importers**

In `src/sanitize/backend.certified.ts`, change the import specifier from `'../svg-payload-scan'` to `'./svg-payload-scan'`.
In `src/css-sanitizer.ts`, change `'./svg-payload-scan'` to `'./sanitize/svg-payload-scan'` (it has not moved yet; it moves in Task 2, after which this becomes `'./svg-payload-scan'`).
In `test/svg-payload-scan.test.ts`, change `'../src/svg-payload-scan'` to `'../src/sanitize/svg-payload-scan'`.

- [ ] **Step 3: Build + unit tests**

Run: `npm run package`
Expected: `Build completed successfully` (the `pwsh` cert warning is pre-existing and harmless).
Run: `npm test`
Expected: `977 passed`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move svg-payload-scan into src/sanitize/"
```

### Task 2: Move `css-sanitizer.ts` → `src/sanitize/css.ts`

**Files:**
- Move: `src/css-sanitizer.ts` → `src/sanitize/css.ts`
- Modify imports: `src/sanitize/backend.certified.ts`, the new `src/sanitize/css.ts` itself, any test importing it

- [ ] **Step 1: Move + rename with git**

```bash
git mv src/css-sanitizer.ts src/sanitize/css.ts
```

- [ ] **Step 2: Fix imports**

In `src/sanitize/css.ts`, change the svg-payload-scan import to the sibling path `'./svg-payload-scan'`.
In `src/sanitize/backend.certified.ts`, change `'../css-sanitizer'` to `'./css'`.
Grep for any other importer and update to `'../src/sanitize/css'` (tests) or `'./css'` (siblings):

```bash
grep -rn "css-sanitizer" src test test-integration scripts
```

Expected after edits: no remaining references to `css-sanitizer`.

- [ ] **Step 3: Build + unit + docs:check**

Run: `npm run package` → `Build completed successfully`
Run: `npm test` → `977 passed`
Run: `npm run docs:check` → `docs/sanitization-rules.md is in sync with the corpus.` (proves no behavior change)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move css-sanitizer to src/sanitize/css"
```

---

## Phase 2 — Behavior-preserving extraction

### Task 3: Scaffold `attribute-policy.ts` with the Verdict type and a shared context

**Files:**
- Create: `src/sanitize/attribute-policy.ts`

- [ ] **Step 1: Create the module with the gate contract**

```typescript
// src/sanitize/attribute-policy.ts
//
// Pure decision logic for the uponSanitizeAttribute hook. Each gate inspects
// an AttrContext and returns a Verdict. The hook in backend.certified.ts runs
// the gates in order and applies the verdict (recordRemoval + keepAttr /
// attrValue). Keeping the gates pure (no DOMPurify side-effects) makes the
// security policy unit-testable and drops the hook's cyclomatic complexity.

import { VisualConstants } from '../visual-constants';
import { isSafeImageDataUri } from './svg-payload-scan';
import { sanitizeCss } from './css';
import { getSanitizedDataUri } from './backend.certified';

export interface AttrContext {
    attrName: string;       // already lower-cased
    tagName: string;        // already lower-cased ('' if absent)
    value: string;          // current working value
    isSvgTag: boolean;
    allowHyperlinks: boolean;
}

export type Verdict =
    | { action: 'drop'; rule: string }          // record + keepAttr=false + return
    | { action: 'keep'; value: string }         // set attrValue + return (final keep)
    | { action: 'continue'; value?: string };   // run next gate; if value present, update working value AND hookEvent.attrValue

const CONTINUE: Verdict = { action: 'continue' };
```

- [ ] **Step 2: Build (type-check only; nothing imports it yet)**

Run: `npm run package`
Expected: `Build completed successfully`.

- [ ] **Step 3: Commit**

```bash
git add src/sanitize/attribute-policy.ts
git commit -m "refactor: add attribute-policy module scaffold (Verdict + AttrContext)"
```

### Task 4: Extract the attribute gates into `attribute-policy.ts`

Move the decision logic of each guard clause from the current `uponSanitizeAttribute` hook body (in `withSanitizerHooks`, `src/sanitize/backend.certified.ts`) into a named pure gate. **The logic moves verbatim** — only the shape changes (read from `ctx`, return a `Verdict` instead of calling `dropAttr`/`hookEvent`). Preserve the exact order; it is security-load-bearing.

**Files:**
- Modify: `src/sanitize/attribute-policy.ts`

Gate mapping (current hook block → exported function, all `(ctx: AttrContext) => Verdict`):

| Current block (by comment) | Function | Verdict semantics |
|---|---|---|
| NFKC normalize URL-bearing attrs | `normalizeUrlAttr` | `continue` with normalized `value` when `isUrlAttr \|\| isSmilValueAttr \|\| isSvgFunciriPresentation`, else `CONTINUE` |
| Hyperlink toggle enforcement | `hyperlinkToggle` | `drop('hyperlinks-disabled')` or `CONTINUE` |
| Per-tag allowlist (HTML) / on*+denylist (SVG) | `tagAllowlist` | `drop('attr-not-allowed')` / `drop('svg-attr-denied')` / `CONTINUE` |
| Per-tag URL scheme enforcement | `urlScheme` | `drop('disallowed-url-scheme')` / `drop('svg-url-scheme-default-deny')` / `CONTINUE` |
| SVG funciri value-scheme enforcement | `svgFunciri` | `drop('svg-funciri-scheme')` / `drop('svg-funciri-unsafe-data')` / `CONTINUE` |
| SMIL attributeName enforcement | `smilAttributeName` | `drop('smil-attributename')` / `CONTINUE` |
| data: URI sanitization | `dataUriAttr` | `drop('data-uri')` / `keep(sanitized)` / `CONTINUE` |
| inline style sanitization | `styleAttr` | `drop('inline-style')` / `keep(normalizedStyle)` / `CONTINUE` |
| xlink:href javascript: defense | `xlinkJavascript` | `drop('xlink-javascript')` / `CONTINUE` |
| scriptingPatterns check | `scriptingPatterns` | `drop('dangerous-pattern')` / `CONTINUE` |

- [ ] **Step 1: Write a characterization test for one representative gate first (TDD)**

Create `test/attribute-policy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { urlScheme, hyperlinkToggle } from '../src/sanitize/attribute-policy';

describe('attribute-policy gates', () => {
    it('hyperlinkToggle drops href on <a> when hyperlinks disabled', () => {
        const v = hyperlinkToggle({
            attrName: 'href', tagName: 'a', value: 'https://x',
            isSvgTag: false, allowHyperlinks: false
        });
        expect(v).toEqual({ action: 'drop', rule: 'hyperlinks-disabled' });
    });

    it('hyperlinkToggle is a no-op when hyperlinks enabled', () => {
        const v = hyperlinkToggle({
            attrName: 'href', tagName: 'a', value: 'https://x',
            isSvgTag: false, allowHyperlinks: true
        });
        expect(v.action).toBe('continue');
    });

    it('urlScheme drops a disallowed scheme on a scheme-restricted tag', () => {
        const v = urlScheme({
            attrName: 'src', tagName: 'img', value: 'http://evil/x',
            isSvgTag: false, allowHyperlinks: false
        });
        expect(v).toEqual({ action: 'drop', rule: 'disallowed-url-scheme' });
    });
});
```

- [ ] **Step 2: Run it — fails (functions not exported yet)**

Run: `npx vitest run test/attribute-policy.test.ts`
Expected: FAIL — `urlScheme is not a function` / import error.

- [ ] **Step 3: Implement all ten gates by moving the existing logic**

Port each block. The two non-trivial reference implementations in full:

```typescript
// normalizeUrlAttr — mirrors the current NFKC block. SMIL/funciri sets reused
// from VisualConstants where the hook used inline literals; keep identical.
const SMIL_VALUE_ATTRS = new Set(['to', 'from', 'values', 'by']);
const SVG_FUNCIRI_ATTRS = new Set([
    'fill', 'stroke', 'cursor', 'mask', 'clip-path', 'filter',
    'marker-start', 'marker-mid', 'marker-end'
]);
const isSmilTag = (t: string) => new Set(['set', 'animate', 'animatemotion',
    'animatetransform', 'animatecolor']).has(t); // reuse SMIL_TAGS source

export const normalizeUrlAttr = (ctx: AttrContext): Verdict => {
    const isUrlAttr = ctx.attrName === 'href' || ctx.attrName === 'src' ||
        ctx.attrName === 'xlink:href';
    const isSmilValueAttr = isSmilTag(ctx.tagName) && SMIL_VALUE_ATTRS.has(ctx.attrName);
    const isSvgFunciri = ctx.isSvgTag && SVG_FUNCIRI_ATTRS.has(ctx.attrName);
    if (isUrlAttr || isSmilValueAttr || isSvgFunciri) {
        const value = ctx.value.normalize('NFKC').replace(/[\x00-\x1F\x7F�]/g, '');
        return { action: 'continue', value };
    }
    return CONTINUE;
};

export const dataUriAttr = (ctx: AttrContext): Verdict => {
    if ((ctx.attrName === 'src' || ctx.attrName === 'href' ||
         ctx.attrName === 'xlink:href') && ctx.value.startsWith('data:')) {
        const sanitized = getSanitizedDataUri(ctx.value);
        if (sanitized === 'data:,' || sanitized === '') {
            return { action: 'drop', rule: 'data-uri' };
        }
        return { action: 'keep', value: sanitized };
    }
    return CONTINUE;
};
```

> The `SMIL_TAGS`, `SVG_TAGS`, `SVG_ATTRIBUTE_DENYLIST`, and `ALLOWED_ATTRIBUTES`
> constants currently live at the top of `backend.certified.ts`. Export them
> from there (or move them into a shared `attribute-policy.ts` and re-import
> into the backend) so both modules use one definition — do not copy them.
> Move the remaining gates (`hyperlinkToggle`, `tagAllowlist`, `urlScheme`,
> `svgFunciri`, `smilAttributeName`, `styleAttr`, `xlinkJavascript`,
> `scriptingPatterns`) by lifting their exact current bodies and returning the
> Verdict listed in the table. `styleAttr` returns `keep` with the same
> `split(';').map(...).join(';')` normalization the hook does today.

- [ ] **Step 4: Run the gate tests — pass**

Run: `npx vitest run test/attribute-policy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sanitize/attribute-policy.ts test/attribute-policy.test.ts src/sanitize/backend.certified.ts
git commit -m "refactor: extract uponSanitizeAttribute gates into attribute-policy"
```

### Task 5: Reduce the hook to a dispatcher

**Files:**
- Modify: `src/sanitize/backend.certified.ts` (the `uponSanitizeAttribute` hook body)

- [ ] **Step 1: Replace the hook body with the gate loop**

```typescript
const GATES = [
    normalizeUrlAttr, hyperlinkToggle, tagAllowlist, urlScheme, svgFunciri,
    smilAttributeName, dataUriAttr, styleAttr, xlinkJavascript, scriptingPatterns
];

purify.addHook('uponSanitizeAttribute', (currentNode: Element, hookEvent: UponSanitizeAttributeHookEvent) => {
    try {
        const ctx: AttrContext = {
            attrName: hookEvent.attrName.toLowerCase(),
            tagName: currentNode.tagName ? currentNode.tagName.toLowerCase() : '',
            value: hookEvent.attrValue,
            isSvgTag: SVG_TAGS.has(currentNode.tagName ? currentNode.tagName.toLowerCase() : ''),
            allowHyperlinks
        };
        const snip = (v: string) => (v.length > 80 ? v.slice(0, 80) + '…' : v);
        for (const gate of GATES) {
            const verdict = gate(ctx);
            if (verdict.action === 'continue') {
                if (verdict.value !== undefined) {
                    ctx.value = verdict.value;
                    hookEvent.attrValue = verdict.value; // preserve mid-hook write-back (NFKC)
                }
                continue;
            }
            if (verdict.action === 'drop') {
                recordRemoval({ kind: 'attr', subject: `${ctx.attrName} on <${ctx.tagName}>`, rule: verdict.rule, snippet: snip(ctx.value) });
                hookEvent.keepAttr = false;
                return;
            }
            // verdict.action === 'keep'
            hookEvent.attrValue = verdict.value;
            return;
        }
        // All gates passed: force-keep so DOMPurify's built-in allowlist doesn't drop legit SVG attrs.
        if (ctx.isSvgTag) {
            hookEvent.forceKeepAttr = true;
        }
    } catch (err) {
        recordRemoval({ kind: 'attr', subject: 'attribute', rule: 'hook-error', snippet: String(err).slice(0, 80) });
        hookEvent.keepAttr = false;
        console.warn('uponSanitizeAttribute hook error, dropping attribute:', err);
    }
});
```

- [ ] **Step 2: Full suite + docs:check + build (behavior unchanged)**

Run: `npm test` → `977 passed`
Run: `npm run docs:check` → in sync (no regeneration needed)
Run: `npm run package` → `Build completed successfully`

- [ ] **Step 3: CodeScene — confirm the cc=62 flag is gone**

Run: score `src/sanitize/backend.certified.ts`.
Expected: health materially up from 5.7 (target ≥ 8); `uponSanitizeAttribute` no longer flagged Complex/Large Method.

- [ ] **Step 4: Integration smoke (real-browser, the attribute hook is the core path)**

Run: `npm run test:integration` → `147 passed`

- [ ] **Step 5: Commit**

```bash
git add src/sanitize/backend.certified.ts
git commit -m "refactor: reduce uponSanitizeAttribute hook to a gate dispatcher"
```

### Task 6: Extract the remaining backend.certified.ts hotspots

**Files:**
- Modify: `src/sanitize/backend.certified.ts`

- [ ] **Step 1: Simplify `recordCoreRemovals` (cc=14)**

Extract the per-`removed`-entry mapping into a helper `mapRemovedEntry(r): RemovalRecord | null` and have `recordCoreRemovals` call `recordRemoval` over the non-null results. Logic identical; just splits the element-vs-attribute branch out of the loop.

- [ ] **Step 2: Simplify `getSanitizedDataUri` (cc=9) and the element hooks (cc≈9–10)**

In `getSanitizedDataUri`, extract the MIME/scheme decision into a small named predicate. In the two element hooks, lift the `<style>` re-sanitize and the on*-empty/remove bodies into named helpers (`reSanitizeStyleContent(el)`, `emptyEventHandlerSubtree(el)`, `dropEventHandlerElement(el)`), reusing the existing `eventHandlerAttrName` helper.

- [ ] **Step 3: Verify (behavior unchanged)**

Run: `npm test` → `977 passed`
Run: `npm run docs:check` → in sync
Run: score `src/sanitize/backend.certified.ts` → no remaining Complex Method flags; health ≥ 8.5 target.

- [ ] **Step 4: Commit**

```bash
git add src/sanitize/backend.certified.ts
git commit -m "refactor: extract recordCoreRemovals/getSanitizedDataUri/element-hook helpers"
```

### Task 7: Decompose `sanitizeCss` and `hasDangerousSelector` in `css.ts`

**Files:**
- Modify: `src/sanitize/css.ts`
- Test: `test/sanitize-pipeline.test.ts` (existing css coverage is the regression net)

- [ ] **Step 1: Extract `hasForbiddenControlChar`**

```typescript
// Replaces the inline C0-control loop inside hasDangerousSelector.
function hasForbiddenControlChar(selector: string): boolean {
    for (let i = 0; i < selector.length; i++) {
        const code = selector.charCodeAt(i);
        if (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d) {
            return true;
        }
    }
    return false;
}
```
Then `hasDangerousSelector` becomes: `return /javascript\s*:/i.test(selector) || hasForbiddenControlChar(selector);`

- [ ] **Step 2: Split `sanitizeCss` (cc=15) into orchestrator + phase helpers**

Extract three helpers operating on the parsed `root`: `dropDisallowedAtRules(root)`, `dropDangerousRules(root)` (stylesheet mode only), `dropDangerousDeclarations(root)`; and a `serialize(root, mode)` helper holding the declaration-list-unwrap vs `toString()` branch. `sanitizeCss` becomes: parse (with try/catch) → run the three drops → `serialize` → `finalPassIsClean` gate. No logic change.

- [ ] **Step 3: Verify**

Run: `npm test` → `977 passed`
Run: `npm run docs:check` → in sync
Run: score `src/sanitize/css.ts` → `sanitizeCss`/`hasDangerousSelector` flags cleared; health ≥ 9 target.

- [ ] **Step 4: Commit**

```bash
git add src/sanitize/css.ts
git commit -m "refactor: decompose sanitizeCss and hasDangerousSelector"
```

### Task 8: Flatten `hasDangerousSvgPayload` in `svg-payload-scan.ts`

**Files:**
- Modify: `src/sanitize/svg-payload-scan.ts`
- Test: `test/svg-payload-scan.test.ts` (existing; regression net)

- [ ] **Step 1: Extract the inner-href scan (depth-4 nesting → helper)**

```typescript
// Returns true if any inner-element href/xlink:href is dangerous. Recurses
// into nested data:image/svg+xml via the depth-capped caller. Lifts the inner
// for-loop out of hasDangerousSvgPayload, removing two nesting levels.
function hasDangerousInnerHref(decoded: string, depth: number): boolean {
    const hrefMatches = decoded.match(/(?:^|[\s"'])(?:xlink:)?href\s*=\s*["']?\s*([^"'\s>]+)/gi);
    if (!hrefMatches) return false;
    for (const raw of hrefMatches) {
        const valueMatch = raw.match(/=\s*["']?\s*([^"'\s>]+)/);
        if (!valueMatch) continue;
        const value = valueMatch[1].trim();
        if (value === '' || value.startsWith('#')) continue;
        if (/^data:image\/svg\+xml/i.test(value)) {
            if (hasDangerousSvgPayload(value, depth + 1)) return true;
            continue;
        }
        if (/^data:image\//i.test(value)) continue;
        return true;
    }
    return false;
}
```
`hasDangerousSvgPayload` keeps the `<script>`/`<foreignObject>`/on*= checks inline and delegates the href block: `if (hasDangerousInnerHref(decoded, depth)) return true;`

- [ ] **Step 2: Extract MIME/encoding parse out of `isSafeImageDataUri` (cc=10)**

Lift the `mime`/`;base64,` parsing into `parseDataUriMime(rawUrl): { mime: string; isBase64: boolean } | null`; `isSafeImageDataUri` consumes it. No logic change.

- [ ] **Step 3: Verify**

Run: `npm test` → `977 passed`
Run: score `src/sanitize/svg-payload-scan.ts` → nesting/Complex flags cleared; health ≥ 9 target.

- [ ] **Step 4: Commit**

```bash
git add src/sanitize/svg-payload-scan.ts
git commit -m "refactor: flatten hasDangerousSvgPayload + extract MIME parse"
```

### Task 9: Split the flagged `visual.ts` methods

**Files:**
- Modify: `src/visual.ts`

- [ ] **Step 1: Extract private methods**

For `openDiagnostics` (cc=17), `update` (cc=12), and `buildRenderSteps` (93 LoC), pull cohesive sub-steps into private methods (e.g. `private buildDiagnosticsModel()`, `private collectConsoleCapture()`, `private resolveUpdateKind(options)`). Move blocks verbatim; the public method orchestrates the new privates.

- [ ] **Step 2: Verify**

Run: `npm test` → `977 passed`
Run: `npm run package` → `Build completed successfully`
Run: score `src/visual.ts` → flagged methods cleared; health ≥ 9 target.

- [ ] **Step 3: Commit**

```bash
git add src/visual.ts
git commit -m "refactor: split openDiagnostics/update/buildRenderSteps into private methods"
```

---

## Phase 3 — Pattern-list unification (may widen detection)

### Task 10: Create the canonical `dangerous-patterns.ts`

**Files:**
- Create: `src/sanitize/dangerous-patterns.ts`
- Test: `test/dangerous-patterns.test.ts`

- [ ] **Step 1: Write the failing test for the canonical source + derivations**

```typescript
import { describe, it, expect } from 'vitest';
import {
    DANGEROUS_SCHEMES,
    schemeSubstrings,
    schemeRegexes
} from '../src/sanitize/dangerous-patterns';

describe('dangerous-patterns canonical source', () => {
    it('includes the core scheme set', () => {
        for (const s of ['javascript:', 'vbscript:', 'livescript:', 'mocha:',
            'data:text/html', 'data:text/javascript',
            'data:application/javascript', 'data:application/x-javascript']) {
            expect(DANGEROUS_SCHEMES).toContain(s);
        }
    });
    it('schemeSubstrings includes spaced variants for the substring scan', () => {
        expect(schemeSubstrings()).toContain('javascript :');
    });
    it('schemeRegexes match obfuscated whitespace', () => {
        expect(schemeRegexes().some(r => r.test('java\tscript:'))).toBe(false);
        expect(schemeRegexes().some(r => r.test('javascript :'))).toBe(true);
    });
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `npx vitest run test/dangerous-patterns.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the canonical source + derivation helpers**

```typescript
// src/sanitize/dangerous-patterns.ts
// Single source of truth for dangerous-scheme/scripting knowledge. Each call
// site derives its form from this core, layering context-specific extras
// EXPLICITLY so detection can only widen, never narrow.

export const DANGEROUS_SCHEMES = [
    'javascript:', 'vbscript:', 'livescript:', 'mocha:',
    'data:text/html', 'data:text/javascript',
    'data:application/javascript', 'data:application/x-javascript'
] as const;

// Substring forms for the attribute-value scan: bare, spaced, and the
// existing control-char-obfuscation variants (generated from the core).
export function schemeSubstrings(): string[] {
    const out: string[] = [];
    for (const s of DANGEROUS_SCHEMES) {
        out.push(s);
        const colon = s.indexOf(':');
        if (colon !== -1) out.push(s.slice(0, colon) + ' :'); // spaced
    }
    // Control-char obfuscations of `javascript` (0x00–0x1F between 'javas' and 'cript')
    for (let c = 0; c <= 0x1f; c++) out.push('javas' + String.fromCharCode(c) + 'cript');
    return out;
}

// Regex forms for the CSS scans: whitespace-tolerant around the colon/slash.
export function schemeRegexes(): RegExp[] {
    return DANGEROUS_SCHEMES.map(s => {
        const escaped = s.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&').replace('\\:', '\\s*:');
        return new RegExp(escaped, 'i');
    });
}
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run test/dangerous-patterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sanitize/dangerous-patterns.ts test/dangerous-patterns.test.ts
git commit -m "feat: add canonical dangerous-patterns source of truth"
```

### Task 11: Rewire the three call sites + promote `cssDangerousPatterns`

**Files:**
- Modify: `src/sanitize/attribute-policy.ts` (the `scriptingPatterns` gate), `src/sanitize/css.ts` (`DANGEROUS_SCHEME_PATTERNS`, `DEFENSE_IN_DEPTH_PATTERNS`), `src/visual-constants.ts` (`scriptingPatterns`, `cssDangerousPatterns`)

- [ ] **Step 1: Derive each call site from the canonical source**

- `VisualConstants.scriptingPatterns` → `schemeSubstrings()` (the control-char + spaced variants are now generated, not hand-listed). Keep the export name so existing importers/tests resolve.
- `css.ts` `DANGEROUS_SCHEME_PATTERNS` → `[...schemeRegexes(), /data\s*:\s*image/i]` (the `data:image` extra stays explicit).
- `css.ts` `DEFENSE_IN_DEPTH_PATTERNS` → `[/@import/i, /@font-face/i, /@namespace/i, /expression\s*\(/i, ...schemeRegexes(), /-moz-binding/i, /(^|[;{\s])behavior\s*:/i, /progid\s*:/i]`.
- `VisualConstants.cssDangerousPatterns` → derive from `schemeRegexes()` + the at-rule/expression extras so it equals the live `DEFENSE_IN_DEPTH_PATTERNS` set by construction (promotes the dead constant to a real derivation; its tests become meaningful).

- [ ] **Step 2: Build + full suite + the security suites explicitly**

Run: `npm run package` → `Build completed successfully`
Run: `npm test` → all green (count may rise; no failures)
Run: `npx vitest run test/security-sanitization.test.ts test/security-xss-prevention.test.ts test/visual-constants.test.ts` → PASS

- [ ] **Step 3: Commit**

```bash
git add src/sanitize/attribute-policy.ts src/sanitize/css.ts src/visual-constants.ts
git commit -m "refactor: derive all dangerous-pattern lists from canonical source"
```

### Task 12: Superset-assertion test (no detection regression)

**Files:**
- Create: `test/dangerous-patterns-superset.test.ts`

- [ ] **Step 1: Write the superset guard**

Capture the *original* literal lists as frozen fixtures and assert every original pattern is still caught at its call site after unification. Use the pre-refactor literals (copy them from git history at the spec commit) as `ORIGINAL_SCRIPTING_SUBSTRINGS`, `ORIGINAL_CSS_SCHEME_SOURCES`, `ORIGINAL_DEFENSE_SOURCES`.

```typescript
import { describe, it, expect } from 'vitest';
import { VisualConstants } from '../src/visual-constants';

// Frozen snapshot of the pre-unification lists (verbatim from the spec commit).
const ORIGINAL_SCRIPTING_SUBSTRINGS = [/* …paste the exact pre-refactor array… */];

describe('dangerous-pattern unification — no detection regression', () => {
    it('scriptingPatterns still contains every original substring', () => {
        for (const s of ORIGINAL_SCRIPTING_SUBSTRINGS) {
            expect(VisualConstants.scriptingPatterns).toContain(s);
        }
    });
    // Repeat for the two CSS lists: assert each original regex SOURCE string is
    // present among the derived lists' .map(r => r.source).
});
```

- [ ] **Step 2: Run — passes (proves superset)**

Run: `npx vitest run test/dangerous-patterns-superset.test.ts`
Expected: PASS. If any assertion fails, the unification *narrowed* detection — fix the derivation before continuing.

- [ ] **Step 3: Commit**

```bash
git add test/dangerous-patterns-superset.test.ts
git commit -m "test: assert pattern unification never narrows detection"
```

### Task 13: Final verification + regenerate derived artifacts

**Files:**
- Modify (regenerated): `docs/sanitization-rules.md`, `test-uat/*.csv`

- [ ] **Step 1: Hand-review the corpus diff**

Run: `npm run docs:generate`
Run: `git diff docs/sanitization-rules.md`
Expected: ideally **no diff** (unification is superset-only). Any change MUST be a *stricter* drop — inspect each line; a newly-admitted payload is a stop-and-revert.

- [ ] **Step 2: Regenerate the UAT corpus (per the convention)**

Run: `npm run uat:generate`
Run: `git status --short test-uat/`
Expected: CSVs regenerated; review any diff the same way as Step 1.

- [ ] **Step 3: Full verification matrix**

Run: `npm test` → all green
Run: `npm run docs:check` → in sync
Run: `npm run package` → `Build completed successfully`
Run: `npm run test:integration` → `147 passed`

- [ ] **Step 4: CodeScene final sweep**

Score all four files. Expected: backend.certified.ts ≥ 8, css.ts ≥ 9, svg-payload-scan.ts ≥ 9, visual.ts ≥ 9; duplication/clone flag cleared.

- [ ] **Step 5: Commit**

```bash
git add docs/sanitization-rules.md test-uat/
git commit -m "chore: regenerate sanitization docs + UAT corpus after pattern unification"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** Part 1 (relocation) → Tasks 1–2. Part 2 (extraction: backend/css/svg/visual) → Tasks 3–9. Part 3 (unification + dead-code promotion) → Tasks 10–11; heightened verification → Tasks 12–13. All spec sections mapped.
- **Behavior-preserving gate:** every Phase 1–2 task asserts `docs:check` stays green without regeneration; Phase 3 explicitly regenerates and hand-reviews.
- **Type consistency:** `AttrContext`/`Verdict` defined in Task 3, consumed unchanged in Tasks 4–5; `schemeSubstrings`/`schemeRegexes`/`DANGEROUS_SCHEMES` defined in Task 10, consumed in Tasks 11–12.
- **Known soft spots for the executor:** Task 4 must lift the `SMIL_TAGS`/`SVG_TAGS`/`ALLOWED_ATTRIBUTES` constants from `backend.certified.ts` as a shared export rather than copying them (flagged inline). Task 12's frozen fixtures must be pasted verbatim from the spec-commit version of the files.
```
