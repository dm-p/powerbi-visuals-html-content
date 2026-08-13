# Channel Build Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Channel (alpha/beta) builds carry a Deneb-style stamped version (`2.0.0.20260813#b044cfdc`) in packaged metadata and on the landing page, plus a localized channel-named `NOT FOR PRODUCTION USE` badge on the landing page.

**Architecture:** `scripts/select-edition.mjs` computes the stamp once (UTC date + git short hash) and flows it through the existing generated handoff (`config/active-edition.mjs`) so `pbiviz.mjs` (packaged metadata → visualizations pane) and `RESOLVED_VISUAL` (landing page) carry the identical value. `resolveEditionConfig` gains a pure optional `versionOverride` parameter applied only in the channel branch. A new generated `CHANNEL` export drives the landing badge, whose text comes from two new `resources.resjson` keys via the existing `ILocalizationManager` pattern.

**Tech Stack:** Node `.mjs` scripts, vitest (+ jsdom for splash tests), powerbi-visuals-tools 7, GitHub Actions.

**Spec:** `docs/brainstorms/2026-08-13-channel-build-identity.md` (approved). Supersedes the previous "internal version untouched" decision for channel builds only.

**Branch:** `feat/channel-build-identity` (already created off merged main). Working tree carries unrelated uncommitted files (`test-uat/.../expressions.tmdl`, `.claude/`) — **never `git add -A`**; stage only named files. Commit-message trailer for every commit:
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

**Reference facts (verified against the working tree, do not re-derive):**

- `resolveEditionConfig(base, editionKey = 'certified', channel)` lives at `config/editions.mjs:59`; the channel branch is gated on `channel !== undefined` and currently never touches `visual.version`.
- `scripts/select-edition.mjs` (81 lines) validates via the resolver, then writes 4 generated files; `config/active-edition.mjs` currently gets `export default '<edition>';` + `export const channel = …;`.
- `pbiviz.mjs` reads `active.default` and `active.channel` and calls the resolver with 3 args.
- Landing: `src/landing/handler.ts:73-101` resolves `Landing_*` strings via `this.localisationManager.getDisplayName(key)` and calls `buildSplash`; `src/landing/splash.ts` `buildHeader` appends the version div at lines 146-148 (`hc-landing-version`).
- Localization DOES exist: `stringResources/en-US/resources.resjson` (single locale) holds all `Landing_*` keys and is packaged by pbiviz.
- Landing styles: `style/visual.less` — `.hc-landing-version` block at lines 500-505 (nested inside the `.hc-landing` block; 4-space indent).
- Workflow: `.github/workflows/release.yml` — `Resolve internal visual version` step at lines 100-102 with its comment at lines 96-99; the release-body line referencing `steps.internal.outputs.version` at line 179. `steps.internal` has no other consumers.
- `scripts/assert-channel-identity.mjs` reads `.tmp/drop/pbiviz.json` and pushes failures into a `problems` array.
- Tests: `test/channel-overlay.test.ts` (resolver, 8 tests) and `test/landing-splash.test.ts` (jsdom splash tests). Suite baseline: 43 files / 1179 tests green.
- If a vitest run ever fails ALL files with `Cannot read properties of undefined (reading 'config')`, re-run once — known transient local glitch.

---

## File Structure

- `config/editions.mjs` — resolver gains optional `versionOverride` (pure). (Modify)
- `scripts/select-edition.mjs` — computes the stamp, passes it to the resolver, writes `versionOverride` into `active-edition.mjs` and `CHANNEL` into `visual-config.generated.ts`. (Modify)
- `pbiviz.mjs` — reads `versionOverride` from the handoff, passes 4th arg. (Modify)
- `stringResources/en-US/resources.resjson` — two badge keys. (Modify)
- `src/landing/splash.ts` — optional `channelBadge` option + badge div. (Modify)
- `src/landing/handler.ts` — resolves the badge string from `CHANNEL`. (Modify)
- `style/visual.less` — `.hc-landing-channel-badge` styles. (Modify)
- `scripts/assert-channel-identity.mjs` — stamp assertion. (Modify)
- `.github/workflows/release.yml` — drop `internal` step, reword body. (Modify)
- Tests: `test/channel-overlay.test.ts`, `test/landing-splash.test.ts`. (Modify)

---

### Task 1: `versionOverride` in the resolver (TDD)

