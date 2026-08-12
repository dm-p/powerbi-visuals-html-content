# Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions release automation: rolling alpha/beta channel prereleases (two editions, channel-prefixed GUIDs) and draft production releases (three editions, production GUIDs) triggered by tags.

**Architecture:** A shared `resolveEditionConfig()` in `config/editions.mjs` composes base `pbiviz.json` + edition overlay + optional channel overlay (GUID prefix, displayName suffix, channel icon); both `pbiviz.mjs` (package-time config) and `scripts/select-edition.mjs` (generated-file prestep) consume it. A new `.github/workflows/release.yml` holds two tag-gated jobs modeled on Deneb's `ci.yml` prerelease job.

**Tech Stack:** Node 20 / plain `.mjs`, vitest, powerbi-visuals-tools 7 (`pbiviz`), GitHub Actions, `requarks/changelog-action@v1`, `softprops/action-gh-release@v2`, `gh` CLI.

**Spec:** `docs/brainstorms/2026-08-13-release-automation-design.md` (approved). Key decisions: channel builds = `standard` + `certified` editions only; internal 4-part `version` untouched by channels; light gate on prerelease (package + lean check), full suite on production; production release is a draft; remedial 4th-digit tags supersede a same-`x.y.z` draft and fail if it is published.

**Reference facts (verified, do not re-derive):**

- `pbiviz package` output name is `dist/<visual.guid>.<visual.version>.pbiviz` (1.6.0 release asset: `STANDALONEhtmlContent443BE3AD55E043BF878BED274D3A6855.1.6.0.0.pbiviz`).
- `pbiviz.mjs` at repo root is honored by powerbi-visuals-tools ≥6 in preference to `pbiviz.json`; this repo has `powerbi-visuals-tools` `^7.1.0` as a devDependency, so `npx pbiviz package` uses it.
- `scripts/check-no-sanitizer.mjs` reads the webpack drop `.tmp/drop/visual.js` (overwritten by each package run) — run it immediately after packaging the edition it checks.
- Unit tests: `test/**/*.test.ts`, vitest, jsdom. `npm test` has a `pretest` hook that resets the edition to `certified`.
- Edition GUIDs: certified `htmlContent443BE3AD55E043BF878BED274D3A6865` (in `pbiviz.json`), standard `htmlContent443BE3AD55E043BF878BED274D3A6855`, standalone `STANDALONEhtmlContent443BE3AD55E043BF878BED274D3A6855`.
- Channel icons already exist (untracked): `assets/palette_icon_standard_alpha.png`, `assets/palette_icon_standard_beta.png`, `assets/palette_icon_secure_alpha.png`, `assets/palette_icon_secure_beta.png`.
- Working tree carries unrelated uncommitted changes (`AGENTS.md`, `test-uat/.../expressions.tmdl`, `.claude/`). **Never `git add -A`** — stage only the files each task names. The `expressions.tmdl` change must stay out of commits.

---

## File Structure

- `config/editions.mjs` — gains `resolveEditionConfig(base, editionKey, channel)`, the single place edition + channel identity is composed. (Modify)
- `pbiviz.mjs` — becomes a thin consumer of the resolver; reads optional `channel` from `config/active-edition.mjs`. (Modify)
- `scripts/select-edition.mjs` — accepts optional channel arg, writes `channel` into `config/active-edition.mjs`, uses the resolver. (Modify)
- `test/channel-overlay.test.ts` — unit tests for the resolver. (Create)
- `.github/workflows/release.yml` — `prerelease` + `release` jobs. (Create)
- `assets/palette_icon_{standard,secure}_{alpha,beta}.png` — committed in Task 1. (Add, already on disk)
- `AGENTS.md` — command-table rows for channel builds. (Modify — file has unrelated uncommitted edits; stage carefully, see Task 5)

---

### Task 1: Channel overlay resolver (TDD)

**Files:**
- Test: `test/channel-overlay.test.ts` (create)
- Modify: `config/editions.mjs` (currently 39 lines: only the `editions` export)
- Add: the four `assets/palette_icon_*_{alpha,beta}.png` files (already on disk, untracked)

- [ ] **Step 1: Write the failing test**