**Files:**
- Test: `test/channel-overlay.test.ts`
- Modify: `config/editions.mjs`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('resolveEditionConfig', …)` block in `test/channel-overlay.test.ts`:

```ts
    it('applies a version override in channel builds', () => {
        const r = resolveEditionConfig(
            base,
            'standard',
            'beta',
            '2.0.0.20260813#b044cfdc'
        );
        expect(r.visual.version).toBe('2.0.0.20260813#b044cfdc');
        // identity overlay is unaffected by the override
        expect(r.visual.guid).toBe(
            'BETAhtmlContent443BE3AD55E043BF878BED274D3A6855'
        );
    });

    it('leaves the version untouched when no override is given', () => {
        const r = resolveEditionConfig(base, 'certified', 'alpha');
        expect(r.visual.version).toBe(base.visual.version);
    });

    it('rejects a version override without a channel', () => {
        expect(() =>
            resolveEditionConfig(
                base,
                'standard',
                undefined,
                '2.0.0.20260813#b044cfdc'
            )
        ).toThrow(/requires a channel/);
    });
```

Also extend the existing `it('never mutates the base config', …)` test so the resolve call covers the new path — change its resolver call to:

```ts
        resolveEditionConfig(base, 'standard', 'beta', '2.0.0.20260813#b044cfdc');
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run test/channel-overlay.test.ts`
Expected: 11 tests, 2 FAIL (`applies a version override…` — version still `2.0.0.0`; `rejects a version override…` — no throw). (`leaves the version untouched…` passes already — it pins existing behavior.)

- [ ] **Step 3: Implement**

In `config/editions.mjs`:

1. Change the signature line (line 59) to:

```js
export function resolveEditionConfig(
    base,
    editionKey = 'certified',
    channel,
    versionOverride
) {
```

2. Immediately after the `Object.hasOwn` guard (after line 62's closing `}`), add:

```js
    if (versionOverride !== undefined && channel === undefined) {
        throw new Error('Version override requires a channel build');
    }
```

3. Inside the `if (channel !== undefined) {` branch, after the `assets.icon = icon(channel);` line, add:

```js
        if (versionOverride !== undefined) {
            visual.version = versionOverride;
        }
```

4. Update the doc comment above the function: replace the sentence
`The internal 4-part `version` is deliberately never modified by the channel overlay.`
with:

```
// The internal 4-part `version` is never modified except by an explicit
// channel-build `versionOverride` (the date#hash stamp computed by
// scripts/select-edition.mjs); production/no-channel builds always keep the
// committed version.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/channel-overlay.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run eslint
git add config/editions.mjs test/channel-overlay.test.ts
git commit -m "feat: support channel version override in edition resolver"
```

---

### Task 2: Stamp computation + generated handoff wiring

**Files:**
- Modify: `scripts/select-edition.mjs`
- Modify: `pbiviz.mjs`

- [ ] **Step 1: Add stamp computation to `scripts/select-edition.mjs`**

1. Change the imports (line 15) to:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveEditionConfig } from '../config/editions.mjs';
```

2. After the `const base = JSON.parse(…)` block (after line 23), add:

```js
// Channel builds stamp the 4th version segment with the build date (UTC) and
// commit, e.g. `2.0.0.20260813#b044cfdc` — computed ONCE here and handed to
// pbiviz.mjs via active-edition.mjs so packaged metadata and the landing page
// can never drift. Format changes must stay in step with the stamp assertion
// in scripts/assert-channel-identity.mjs.
const buildStamp = () => {
    const hash = execSync('git rev-parse --short=8 HEAD', {
        cwd: fileURLToPath(new URL('..', import.meta.url))
    })
        .toString()
        .trim();
    const d = new Date();
    const ymd =
        `${d.getUTCFullYear()}` +
        `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
        `${String(d.getUTCDate()).padStart(2, '0')}`;
    const xyz = base.visual.version.split('.').slice(0, 3).join('.');
    return `${xyz}.${ymd}#${hash}`;
};
const versionOverride = channel ? buildStamp() : undefined;
```

3. Change the resolver call (line 26) to:

```js
    resolved = resolveEditionConfig(base, edition, channel, versionOverride);
```

4. Change the `active-edition.mjs` write (lines 52-57) to:

```js
writeFileSync(
    new URL('../config/active-edition.mjs', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `export default '${edition}';\n` +
        `export const channel = ${channel ? `'${channel}'` : 'undefined'};\n` +
        `export const versionOverride = ${
            versionOverride ? `'${versionOverride}'` : 'undefined'
        };\n`
);
```

5. Change the `visual-config.generated.ts` write (lines 59-69) to add the `CHANNEL` export:

```js
writeFileSync(
    new URL('../src/visual-config.generated.ts', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `export type Edition = 'flagship' | 'secure' | 'standalone';\n` +
        `export const EDITION: Edition = '${resolved.edition}';\n` +
        `export const CHANNEL: 'alpha' | 'beta' | undefined = ${
            channel ? `'${channel}'` : 'undefined'
        };\n` +
        `export const RESOLVED_VISUAL = ${JSON.stringify(
            resolved.visual,
            null,
            4
        )} as const;\n`
);
```

6. Change the final `console.log` (lines 78-80) to surface the stamp:

```js
console.log(
    `Selected edition: ${edition}${channel ? ` (${channel} channel, version ${resolved.visual.version})` : ''} (sanitize=${resolved.sanitize}, backend=${backend})`
);
```

- [ ] **Step 2: Wire `pbiviz.mjs` to read the override**

Change the try-block and resolver call in `pbiviz.mjs` (lines 14-31) to:

```js
let edition = 'certified';
let channel;
let versionOverride;
try {
    const active = await import('./config/active-edition.mjs');
    edition = active.default ?? 'certified';
    channel = active.channel;
    versionOverride = active.versionOverride;
} catch (err) {
    // no active edition selected yet: certified default
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') {
        throw err;
    }
}

const { visual, assets, capabilities } = resolveEditionConfig(
    base,
    edition,
    channel,
    versionOverride
);
```

(Old-format handoff files without the export read back `undefined` — same backward-compat contract as `channel`.)

- [ ] **Step 3: Verify the wiring end-to-end**

```bash
node scripts/select-edition.mjs standard beta
node -e "import('./pbiviz.mjs').then(m => console.log(m.default.visual.version, '|', m.default.visual.guid))"
```

Expected: version matches `^2\.0\.0\.\d{8}#[0-9a-f]{8} \|` followed by the `BETAhtmlContent…6855` guid (date = today UTC, hash = current HEAD short hash — confirm with `git rev-parse --short=8 HEAD`).

```bash
grep versionOverride config/active-edition.mjs
```

Expected: `export const versionOverride = '2.0.0.<today>#<hash>';`

```bash
grep CHANNEL src/visual-config.generated.ts
```

Expected: `export const CHANNEL: 'alpha' | 'beta' | undefined = 'beta';`

```bash
node scripts/select-edition.mjs certified
node -e "import('./pbiviz.mjs').then(m => console.log(m.default.visual.version))"
grep -h "CHANNEL\|versionOverride" src/visual-config.generated.ts config/active-edition.mjs
```

Expected: `2.0.0.0`; both greps show `undefined` values (no channel residue).

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: all pass (pretest resets to certified; `edition-config.test.ts`'s `version === '2.0.0.0'` assertion unaffected).

- [ ] **Step 5: Lint and commit**

```bash
npm run eslint
git add scripts/select-edition.mjs pbiviz.mjs
git commit -m "feat: stamp channel builds with date+commit version"
```

---

### Task 3: Landing badge (TDD)

**Files:**
- Test: `test/landing-splash.test.ts`
- Modify: `stringResources/en-US/resources.resjson`, `src/landing/splash.ts`, `src/landing/handler.ts`, `style/visual.less`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('buildSplash', …)` block in `test/landing-splash.test.ts`:

```ts
    it('renders the channel badge under the version when channelBadge is set', () => {
        const el = buildSplash(doc, {
            edition: 'flagship',
            version: '2.0.0.20260813#b044cfdc',
            markUrl: 'x',
            labels,
            urls,
            channelBadge: 'BETA BUILD — NOT FOR PRODUCTION USE',
            onLaunch: vi.fn()
        });
        const badge = el.querySelector('.hc-landing-channel-badge');
        expect(badge?.textContent).toBe('BETA BUILD — NOT FOR PRODUCTION USE');
        // sits inside the title wrap, directly after the version line
        expect(badge?.previousElementSibling?.className).toBe(
            'hc-landing-version'
        );
    });

    it('renders no channel badge when channelBadge is absent', () => {
        const el = buildSplash(doc, {
            edition: 'secure',
            version: '2.0.0.0',
            markUrl: 'x',
            labels,
            urls,
            onLaunch: vi.fn()
        });
        expect(el.querySelector('.hc-landing-channel-badge')).toBeNull();
    });
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `npx vitest run test/landing-splash.test.ts`
Expected: the badge-present test FAILS (no `.hc-landing-channel-badge` element; also a TS-level unknown-property complaint is fine at this stage); the badge-absent test passes vacuously.

- [ ] **Step 3: Implement the splash change**

In `src/landing/splash.ts`:

1. Add to `SplashOptions` (after `version: string;` at line 28):

```ts
    /** Pre-localized channel warning (e.g. "BETA BUILD — NOT FOR PRODUCTION
     *  USE"); rendered as a badge under the version when present. */
    channelBadge?: string;
```

2. In `buildHeader`, change the destructure (line 128) to:

```ts
    const { edition, version, channelBadge, markUrl, urls, onLaunch } = opts;
```

3. After the version append (lines 146-148), add:

```ts
    if (channelBadge) {
        titleWrap.appendChild(
            node(doc, 'div', 'hc-landing-channel-badge', channelBadge)
        );
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/landing-splash.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the localized strings**

In `stringResources/en-US/resources.resjson`, directly after the `"Landing_OpenDocs"` entry, add (mind JSON commas):

```json
    "Landing_ChannelBadge_Alpha": "ALPHA BUILD — NOT FOR PRODUCTION USE",
    "Landing_ChannelBadge_Beta": "BETA BUILD — NOT FOR PRODUCTION USE",
```

Validate: `node -e "JSON.parse(require('fs').readFileSync('stringResources/en-US/resources.resjson','utf8')); console.log('JSON-OK')"` → `JSON-OK`

- [ ] **Step 6: Wire the handler**

In `src/landing/handler.ts`:

1. Change the generated import (line 13 area — it currently imports only `MARK_URL` from `./mark.generated`) by adding after it:

```ts
import { CHANNEL } from '../visual-config.generated';
```

2. In `render()`, after the `labels` object (line 84), add:

```ts
        // Channel builds (alpha/beta) carry a not-for-production warning
        // badge; production builds pass nothing and render no badge.
        const channelBadge = CHANNEL
            ? get(
                  CHANNEL === 'alpha'
                      ? 'Landing_ChannelBadge_Alpha'
                      : 'Landing_ChannelBadge_Beta'
              )
            : undefined;
```

3. Add `channelBadge,` to the `buildSplash` options object (after `markUrl: MARK_URL,`).

- [ ] **Step 7: Style the badge**

In `style/visual.less`, directly after the `.hc-landing-version` block (line 505's closing `}`), at the same nesting level, add:

```less
    .hc-landing-channel-badge {
        display: inline-block;
        align-self: flex-start;
        margin-top: 4px;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 7pt;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #7c2d12;
        background: #fde68a;
        border: 1px solid #f59e0b;
    }
```

(Fixed amber palette on purpose — a warning must read identically in every
theme; the badge text is already uppercase in the resource string, so no
`text-transform`.)

- [ ] **Step 8: Full verification**

```bash
npm run eslint
npm run prettier-check
npm test
```

Expected: all clean/green (prettier covers `{src,spec,style}` so the splash/handler/less edits are in scope).

- [ ] **Step 9: Commit**

```bash
git add test/landing-splash.test.ts src/landing/splash.ts src/landing/handler.ts stringResources/en-US/resources.resjson style/visual.less
git commit -m "feat: not-for-production channel badge on the landing page"
```

---

### Task 4: Stamp assertion + workflow release-notes update

**Files:**
- Modify: `scripts/assert-channel-identity.mjs`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Extend `scripts/assert-channel-identity.mjs`**

After the existing displayName check (the `if (!visual.displayName.endsWith(suffix)) { … }` block), add:

```js
const stampTail = visual.version.split('.').slice(3).join('.');
if (!/^\d{8}#[0-9a-f]{7,}$/.test(stampTail)) {
    problems.push(
        `version '${visual.version}' lacks a channel build stamp (expected 4th segment YYYYMMDD#hash)`
    );
}
```

- [ ] **Step 2: Update `.github/workflows/release.yml`**

1. Delete the `Resolve internal visual version` step AND its comment — lines 96-102 (the comment beginning `# The internal 4-part version is left as committed…` through the `run: echo "version=…` line). `steps.internal` has no other consumers (verify: `grep -n "steps.internal" .github/workflows/release.yml` → only line 179 remains, which step 2 rewrites).

2. Replace the body line at (what was) line 179:

```
                      When reporting issues, please quote the full package filename (e.g. `HTML-Content.${{ steps.version_tag.outputs.tag }}.pbiviz`) — the version shown inside Power BI reads `${{ steps.internal.outputs.version }}` for all channel builds and does not identify the drop on its own.
```

with:

```
                      When reporting issues, please quote the full package filename (e.g. `HTML-Content.${{ steps.version_tag.outputs.tag }}.pbiviz`). The in-visual version (shown on the landing page and in the visualizations pane) pins the exact build date and commit (e.g. `2.0.0.20260813#b044cfdc`) — please include that too.
```

- [ ] **Step 3: Verify**

```bash
npx --yes js-yaml .github/workflows/release.yml > /dev/null && echo YAML-OK
grep -c "steps.internal" .github/workflows/release.yml
```

Expected: `YAML-OK`, then `0` (grep exits 1 with count 0 — that is the pass condition).

- [ ] **Step 4: Lint and commit**

```bash
npm run eslint
git add scripts/assert-channel-identity.mjs .github/workflows/release.yml
git commit -m "ci: assert channel version stamp and update prerelease notes"
```

---

### Task 5: Local package verification + UAT handoff

- [ ] **Step 1: Package a beta channel build and assert identity**

```bash
node scripts/select-edition.mjs standard beta
npx pbiviz package
node scripts/assert-channel-identity.mjs BETA
node -p "JSON.parse(require('fs').readFileSync('.tmp/drop/pbiviz.json','utf8')).visual.version"
```

Expected: `pbiviz package` succeeds (this is the first confirmation that pbiviz accepts the `#` version); the assert prints `OK: channel identity BETAhtmlContent… / 'HTML Content (Beta)'`; the version prints `2.0.0.<today-UTC>#<8-char hash>`. Note the produced `dist/*.pbiviz` path for the user.

- [ ] **Step 2: Negative check — production package still clean**

```bash
node scripts/select-edition.mjs certified
npx pbiviz package
node -p "JSON.parse(require('fs').readFileSync('.tmp/drop/pbiviz.json','utf8')).visual.version"
node scripts/check-no-sanitizer.mjs --expect-sanitizer
```

Expected: `2.0.0.0` (stamp confined to channel builds) and the sanitizer/privileges check passes.

- [ ] **Step 3: Final sweep**

```bash
npm run eslint
npm test
git status --short
```

Expected: clean lint; full suite green; residue only `test-uat/.../expressions.tmdl` + `.claude/` (plus `dist/`/`.tmp/` build output, which is gitignored).

- [ ] **Step 4: STOP — hand to the user for Desktop UAT (merge gate)**

Do NOT push or open a PR yet. Report to the user: the beta `.pbiviz` from Step 1 (rebuild it if `dist/` was clobbered by Step 2 — `node scripts/select-edition.mjs standard beta && npx pbiviz package`) must be imported into Power BI Desktop to confirm:
  (a) the visualizations-pane tooltip shows the stamped version;
  (b) the landing page shows the stamped version and the amber `BETA BUILD — NOT FOR PRODUCTION USE` badge.

**Fallback if Desktop rejects the `#` version:** change the stamp format in ONE place — `buildStamp()` in `scripts/select-edition.mjs` — to the digits-only `${xyz}.${ymd}` form, relax the assertion regex in `scripts/assert-channel-identity.mjs` to `^\d{8}(#[0-9a-f]{7,})?$`, and surface the hash on the landing page only (append it to the `version` option in `src/landing/handler.ts`: `` `${VisualConstants.visual.version}#${hash}` `` would require exporting the hash via the generated file — if this path triggers, add `export const BUILD_HASH` to `visual-config.generated.ts` in `select-edition.mjs` and take it from there). This is a contingency, not part of the default implementation.

---

## Self-review notes (already applied)

- Spec coverage: stamping (Tasks 1-2), badge + localization (Task 3), workflow/assert updates (Task 4), local verification + Desktop UAT gate + fallback (Task 5). Out-of-scope items untouched (no production-job changes, no diagnostics-dialog changes).
- Type consistency: `resolveEditionConfig(base, editionKey, channel, versionOverride)` used identically in Tasks 1, 2; `channelBadge?: string` consistent between splash and handler; `CHANNEL: 'alpha' | 'beta' | undefined` consistent between generator and handler import.
- The `em dash` in the resjson strings and test literals is the same character (—) throughout — copy exactly.