Create `test/channel-overlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolveEditionConfig } from '../config/editions.mjs';
import base from '../pbiviz.json';

describe('resolveEditionConfig', () => {
    it('composes an edition with no channel exactly as before', () => {
        const r = resolveEditionConfig(base, 'standard');
        expect(r.visual.guid).toBe(
            'htmlContent443BE3AD55E043BF878BED274D3A6855'
        );
        expect(r.visual.displayName).toBe('HTML Content');
        expect(r.assets.icon).toBe('assets/palette_icon_standard.png');
        expect(r.capabilities).toBe('capabilities.webaccess.json');
        expect(r.sanitize).toBe(false);
        expect(r.edition).toBe('flagship');
    });

    it('certified with no channel is the pbiviz.json base', () => {
        const r = resolveEditionConfig(base, 'certified');
        expect(r.visual).toEqual(base.visual);
        expect(r.assets).toEqual(base.assets);
        expect(r.capabilities).toBe('capabilities.json');
        expect(r.sanitize).toBe(true);
        expect(r.edition).toBe('secure');
    });

    it('applies the beta channel overlay to standard', () => {
        const r = resolveEditionConfig(base, 'standard', 'beta');
        expect(r.visual.guid).toBe(
            'BETAhtmlContent443BE3AD55E043BF878BED274D3A6855'
        );
        expect(r.visual.displayName).toBe('HTML Content (Beta)');
        expect(r.assets.icon).toBe('assets/palette_icon_standard_beta.png');
        // channel never touches the internal version
        expect(r.visual.version).toBe(base.visual.version);
    });

    it('applies the alpha channel overlay to certified', () => {
        const r = resolveEditionConfig(base, 'certified', 'alpha');
        expect(r.visual.guid).toBe(
            'ALPHAhtmlContent443BE3AD55E043BF878BED274D3A6865'
        );
        expect(r.visual.displayName).toBe('HTML Content Secure (Alpha)');
        expect(r.assets.icon).toBe('assets/palette_icon_secure_alpha.png');
        expect(r.capabilities).toBe('capabilities.json');
    });

    it('every channel icon it can emit exists on disk', () => {
        for (const edition of ['standard', 'certified']) {
            for (const channel of ['alpha', 'beta']) {
                const r = resolveEditionConfig(base, edition, channel);
                expect(existsSync(r.assets.icon), r.assets.icon).toBe(true);
            }
        }
    });

    it('rejects channel builds for standalone', () => {
        expect(() => resolveEditionConfig(base, 'standalone', 'beta')).toThrow(
            /does not support/
        );
    });

    it('rejects unknown channels and editions', () => {
        expect(() => resolveEditionConfig(base, 'standard', 'canary')).toThrow(
            /Unknown channel/
        );
        expect(() => resolveEditionConfig(base, 'nope')).toThrow(
            /Unknown edition/
        );
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/channel-overlay.test.ts`
Expected: FAIL — `resolveEditionConfig` is not exported by `../config/editions.mjs`.

- [ ] **Step 3: Implement the resolver**

Append to `config/editions.mjs` (below the existing `editions` export):

```js
const CHANNELS = ['alpha', 'beta'];
// Channel builds exist for the two published editions only; standalone is
// already an independent side-load artifact.
const CHANNEL_ICONS = {
    standard: (c) => `assets/palette_icon_standard_${c}.png`,
    certified: (c) => `assets/palette_icon_secure_${c}.png`
};

// Single source of truth for composing base pbiviz.json + edition overlay +
// optional prerelease channel overlay (GUID prefix, displayName suffix,
// channel icon). Consumed by pbiviz.mjs (package-time config) and
// scripts/select-edition.mjs (generated-file prestep). The internal 4-part
// `version` is deliberately never modified by the channel overlay.
export function resolveEditionConfig(base, editionKey = 'certified', channel) {
    const e = editions[editionKey];
    if (!e) {
        throw new Error(`Unknown edition: ${editionKey}`);
    }
    const visual = { ...base.visual, ...e.visual };
    const assets = { ...base.assets, ...e.assets };
    const capabilities = e.capabilities ?? base.capabilities;
    if (channel !== undefined) {
        if (!CHANNELS.includes(channel)) {
            throw new Error(`Unknown channel: ${channel}`);
        }
        const icon = CHANNEL_ICONS[editionKey];
        if (!icon) {
            throw new Error(
                `Edition '${editionKey}' does not support channel builds`
            );
        }
        visual.guid = `${channel.toUpperCase()}${visual.guid}`;
        visual.displayName = `${visual.displayName} (${
            channel[0].toUpperCase() + channel.slice(1)
        })`;
        assets.icon = icon(channel);
    }
    return { visual, assets, capabilities, sanitize: e.sanitize, edition: e.edition };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/channel-overlay.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint, then commit (icons ride along — the icon-existence test needs them)**

```bash
npm run eslint
git add test/channel-overlay.test.ts config/editions.mjs assets/palette_icon_standard_alpha.png assets/palette_icon_standard_beta.png assets/palette_icon_secure_alpha.png assets/palette_icon_secure_beta.png
git commit -m "feat: add channel overlay resolver and channel icons"
```

---

### Task 2: Wire the channel through select-edition.mjs and pbiviz.mjs

**Files:**
- Modify: `scripts/select-edition.mjs` (67 lines)
- Modify: `pbiviz.mjs` (27 lines)

- [ ] **Step 1: Rewrite `scripts/select-edition.mjs` to accept an optional channel**

Replace the full file content with:

```js
// Prestep run before `pbiviz package`/`start`/`test`. Writes the two git-ignored
// edition artifacts: the sanitizer backend selector and the active-edition
// handoff that pbiviz.mjs reads. Capabilities are committed files (capabilities.json
// / capabilities.webaccess.json); pbiviz.mjs selects the path, so nothing is
// generated for them here.
//
// Usage: node scripts/select-edition.mjs <edition> [channel]
//   edition: certified | standard | standalone   (default: certified)
//   channel: alpha | beta                        (optional; prerelease builds
//            get a channel-prefixed GUID, a displayName suffix and a channel
//            icon — see resolveEditionConfig in config/editions.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveEditionConfig } from '../config/editions.mjs';

const edition = process.argv[2] ?? 'certified';
const channel = process.argv[3];

const base = JSON.parse(
    readFileSync(new URL('../pbiviz.json', import.meta.url), 'utf8')
);
let resolved;
try {
    resolved = resolveEditionConfig(base, edition, channel);
} catch (err) {
    console.error(err.message);
    process.exit(1);
}

const backend = resolved.sanitize ? 'backend.certified' : 'backend.passthrough';
writeFileSync(
    new URL('../src/sanitize/backend.ts', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `export * from './${backend}';\n`
);

writeFileSync(
    new URL('../config/active-edition.mjs', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `export default '${edition}';\n` +
        `export const channel = ${channel ? `'${channel}'` : 'undefined'};\n`
);

writeFileSync(
    new URL('../src/visual-config.generated.ts', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `export type Edition = 'flagship' | 'secure' | 'standalone';\n` +
        `export const EDITION: Edition = '${resolved.edition}';\n` +
        `export const RESOLVED_VISUAL = ${JSON.stringify(
            resolved.visual,
            null,
            4
        )} as const;\n`
);

const MARK_FILE = {
    flagship: 'shield.svg',
    secure: 'shield-secure.svg',
    standalone: 'shield-standalone.svg'
};
const markFile = MARK_FILE[resolved.edition];
if (!markFile) {
    console.error(
        `No mark asset defined for edition '${resolved.edition}' (edition key: ${edition})`
    );
    process.exit(1);
}
writeFileSync(
    new URL('../src/landing/mark.generated.ts', import.meta.url),
    `// GENERATED by scripts/select-edition.mjs — do not edit.\n` +
        `import mark from '../../assets/${markFile}';\n` +
        `export const MARK_URL: string = mark;\n`
);

console.log(
    `Selected edition: ${edition}${channel ? ` (${channel} channel)` : ''} (sanitize=${resolved.sanitize}, backend=${backend})`
);
```

Behavioural notes (all preserved from the current file): unknown edition still exits 1; no-channel invocations produce byte-identical `backend.ts` / `mark.generated.ts` and the same `RESOLVED_VISUAL`; `active-edition.mjs` gains a `channel` named export (`undefined` when not a channel build).

- [ ] **Step 2: Rewrite `pbiviz.mjs` to consume the resolver**

Replace the full file content with:

```js
// Honored by powerbi-visuals-tools (>=6.0.0): a `.mjs` config is dynamically
// imported in preference to the `.json`. This computes the per-edition (and
// per-channel, for alpha/beta prerelease builds) pbiviz config via
// resolveEditionConfig from `config/editions.mjs`, keyed by the active
// edition/channel written by scripts/select-edition.mjs. Defaults to
// `certified` when no edition is selected.
import { readFileSync } from 'node:fs';
import { resolveEditionConfig } from './config/editions.mjs';

const base = JSON.parse(
    readFileSync(new URL('./pbiviz.json', import.meta.url), 'utf8')
);

let edition = 'certified';
let channel;
try {
    const active = await import('./config/active-edition.mjs');
    edition = active.default ?? 'certified';
    channel = active.channel;
} catch {
    /* no active edition selected yet: certified default */
}

const { visual, assets, capabilities } = resolveEditionConfig(
    base,
    edition,
    channel
);

export default { ...base, visual, assets, capabilities };
```

(One behavioural change, deliberate: the old file silently fell back to `certified` on an unknown edition string; the resolver throws. `active-edition.mjs` is generated, so an unknown value means a bug we want loud.)

- [ ] **Step 3: Verify the wiring end-to-end**

```bash
node scripts/select-edition.mjs standard beta
node -e "import('./pbiviz.mjs').then(m => { const v = m.default; console.log(v.visual.guid, '|', v.visual.displayName, '|', v.assets.icon); })"
```

Expected output:

```
BETAhtmlContent443BE3AD55E043BF878BED274D3A6855 | HTML Content (Beta) | assets/palette_icon_standard_beta.png
```

```bash
node scripts/select-edition.mjs standalone beta
```

Expected: exits 1 with `Edition 'standalone' does not support channel builds`.

```bash
node scripts/select-edition.mjs certified
node -e "import('./pbiviz.mjs').then(m => { const v = m.default; console.log(v.visual.guid, '|', v.visual.displayName); })"
```

Expected (back to base, no channel residue):

```
htmlContent443BE3AD55E043BF878BED274D3A6865 | HTML Content Secure
```

- [ ] **Step 4: Run the full unit suite (guards against regressions in generated-file consumers)**

Run: `npm test`
Expected: PASS (pretest resets edition to certified; `edition-config.test.ts` and `capabilities-editions.test.ts` still green).

- [ ] **Step 5: Lint and commit**

```bash
npm run eslint
git add scripts/select-edition.mjs pbiviz.mjs
git commit -m "feat: wire alpha/beta channel through select-edition and pbiviz config"
```

---

### Task 3: Prerelease (channel) workflow job

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml` with the `prerelease` job**

Full file content (the `release` job is appended in Task 4):

```yaml
name: release

# Maintainer runbook — how to cut releases:
#
#   Channel drop (alpha shown; beta is identical):
#       git tag 2.0.0.alpha-1 <commit>
#       git tag -f alpha <commit>
#       git push origin 2.0.0.alpha-1
#       git push -f origin alpha
#   -> the rolling "Alpha Channel" prerelease is replaced with this build.
#
#   Production release:
#       git tag 2.0.0.0 <commit>
#       git push origin 2.0.0.0
#   -> a DRAFT release named "2.0.0" is created for proofing; publish it
#      manually from the Releases page. A remedial build (2.0.0.1) replaces a
#      still-draft "2.0.0" release and fails if "2.0.0" is already published.

# Default the workflow token to read-only; each job elevates to
# contents: write itself (release create/delete).
permissions:
    contents: read

on:
    push:
        tags:
            - 'alpha'
            - 'alpha-*'
            - 'beta'
            - 'beta-*'
            # 4-part production tags (e.g. 2.0.0.0). The glob is looser than
            # the real rule; the release job re-validates with an exact regex.
            - '[0-9]*.[0-9]*.[0-9]*.[0-9]*'

jobs:
    prerelease:
        if: startsWith(github.ref, 'refs/tags/alpha') || startsWith(github.ref, 'refs/tags/beta')
        runs-on: ubuntu-latest
        permissions:
            contents: write
        steps:
            - uses: actions/checkout@v4
              with:
                  fetch-depth: 0
            # Derive the release channel from the moving tag name
            # ('alpha'/'beta', including 'alpha-*'/'beta-*' variants). Every
            # later step keys off these outputs, so alpha and beta cannot
            # drift apart. $GITHUB_REF_NAME (env var, quoted) rather than
            # ${{ github.ref_name }}: expression interpolation would paste the
            # raw tag name into the script as shell source.
            - name: Resolve release channel
              id: channel
              run: |
                  CHANNEL="${GITHUB_REF_NAME%%-*}"
                  case "$CHANNEL" in
                      alpha|beta) ;;
                      *)
                          echo "::error::Unsupported prerelease channel '$CHANNEL' (from tag '$GITHUB_REF_NAME')."
                          exit 1
                          ;;
                  esac
                  echo "name=$CHANNEL" >> $GITHUB_OUTPUT
                  echo "prefix=$(echo "$CHANNEL" | tr '[:lower:]' '[:upper:]')" >> $GITHUB_OUTPUT
                  echo "title=${CHANNEL^}" >> $GITHUB_OUTPUT
                  echo "Channel: $CHANNEL"
            # The moving channel tag must be accompanied by a versioned
            # channel tag (e.g. `2.0.0.beta-1`) on the same commit — it names
            # the published .pbiviz files and the release title. Fail fast
            # (before install/build) if it is missing.
            - name: Resolve versioned channel tag
              id: version_tag
              run: |
                  VERSION_TAG=$(git tag --points-at HEAD | grep -E "^[0-9]+\.[0-9]+\.[0-9]+\.${{ steps.channel.outputs.name }}-[0-9]+$" | sort -V | tail -n 1 || true)
                  if [ -z "$VERSION_TAG" ]; then
                      echo "::error::No versioned ${{ steps.channel.outputs.name }} tag (e.g. 2.0.0.${{ steps.channel.outputs.name }}-1) found on this commit. Tag the commit with '<major>.<minor>.<patch>.${{ steps.channel.outputs.name }}-<n>' and re-push the '${{ steps.channel.outputs.name }}' tag to release."
                      exit 1
                  fi
                  echo "tag=$VERSION_TAG" >> $GITHUB_OUTPUT
                  echo "Versioned channel tag: $VERSION_TAG"
            - uses: actions/setup-node@v4
              with:
                  node-version: '20'
                  cache: 'npm'
            # The internal 4-part version is left as committed for channel
            # builds, so every drop of a version reports the same number
            # inside Power BI — the release notes tell testers to quote the
            # package filename instead.
            - name: Resolve internal visual version
              id: internal
              run: echo "version=$(node -p "JSON.parse(require('fs').readFileSync('pbiviz.json','utf8')).visual.version")" >> $GITHUB_OUTPUT
            - run: npm ci
            # Channel packages: regular (standard) + secure (certified), each
            # with the channel overlay (prefixed GUID, suffixed displayName,
            # channel icon). dist/ is cleared before each package so the mv
            # glob below can only ever match the single fresh artifact (mv
            # fails the job on zero or multiple matches).
            - name: Package regular edition (channel build)
              run: |
                  rm -rf dist
                  node scripts/select-edition.mjs standard ${{ steps.channel.outputs.name }}
                  npx pbiviz package
                  node scripts/check-no-sanitizer.mjs
                  mkdir -p release-artifacts
                  mv dist/*.pbiviz "release-artifacts/HTML-Content.${{ steps.version_tag.outputs.tag }}.pbiviz"
            - name: Package secure edition (channel build)
              run: |
                  rm -rf dist
                  node scripts/select-edition.mjs certified ${{ steps.channel.outputs.name }}
                  npx pbiviz package
                  mv dist/*.pbiviz "release-artifacts/HTML-Content-Secure.${{ steps.version_tag.outputs.tag }}.pbiviz"
            - name: Delete existing channel release
              run: gh release delete "$GITHUB_REF_NAME" --yes || true
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            - name: Fetch all tags
              run: git fetch --tags --force
            # Only pure 4-part numeric tags (e.g. 1.6.2.0) are production
            # releases. Positively match that shape so channel tags can never
            # become the changelog baseline — drift is always measured from
            # the last shipped production release.
            - name: Get last release tag
              id: last_tag
              run: |
                  LAST_TAG=$(git tag -l '[0-9]*' --sort=-v:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)
                  echo "tag=$LAST_TAG" >> $GITHUB_OUTPUT
                  echo "Last versioned tag: $LAST_TAG"
            - name: Generate changelog
              id: changelog
              uses: requarks/changelog-action@v1
              with:
                  token: ${{ secrets.GITHUB_TOKEN }}
                  fromTag: ${{ github.ref_name }}
                  toTag: ${{ steps.last_tag.outputs.tag }}
                  excludeTypes: ''
                  writeToFile: false
            - name: Create channel pre-release
              uses: softprops/action-gh-release@v2
              with:
                  tag_name: ${{ github.ref_name }}
                  name: '${{ steps.channel.outputs.title }} Channel: Latest Build (${{ steps.version_tag.outputs.tag }})'
                  prerelease: true
                  body: |
                      HTML Content ${{ steps.channel.outputs.title }} Channel build — the latest early-access build for testing and feedback.

                      Two packages are attached, one per edition:

                      | Package | Edition | What it does |
                      | --- | --- | --- |
                      | `HTML-Content.${{ steps.version_tag.outputs.tag }}.pbiviz` | **HTML Content** | Full HTML rendering, including external content where your tenant allows it. |
                      | `HTML-Content-Secure.${{ steps.version_tag.outputs.tag }}.pbiviz` | **HTML Content Secure** | Sanitizes markup and blocks external communication, matching the behavior of the certified AppSource visual. |

                      Both packages use channel-specific visual IDs (prefixed `${{ steps.channel.outputs.prefix }}`), so they can be side-loaded into reports alongside the AppSource or production visuals without interfering with them, and they will not auto-update.

                      > **Note on the Secure edition:** this build is **not** tied to AppSource and carries **none of the certification benefits** of the published certified visual. It is provided so you can verify that sanitization and external-communication blocking work as expected against your own content before the certified release catches up.

                      **These builds are not supported for production use** and are intended for testing and feedback only.

                      When reporting issues, please quote the full package filename (e.g. `HTML-Content.${{ steps.version_tag.outputs.tag }}.pbiviz`) — the version shown inside Power BI reads `${{ steps.internal.outputs.version }}` for all channel builds and does not identify the drop on its own.

                      ---

                      ## Changes since ${{ steps.last_tag.outputs.tag }}

                      ${{ steps.changelog.outputs.changes }}
                  files: |
                      release-artifacts/*.pbiviz
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Verify the YAML parses**

Run: `npx --yes js-yaml .github/workflows/release.yml > /dev/null && echo YAML-OK`
Expected: `YAML-OK` (js-yaml exits non-zero on a parse error).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add alpha/beta channel prerelease workflow"
```

---

### Task 4: Production release workflow job

**Files:**
- Modify: `.github/workflows/release.yml` (append the `release` job under `jobs:`)

- [ ] **Step 1: Append the `release` job**

Add under `jobs:` (sibling of `prerelease`, same indentation):

```yaml
    release:
        if: ${{ !startsWith(github.ref, 'refs/tags/alpha') && !startsWith(github.ref, 'refs/tags/beta') }}
        runs-on: ubuntu-latest
        permissions:
            contents: write
        steps:
            - uses: actions/checkout@v4
              with:
                  fetch-depth: 0
            # The on.push tag glob is looser than the real rule, so validate
            # the exact 4-part shape here, and require the tag to equal
            # pbiviz.json's visual.version (fail fast on drift). The release
            # is named with the 3-part semantic version (tag minus the 4th
            # part). $GITHUB_REF_NAME env-var form: see prerelease job note.
            - name: Validate production tag
              id: version
              run: |
                  if ! echo "$GITHUB_REF_NAME" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
                      echo "::error::Tag '$GITHUB_REF_NAME' is not a 4-part production version tag (e.g. 2.0.0.0)."
                      exit 1
                  fi
                  PBIVIZ_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('pbiviz.json','utf8')).visual.version")
                  if [ "$GITHUB_REF_NAME" != "$PBIVIZ_VERSION" ]; then
                      echo "::error::Tag '$GITHUB_REF_NAME' does not match pbiviz.json visual.version '$PBIVIZ_VERSION'. Update pbiviz.json (or retag) so they agree."
                      exit 1
                  fi
                  echo "tag=$GITHUB_REF_NAME" >> $GITHUB_OUTPUT
                  echo "semver=${GITHUB_REF_NAME%.*}" >> $GITHUB_OUTPUT
            - uses: actions/setup-node@v4
              with:
                  node-version: '20'
                  cache: 'npm'
            - run: npm ci
            # Full quality gate — a production release never ships untested.
            # Mirrors .github/workflows/test.yml.
            - name: Cache Playwright browsers
              uses: actions/cache@v4
              with:
                  path: ~/.cache/ms-playwright
                  key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
            - run: npx playwright install --with-deps chromium
            - name: Lint
              run: npm run eslint
            - name: Unit tests
              run: npm run test
            - name: Docs drift check
              run: npm run docs:check
            - name: Integration tests
              run: npm run test:integration
            # Production packages: all three editions with their committed
            # (production) GUIDs — no channel overlay. dist/ is cleared before
            # each package so the mv glob can only match the single fresh
            # artifact (mv fails the job on zero or multiple matches). The
            # non-secure editions are checked for sanitizer leakage
            # immediately after packaging (the check reads the webpack drop,
            # which the next package run overwrites).
            - name: Package regular edition
              run: |
                  rm -rf dist
                  node scripts/select-edition.mjs standard
                  npx pbiviz package
                  node scripts/check-no-sanitizer.mjs
                  mkdir -p release-artifacts
                  mv dist/*.pbiviz "release-artifacts/HTML-Content.${{ steps.version.outputs.semver }}.pbiviz"
            - name: Package secure edition
              run: |
                  rm -rf dist
                  node scripts/select-edition.mjs certified
                  npx pbiviz package
                  mv dist/*.pbiviz "release-artifacts/HTML-Content-Secure.${{ steps.version.outputs.semver }}.pbiviz"
            - name: Package standalone edition
              run: |
                  rm -rf dist
                  node scripts/select-edition.mjs standalone
                  npx pbiviz package
                  node scripts/check-no-sanitizer.mjs
                  mv dist/*.pbiviz "release-artifacts/HTML-Content-Standalone.${{ steps.version.outputs.semver }}.pbiviz"
            # Remedial-build supersede rule: the release identity is x.y.z; a
            # 4-part tag is one build of it. If a release with this x.y.z name
            # already exists: replace it when it is still a draft; fail when
            # it is published (never silently delete a live release — delete
            # or un-publish manually to supersede). Deleting by release id via
            # the API (not `gh release delete <tag>`) so drafts are handled
            # reliably. Superseded 4-part tags stay in git history.
            - name: Supersede in-flight draft release
              run: |
                  MATCH=$(gh api "repos/$GITHUB_REPOSITORY/releases?per_page=100" | jq -c --arg n "${{ steps.version.outputs.semver }}" '[.[] | select(.name == $n)]')
                  COUNT=$(echo "$MATCH" | jq 'length')
                  if [ "$COUNT" = "0" ]; then
                      echo "No existing release named '${{ steps.version.outputs.semver }}'."
                      exit 0
                  fi
                  PUBLISHED=$(echo "$MATCH" | jq '[.[] | select(.draft | not)] | length')
                  if [ "$PUBLISHED" != "0" ]; then
                      echo "::error::A published release named '${{ steps.version.outputs.semver }}' already exists. Delete or un-publish it manually if this remedial build ('$GITHUB_REF_NAME') should supersede it, then re-run this workflow."
                      exit 1
                  fi
                  echo "$MATCH" | jq -r '.[].id' | while read -r id; do
                      echo "Deleting draft release id $id"
                      gh api -X DELETE "repos/$GITHUB_REPOSITORY/releases/$id"
                  done
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            - name: Fetch all tags
              run: git fetch --tags --force
            # Changelog baseline: the newest 4-part production tag whose x.y.z
            # differs from the current tag's — so a remedial 2.0.0.1 still
            # diffs against the previous release (e.g. 1.6.2.0), not 2.0.0.0.
            - name: Get changelog baseline tag
              id: last_tag
              run: |
                  LAST_TAG=$(git tag -l '[0-9]*' --sort=-v:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | awk -F. -v s="${{ steps.version.outputs.semver }}" '$1"."$2"."$3 != s' | head -n 1)
                  if [ -z "$LAST_TAG" ]; then
                      echo "::error::No prior production tag found to use as the changelog baseline."
                      exit 1
                  fi
                  echo "tag=$LAST_TAG" >> $GITHUB_OUTPUT
                  echo "Changelog baseline: $LAST_TAG"
            - name: Generate changelog
              id: changelog
              uses: requarks/changelog-action@v1
              with:
                  token: ${{ secrets.GITHUB_TOKEN }}
                  fromTag: ${{ github.ref_name }}
                  toTag: ${{ steps.last_tag.outputs.tag }}
                  excludeTypes: ''
                  writeToFile: false
            - name: Create draft production release
              uses: softprops/action-gh-release@v2
              with:
                  tag_name: ${{ github.ref_name }}
                  name: ${{ steps.version.outputs.semver }}
                  draft: true
                  body: |
                      Details for this release are available [in the changelog](https://html-content.com/docs/change-log) on the documentation site.

                      Three packages are attached, one per edition:

                      | Package | Edition | Distribution |
                      | --- | --- | --- |
                      | `HTML-Content.${{ steps.version.outputs.semver }}.pbiviz` | **HTML Content** | AppSource (production visual ID) |
                      | `HTML-Content-Secure.${{ steps.version.outputs.semver }}.pbiviz` | **HTML Content Secure** | AppSource, certified (production visual ID) |
                      | `HTML-Content-Standalone.${{ steps.version.outputs.semver }}.pbiviz` | **HTML Content — Standalone** | Side-load only (independent visual ID) |

                      > **Note:** the regular and Secure packages use the **production AppSource visual IDs**. To use them directly you will need to deploy them as [organizational visuals](https://learn.microsoft.com/power-bi/developer/visuals/power-bi-custom-visuals-organization) — otherwise, simply wait for AppSource publication to catch up with this release. The Standalone package has its own visual ID and can be side-loaded into any report, but is independent of AppSource and will not auto-update.

                      ---

                      ## Changes since ${{ steps.last_tag.outputs.tag }}

                      ${{ steps.changelog.outputs.changes }}
                  files: |
                      release-artifacts/*.pbiviz
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Verify the YAML parses**

Run: `npx --yes js-yaml .github/workflows/release.yml > /dev/null && echo YAML-OK`
Expected: `YAML-OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add draft production release workflow job"
```

---

### Task 5: Document channel builds in AGENTS.md

**Files:**
- Modify: `AGENTS.md` — the `## Commands` table

**CAUTION:** `AGENTS.md` has unrelated uncommitted local edits. Stage with `git add -p AGENTS.md` (or `git add AGENTS.md` only if `git diff AGENTS.md` shows nothing but this task's rows) so only the rows below are committed. If unrelated hunks appear during `git add -p`, leave them unstaged.

- [ ] **Step 1: Add command rows**

In the `## Commands` table in `AGENTS.md`, after the "Package the visual (`.pbiviz`)" row, add:

```markdown
| Package an alpha/beta channel build (e.g. beta of the regular edition; reproduces a CI channel artifact locally) | `node scripts/select-edition.mjs standard beta && npx pbiviz package` |
| Reset to the default edition after a channel build | `node scripts/select-edition.mjs certified` |
```

- [ ] **Step 2: Verify and commit**

```bash
git diff AGENTS.md   # confirm which hunks are this task's vs pre-existing
git add -p AGENTS.md # stage ONLY the command-table rows added above
git commit -m "docs: document channel build commands"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full local check**

```bash
npm run eslint
npm test
node scripts/select-edition.mjs certified
```

Expected: eslint clean; all unit tests pass (including `channel-overlay.test.ts`); working tree back on the certified edition.

- [ ] **Step 2: Confirm nothing unintended is staged/committed**

```bash
git status --short
git log --oneline origin/main..HEAD
```

Expected: `AGENTS.md` (any unrelated hunks), `test-uat/.../expressions.tmdl`, and `.claude/` remain uncommitted; the branch has the Task 1–5 commits plus the two docs commits (brainstorm + this plan).

- [ ] **Step 3: Live-fire the prerelease workflow (with the user's go-ahead)**

This is the only way to exercise the workflow itself. After the branch is merged to main (or on the user's instruction):

```bash
git tag 2.0.0.alpha-1 <commit>
git tag -f alpha <commit>
git push origin 2.0.0.alpha-1
git push -f origin alpha
```

Expected: an "Alpha Channel: Latest Build (2.0.0.alpha-1)" prerelease appears with `HTML-Content.2.0.0.alpha-1.pbiviz` + `HTML-Content-Secure.2.0.0.alpha-1.pbiviz`, body per the spec copy, changelog diffed from the last 4-part tag. **Do not run this step without explicit user confirmation** — it publishes a public prerelease on the repo.

---

## Self-review notes (already applied)

- Spec coverage: tagging model (Tasks 3–4 triggers/guards), channel overlay (Tasks 1–2), gates (light prerelease / full production), draft + supersede rule (Task 4), changelog baselines incl. same-`x.y.z` exclusion (Task 4 `last_tag` awk), release copy verbatim from spec (Tasks 3–4 bodies), AGENTS.md docs (Task 5), out-of-scope items untouched.
- The `${{ }}` interpolations inside `run:` blocks only use regex/case-validated step outputs (`channel.outputs.name`, `version_tag.outputs.tag`, `version.outputs.semver`) — never the raw ref name, which is read via `$GITHUB_REF_NAME` (Deneb's injection-safety pattern).
- `sort -V` on the versioned-tag lookup and `--sort=-v:refname` on baselines match Deneb's semantics.
