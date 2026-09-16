# Certification-Gated Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split production releases into a tag-triggered certification *submission* (CI gate + three-edition workflow artifact, no release) and a manually dispatched *release* workflow that creates the draft GitHub release for an approved tag.

**Architecture:** `.github/workflows/release.yml` is renamed to `ci.yml` (via `git mv`) and absorbs `test.yml`; its `release` job becomes `submission`. A new `.github/workflows/release.yml` mirrors Deneb's dispatch-only release workflow, adapted to three editions. Every `setup-node` step moves to Node 24. No scripts or config change.

**Tech Stack:** GitHub Actions, Node 24, powerbi-visuals-tools 7 (`pbiviz`), `requarks/changelog-action` (SHA-pinned), `softprops/action-gh-release` (SHA-pinned), `gh` CLI, `actions/upload-artifact@v4`.

**Spec:** `docs/brainstorms/2026-09-16-certification-gated-release-design.md` (approved).

**Reference facts (verified, do not re-derive):**

- Branch `ci/certification-gated-release` already exists off `main` with the spec committed. Work there.
- Working tree carries an unrelated uncommitted change (`test-uat/html-content-uat.SemanticModel/definition/expressions.tmdl`) and an untracked `.claude/` dir. **Never `git add -A`** — stage only the files each task names.
- `powerbi-visuals-tools` 7.2.1 declares `engines.node >=20.19.0`; Node 24 is fine. Local dev is on Node 24.15.
- No YAML parser is installed in the repo. Parse-check with `npx --yes --package=js-yaml@4 js-yaml <file> > /dev/null` (one-off download, adds nothing to the repo).
- The repo's pinned action SHAs (reuse verbatim): `requarks/changelog-action@1fabc7b0c6581d93c398246a856f084fb17cd9eb # v1.9.0` and `softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65 # v2.6.2`.
- `pbiviz package` writes exactly one `dist/*.pbiviz`; the `mv` glob in each package step fails the job on zero or multiple matches. `dist` and `.tmp/drop` are cleared before each package run.
- `scripts/check-no-sanitizer.mjs` reads `.tmp/drop/visual.js`, which the next package run overwrites — run it immediately after packaging the edition it checks.
- `scripts/assert-production-version.mjs <tag>` asserts the packaged `visual.version` equals the tag.
- GitHub's latest published release is `1.6.0.0` (name `1.6.0`), so `releases/latest` resolves for the first 2.0.0 dispatch.
- In `run:` steps, read the tag from `$GITHUB_REF_NAME` / `$RELEASE_TAG` (env), never `${{ github.ref_name }}` / `${{ inputs.tag }}` — expression interpolation pastes the value into the script as shell source. `with:` blocks may use the expression form.
- YAML: an `if:` starting with `!` must be wrapped in `${{ }}` (a bare `!` starts a YAML tag).

---

## File Structure

- `.github/workflows/ci.yml` — **renamed from** `release.yml`. Tag- and branch-triggered work: `test` (branches/PRs), `prerelease` (channel tags, unchanged apart from Node 24), `submission` (4-part tags → gate + artifact). (Rename + modify)
- `.github/workflows/test.yml` — **deleted**; its single job moves into `ci.yml` as `test`. (Delete)
- `.github/workflows/release.yml` — **new**; `workflow_dispatch` only. Builds the three editions at an approved tag and creates/updates the draft release. (Create)

---

### Task 1: Rename `release.yml` → `ci.yml`, absorb `test.yml`, bump Node

**Files:**
- Rename: `.github/workflows/release.yml` → `.github/workflows/ci.yml`
- Delete: `.github/workflows/test.yml`
- Modify: `.github/workflows/ci.yml` (header comment, `name`, `concurrency`, `on`, new `test` job, both `node-version` values)

- [ ] **Step 1: Rename the file with git so history follows**

Run:
```bash
git mv .github/workflows/release.yml .github/workflows/ci.yml
git rm -q .github/workflows/test.yml
git status --short .github
```
Expected:
```
R  .github/workflows/release.yml -> .github/workflows/ci.yml
D  .github/workflows/test.yml
```

- [ ] **Step 2: Replace the header, `name`, `concurrency` and `on` blocks**

In `.github/workflows/ci.yml`, replace everything from the first line (`name: release`) down to and including the line `- '[0-9]*.[0-9]*.[0-9]*.[0-9]*'` (the last tag glob under `on.push.tags`) with:

```yaml
name: ci

# Maintainer runbook — how to cut releases:
#
#   Channel drop (alpha shown; beta is identical):
#       git tag 2.0.0.alpha-1 <commit>
#       git tag -f alpha <commit>
#       git push origin 2.0.0.alpha-1
#       git push -f origin alpha
#   -> the rolling "Alpha Channel" prerelease is replaced with this build.
#
#   Always move the bare 'alpha'/'beta' tags. A suffixed moving tag (e.g.
#   'alpha-2') creates a SEPARATE rolling release keyed to that tag name
#   instead of replacing the 'alpha' one.
#
#   Certification submission:
#       # bump visual.version in pbiviz.json to 2.0.0.0 and commit
#       git tag 2.0.0.0 <commit>
#       git push origin 2.0.0.0
#   -> the `submission` job gates the commit and uploads the workflow artifact
#      HTML-Content.2.0.0.0 (all three .pbiviz). Download it and submit the
#      regular + Secure packages to Partner Center. No release is created —
#      submission tags are remediation iterations and the tag is the durable
#      record. Rejected? Fix, bump to 2.0.0.1, commit, tag and push again.
#
#   Production release (after Microsoft approves a submission tag):
#       Actions -> release -> Run workflow (from main), tag = 2.0.0.1
#   -> a DRAFT release named "2.0.0" is created for proofing; publish it
#      manually. See .github/workflows/release.yml.

# Default the workflow token to read-only; each job that publishes elevates
# to contents: write itself (release create/delete).
permissions:
    contents: read

# One run per ref at a time. cancel-in-progress stays false: cancelling a
# half-finished prerelease run is exactly the state that strands a deleted
# release.
concurrency:
    group: ci-${{ github.ref_name }}
    cancel-in-progress: false

on:
    push:
        branches: [main, certification-remediation]
        tags:
            - 'alpha'
            - 'alpha-*'
            - 'beta'
            - 'beta-*'
            # Certification submission tags (4-part, e.g. 2.0.0.0). The glob
            # is looser than the real rule; the submission job re-validates
            # with an exact regex.
            - '[0-9]*.[0-9]*.[0-9]*.[0-9]*'
    # Run on PRs to any base branch so the check is reported on the PR
    # (e.g. feature branches targeting release lines like 2.0.0).
    pull_request:
```

- [ ] **Step 3: Insert the `test` job before `prerelease`**

In `.github/workflows/ci.yml`, immediately after the line `jobs:` and before the line `    prerelease:`, insert:

```yaml
    test:
        # Branch pushes and PRs only; tag pushes are handled by the
        # prerelease / submission jobs below (submission runs this same gate).
        if: ${{ !startsWith(github.ref, 'refs/tags/') }}
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with:
                  node-version: '24'
                  cache: 'npm'
            - run: npm ci
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

```

- [ ] **Step 4: Bump Node in the `prerelease` job**

In the `prerelease` job, change the single `node-version: '20'` to `node-version: '24'`. (The `release` job's `node-version` is replaced wholesale in Task 2.)

- [ ] **Step 5: Parse-check**

Run: `npx --yes --package=js-yaml@4 js-yaml .github/workflows/ci.yml > /dev/null && echo PARSE OK`
Expected: `PARSE OK`

Run: `grep -c "node-version: '20'" .github/workflows/ci.yml`
Expected: `1` (the not-yet-converted `release` job; goes to 0 in Task 2)

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/test.yml
git commit -m "ci: fold test.yml into ci.yml (renamed from release.yml), Node 24" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Convert the `release` job into `submission`

**Files:**
- Modify: `.github/workflows/ci.yml` — the `concurrency` block, and the whole `    release:` job (from the comment `# Negative gate:` above it to the end of the file)

- [ ] **Step 0: Let branch/PR runs cancel in-progress runs** (added after the Task 1 quality review: folding `test.yml` in gave PR runs a no-cancel serialization they never had)

Replace the `concurrency` comment and block near the top of `ci.yml` with:

```yaml
# One run per ref at a time. Branch/PR runs supersede freely — a cancelled
# test run strands nothing. Tag runs never cancel: a half-finished prerelease
# is exactly the state that strands a deleted release.
concurrency:
    group: ci-${{ github.ref }}
    cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}
```

(Group on the full `github.ref`, not `ref_name`, so a branch and a same-named tag can never share a group while disagreeing on the cancel policy.)

- [ ] **Step 1: Replace the `release` job**

Delete from the line `        # Negative gate: every ref admitted by on.push.tags that is NOT a` (the comment directly above `    release:`) through the end of the file, and put this in its place:

```yaml
    submission:
        # Certification submission build. Negative gate: every ref admitted
        # by on.push.tags that is NOT a moving channel tag lands here; the
        # exact-shape validation step is what rejects strays loudly.
        # Uploads all three editions as a workflow artifact only —
        # deliberately no release object: submission tags are throwaway
        # remediation iterations and the tag itself is the durable record.
        # The approved tag is later published via release.yml.
        if: ${{ startsWith(github.ref, 'refs/tags/') && !startsWith(github.ref, 'refs/tags/alpha') && !startsWith(github.ref, 'refs/tags/beta') }}
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            # The on.push tag glob is looser than the real rule, so validate
            # the exact 4-part shape here, and require the tag to equal
            # pbiviz.json's visual.version (fail fast on drift). The tag names
            # the packages that get submitted to Partner Center, so it must be
            # the exact version baked into them. $GITHUB_REF_NAME env-var
            # form: see prerelease job note. Runs before setup-node on
            # purpose (fail fast, before the expensive gate): the `node -p`
            # below uses the runner image's preinstalled Node, which is fine
            # for JSON.parse/readFileSync.
            - name: Validate submission tag
              run: |
                  if ! echo "$GITHUB_REF_NAME" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
                      echo "::error::Tag '$GITHUB_REF_NAME' is not a 4-part submission version tag (e.g. 2.0.0.0)."
                      exit 1
                  fi
                  PBIVIZ_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('pbiviz.json','utf8')).visual.version")
                  if [ "$GITHUB_REF_NAME" != "$PBIVIZ_VERSION" ]; then
                      echo "::error::Tag '$GITHUB_REF_NAME' does not match pbiviz.json visual.version '$PBIVIZ_VERSION'. Bump pbiviz.json, commit, and re-tag."
                      exit 1
                  fi
            - uses: actions/setup-node@v4
              with:
                  node-version: '24'
                  cache: 'npm'
            - run: npm ci
            # Full quality gate — a submission never goes to Microsoft
            # untested. Mirrors the `test` job above.
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
            - name: Prepare artifact staging
              run: mkdir -p release-artifacts
            # Submission packages: all three editions with their committed
            # (production) GUIDs — no channel overlay — named with the 4-part
            # tag (the submission identity). dist/ is cleared before each
            # package so the mv glob can only match the single fresh artifact
            # (mv fails the job on zero or multiple matches). The non-secure
            # editions are checked for sanitizer leakage immediately after
            # packaging (the check reads the webpack drop, which the next
            # package run overwrites).
            - name: Package regular edition
              run: |
                  rm -rf dist .tmp/drop
                  node scripts/select-edition.mjs standard
                  npx pbiviz package
                  node scripts/check-no-sanitizer.mjs
                  node scripts/assert-production-version.mjs "$GITHUB_REF_NAME"
                  mv dist/*.pbiviz "release-artifacts/HTML-Content.${GITHUB_REF_NAME}.pbiviz"
            - name: Package secure edition
              run: |
                  rm -rf dist .tmp/drop
                  node scripts/select-edition.mjs certified
                  npx pbiviz package
                  node scripts/check-no-sanitizer.mjs --expect-sanitizer
                  node scripts/assert-production-version.mjs "$GITHUB_REF_NAME"
                  mv dist/*.pbiviz "release-artifacts/HTML-Content-Secure.${GITHUB_REF_NAME}.pbiviz"
            - name: Package standalone edition
              run: |
                  rm -rf dist .tmp/drop
                  node scripts/select-edition.mjs standalone
                  npx pbiviz package
                  node scripts/check-no-sanitizer.mjs
                  node scripts/assert-production-version.mjs "$GITHUB_REF_NAME"
                  mv dist/*.pbiviz "release-artifacts/HTML-Content-Standalone.${GITHUB_REF_NAME}.pbiviz"
            # This artifact IS the output of a submission run: download it
            # and upload the regular + Secure packages to Partner Center.
            - name: Upload submission artifact
              uses: actions/upload-artifact@v4
              with:
                  name: HTML-Content.${{ github.ref_name }}
                  path: release-artifacts/*.pbiviz
                  retention-days: 90
                  if-no-files-found: error
                  # A "re-run all jobs" on a run that already uploaded would
                  # otherwise 409 at the last step, after the full gate.
                  overwrite: true
```

- [ ] **Step 2: Parse-check and assert the old release machinery is gone**

Run: `npx --yes --package=js-yaml@4 js-yaml .github/workflows/ci.yml > /dev/null && echo PARSE OK`
Expected: `PARSE OK`

Run:
```bash
grep -c "node-version: '20'" .github/workflows/ci.yml
grep -c "node-version: '24'" .github/workflows/ci.yml
grep -cE "action-gh-release|Supersede|Get changelog baseline|draft: true" .github/workflows/ci.yml
grep -E "^    (test|prerelease|submission|release):$" .github/workflows/ci.yml
```
Expected: `0`, `3`, `1`, then exactly three lines `    test:`, `    prerelease:`, `    submission:` (no `    release:`).
(The single `action-gh-release` hit is the `prerelease` job's channel release, which stays.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: 4-part tags build a submission artifact instead of a draft release" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Create the dispatch-only `release.yml`

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the file**

Create `.github/workflows/release.yml` with exactly this content:

```yaml
name: release

# Publishes an APPROVED certification submission tag as a draft GitHub
# release for maintainer review. Flow:
#   1. Submission tags (2.0.0.N) are built by the `submission` job in
#      ci.yml as workflow artifacts only (no releases).
#   2. When Microsoft approves a submission, dispatch this workflow with
#      that tag. It rebuilds all three editions at the tag and creates a
#      DRAFT release titled with the 3-part version (e.g. 2.0.0).
#   3. The maintainer reviews/edits the draft body in the GitHub UI and
#      publishes it manually.
#
# When dispatching, leave the "Use workflow from" selector on main — the
# input tag only selects the code that gets built, not the workflow logic.
#
# The guard below is keyed by TAG. If a stale draft named with the same
# x.y.z exists from an earlier tag (e.g. 2.0.0.0 was dispatched by mistake
# and 2.0.0.1 is the approved one), delete that draft by hand first, or you
# will end up with two drafts named 2.0.0.
permissions:
    contents: read

on:
    workflow_dispatch:
        inputs:
            tag:
                description: 'Approved submission tag to publish (e.g. 2.0.0.1)'
                required: true
                type: string

# Serialize runs per tag so overlapping dispatches cannot race on the same
# draft release.
concurrency:
    group: release-${{ inputs.tag }}
    cancel-in-progress: false

jobs:
    release:
        runs-on: ubuntu-latest
        permissions:
            contents: write
        env:
            # Shell steps read the tag from env, never via ${{ }}
            # interpolation inside `run:` — expression interpolation pastes
            # the value into the script as shell source. `with:` blocks may
            # use the expression form safely.
            RELEASE_TAG: ${{ inputs.tag }}
        steps:
            - name: Check out approved tag
              uses: actions/checkout@v4
              with:
                  # Fully qualified so a same-named branch can never be
                  # resolved instead of the tag — checkout fails outright if
                  # the tag doesn't exist.
                  ref: refs/tags/${{ inputs.tag }}
                  # Full history + tags: the changelog action walks commits
                  # between the baseline tag and this tag.
                  fetch-depth: 0
            # Runs before setup-node on purpose (fail fast): the `node -p`
            # uses the runner image's preinstalled Node, which is fine for
            # JSON.parse/readFileSync. The release is named with the 3-part
            # semantic version (tag minus the 4th part).
            - name: Validate tag against pbiviz.json and derive title
              id: version
              run: |
                  if ! echo "$RELEASE_TAG" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
                      echo "::error::'$RELEASE_TAG' is not a 4-part numeric submission tag (e.g. 2.0.0.1)."
                      exit 1
                  fi
                  PBIVIZ_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('pbiviz.json','utf8')).visual.version")
                  if [ "$RELEASE_TAG" != "$PBIVIZ_VERSION" ]; then
                      echo "::error::Tag '$RELEASE_TAG' does not match pbiviz.json visual.version '$PBIVIZ_VERSION' at that commit."
                      exit 1
                  fi
                  echo "semver=${RELEASE_TAG%.*}" >> $GITHUB_OUTPUT
            # Re-dispatching against a tag whose release is already published
            # would flip that live release back to draft (action-gh-release
            # updates an existing release for the tag in place). Fail fast
            # instead; an existing DRAFT for the tag is fine to update on a
            # re-run. This must fail closed: only a confirmed 404 (no release
            # for the tag) may proceed. A published release fails the guard,
            # and any other API failure (5xx, auth, rate limit) fails loudly
            # too rather than being swallowed and treated as "no release".
            - name: Guard against already-published release
              run: |
                  if OUTPUT=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$RELEASE_TAG" --jq .draft 2>&1); then
                      if [ "$OUTPUT" = "false" ]; then
                          echo "::error::A published release already exists for tag '$RELEASE_TAG'. Refusing to modify it."
                          exit 1
                      fi
                      echo "Existing draft release found for '$RELEASE_TAG'; it will be updated."
                  elif echo "$OUTPUT" | grep -q "HTTP 404"; then
                      echo "No existing release for '$RELEASE_TAG'."
                  else
                      echo "::error::Could not determine release state for '$RELEASE_TAG': $OUTPUT"
                      exit 1
                  fi
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            # Changelog baseline = latest PUBLISHED release. The
            # /releases/latest endpoint excludes drafts and prereleases by
            # definition, so rejected submission tags and channel prereleases
            # can never become the baseline.
            - name: Resolve changelog baseline
              id: baseline
              run: |
                  BASELINE=$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)
                  if [ -z "$BASELINE" ]; then
                      echo "::error::Could not resolve the latest published release."
                      exit 1
                  fi
                  echo "tag=$BASELINE" >> $GITHUB_OUTPUT
                  echo "Baseline release tag: $BASELINE"
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            - uses: actions/setup-node@v4
              with:
                  node-version: '24'
                  cache: 'npm'
            - run: npm ci
            - name: Prepare artifact staging
              run: mkdir -p release-artifacts
            # Production packages: all three editions with their committed
            # (production) GUIDs — no channel overlay — named with the 3-part
            # semver (release-asset convention). No test gate here: the tag
            # was gated by the submission job and is immutable. dist/ is
            # cleared before each package so the mv glob can only match the
            # single fresh artifact (mv fails the job on zero or multiple
            # matches). The non-secure editions are checked for sanitizer
            # leakage immediately after packaging (the check reads the
            # webpack drop, which the next package run overwrites).
            - name: Package regular edition
              run: |
                  rm -rf dist .tmp/drop
                  node scripts/select-edition.mjs standard
                  npx pbiviz package
                  node scripts/check-no-sanitizer.mjs
                  node scripts/assert-production-version.mjs "$RELEASE_TAG"
                  mv dist/*.pbiviz "release-artifacts/HTML-Content.${{ steps.version.outputs.semver }}.pbiviz"
            - name: Package secure edition
              run: |
                  rm -rf dist .tmp/drop
                  node scripts/select-edition.mjs certified
                  npx pbiviz package
                  node scripts/check-no-sanitizer.mjs --expect-sanitizer
                  node scripts/assert-production-version.mjs "$RELEASE_TAG"
                  mv dist/*.pbiviz "release-artifacts/HTML-Content-Secure.${{ steps.version.outputs.semver }}.pbiviz"
            - name: Package standalone edition
              run: |
                  rm -rf dist .tmp/drop
                  node scripts/select-edition.mjs standalone
                  npx pbiviz package
                  node scripts/check-no-sanitizer.mjs
                  node scripts/assert-production-version.mjs "$RELEASE_TAG"
                  mv dist/*.pbiviz "release-artifacts/HTML-Content-Standalone.${{ steps.version.outputs.semver }}.pbiviz"
            - name: Generate changelog
              id: changelog
              # Third-party actions in this workflow run with a write-scoped
              # token, so they are pinned to reviewed commit SHAs rather than
              # mutable tags (supply-chain hardening).
              uses: requarks/changelog-action@1fabc7b0c6581d93c398246a856f084fb17cd9eb # v1.9.0
              with:
                  token: ${{ secrets.GITHUB_TOKEN }}
                  fromTag: ${{ inputs.tag }}
                  toTag: ${{ steps.baseline.outputs.tag }}
                  excludeTypes: ''
                  writeToFile: false
            - name: Create draft release
              uses: softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65 # v2.6.2
              with:
                  draft: true
                  tag_name: ${{ inputs.tag }}
                  name: ${{ steps.version.outputs.semver }}
                  body: |
                      This is version ${{ steps.version.outputs.semver }} of HTML Content, as published to AppSource. Details for this release are available [in the changelog](https://html-content.com/docs/change-log) on the documentation site.

                      Three packages are attached, one per edition:

                      | Package | Edition | Distribution |
                      | --- | --- | --- |
                      | `HTML-Content.${{ steps.version.outputs.semver }}.pbiviz` | **HTML Content** | AppSource (production visual ID) |
                      | `HTML-Content-Secure.${{ steps.version.outputs.semver }}.pbiviz` | **HTML Content Secure** | AppSource, certified (production visual ID) |
                      | `HTML-Content-Standalone.${{ steps.version.outputs.semver }}.pbiviz` | **HTML Content — Standalone** | Side-load only (independent visual ID) |

                      > **Note:** the regular and Secure packages use the **production AppSource visual IDs**. To use them directly you will need to deploy them as [organizational visuals](https://learn.microsoft.com/power-bi/developer/visuals/power-bi-custom-visuals-organization) — otherwise, simply wait for AppSource publication to catch up with this release. The Standalone package has its own visual ID and can be side-loaded into any report, but is independent of AppSource and will not auto-update.

                      ---

                      ## Changes since ${{ steps.baseline.outputs.tag }}

                      ${{ steps.changelog.outputs.changes }}

                      **Full Changelog**: https://github.com/${{ github.repository }}/compare/${{ steps.baseline.outputs.tag }}...${{ inputs.tag }}
                  files: |
                      release-artifacts/*.pbiviz
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            # Keep the built packages retrievable even when the create step
            # fails, so a broken run can be diagnosed and hand-published
            # without a rebuild. Purely diagnostic: must never affect job
            # status (continue-on-error), must survive re-runs (overwrite).
            - name: Upload artifacts for diagnosis
              if: always()
              continue-on-error: true
              uses: actions/upload-artifact@v4
              with:
                  name: release-artifacts
                  path: release-artifacts/*.pbiviz
                  if-no-files-found: warn
                  overwrite: true
```

- [ ] **Step 2: Parse-check and assert injection hygiene**

Run: `npx --yes --package=js-yaml@4 js-yaml .github/workflows/release.yml > /dev/null && echo PARSE OK`
Expected: `PARSE OK`

Run (no `${{ inputs.tag }}` or `${{ github.ref_name }}` may appear inside a `run:` block — they are only allowed in `with:`/`env:`/`concurrency:`):
```bash
awk '/run: \|/{inrun=1; next} /^ {12}- /{inrun=0} inrun && /\$\{\{ *(inputs\.tag|github\.ref_name)/{print "BAD: " NR ": " $0; bad=1} END{exit bad}' .github/workflows/release.yml && echo HYGIENE OK
```
Expected: `HYGIENE OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: dispatch-only release workflow publishes an approved submission tag as a draft" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Post-review fixes** (applied after the Task 3 code-quality review; the committed `release.yml` supersedes the Step 1 block on these points)

1. Guard fails closed: on `gh api` exit 0, anything other than a literal `true` is an error (`[ "$OUTPUT" != "true" ]`). Comment rewritten: `GET /releases/tags/<tag>` only returns published releases (drafts 404); the real hazard is overwriting a live release's name/body/assets, not "flipping it to draft".
2. Shallow checkout: `fetch-depth: 0` removed. The pinned changelog action uses `compareCommitsWithBasehead` over REST and has no git/child-process usage (verified at SHA `1fabc7b`).
3. `Generate changelog` moved above `setup-node` so an empty range fails before three builds; comment notes `fromTag` is the newer end.
4. Package steps take `env: SEMVER: ${{ steps.version.outputs.semver }}` and use `${SEMVER}` in `mv`, so no `${{ }}` appears in any `run:` block.
5. Gate comment no longer claims tags are immutable; it points at a tag-protection ruleset instead.
6. `fail_on_unmatched_files: true` on the release step.
7. Header documents that a re-run replaces assets but keeps the draft's name/body.
8. (Greptile P1 on the PR) Submission-gate check step after tag validation: `gh api .../actions/workflows/ci.yml/runs?event=push&status=success&head_sha=<HEAD>` filtered to `head_branch == env.RELEASE_TAG`; zero → error. Job gains `actions: read`.

Verification: `PARSE OK`; the awk hygiene check now flags any `${{` inside `run:` blocks and reports `HYGIENE OK`; `grep -c fetch-depth` → 0; step order baseline < changelog < setup-node < package < create.

---

### Task 4: Whole-branch verification and PR

**Files:** none modified.

- [ ] **Step 1: Confirm the workflow directory is exactly two files with the expected shape**

Run:
```bash
ls .github/workflows
grep -nE '^name:|^    (test|prerelease|submission|release):$' .github/workflows/ci.yml .github/workflows/release.yml
grep -rn "node-version" .github/workflows
```
Expected:
```
ci.yml
release.yml
.github/workflows/ci.yml:1:name: ci
.github/workflows/ci.yml:<n>:    test:
.github/workflows/ci.yml:<n>:    prerelease:
.github/workflows/ci.yml:<n>:    submission:
.github/workflows/release.yml:1:name: release
.github/workflows/release.yml:<n>:    release:
```
and four `node-version: '24'` lines (three in ci.yml, one in release.yml), zero `'20'`.

- [ ] **Step 2: Confirm the branch history is clean and the unrelated tmdl change is not staged**

Run: `git log --oneline main..HEAD && git status --short`
Expected: only spec/plan commits and the Task 1–3 commits (including the post-review fix commits recorded in Task 2 Step 0 and Task 3 Step 4), and status showing only ` M test-uat/.../expressions.tmdl` and `?? .claude/`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin ci/certification-gated-release
gh pr create --base main --title "ci: certification-gated releases (submission tags + dispatched draft release)" --body-file - <<'EOF'
## Summary

Mirrors Deneb's release model. A 4-part tag is now a **certification submission**: CI runs the full gate and uploads all three editions as a workflow artifact, with no release object. After Microsoft approves, the new dispatch-only `release.yml` rebuilds the three editions at that tag and creates the draft GitHub release (baseline = latest published release, by-tag guard against touching a live release).

- `release.yml` → `ci.yml` (git mv); `test.yml` folded in as the `test` job; old `release` job → `submission`.
- New `release.yml`: `workflow_dispatch` with a required `tag` input.
- Every `setup-node` bumped to Node 24 (Actions deprecation warnings on 20).

Spec: `docs/brainstorms/2026-09-16-certification-gated-release-design.md`. Plan: `docs/plans/2026-09-16-001-certification-gated-release.md`.

## Verification

- Both workflows parse (`js-yaml`); no tag expressions interpolated into `run:` blocks.
- This PR's own run exercises the merged `test` job.
- Live fire is deferred to the real `2.0.0.0` push (submission) and a pre-approval dispatch of `release` against it (inspect the draft, then delete it; the guard permits a later re-dispatch).

## Before the first submission tag

Add a tag ruleset protecting `[0-9]*.[0-9]*.[0-9]*.[0-9]*` from update/delete: the publish workflow skips the test gate on the strength of the submission run, which only holds if 4-part tags cannot be force-moved.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 4: Watch the PR's `ci / test` job**

Run: `gh pr checks --watch`
Expected: the `test` job from `ci.yml` (job id `test`) reports success. No `prerelease` or `submission` job runs on a PR.

- [ ] **Step 5: Live-fire notes for the maintainer (not automated)**

When ready to submit 2.0.0:
0. Once, before the first submission tag: add a repository ruleset (Settings → Rules → Rulesets → New tag ruleset) targeting `[0-9]*.[0-9]*.[0-9]*.[0-9]*` that blocks update and deletion. The publish workflow skips the test gate on the strength of the submission run, which only holds if 4-part tags cannot be force-moved afterwards.
1. Ensure `pbiviz.json` `visual.version` is `2.0.0.0` on the commit to submit; `git tag 2.0.0.0 <commit> && git push origin 2.0.0.0`.
2. Confirm the `submission` run uploads artifact `HTML-Content.2.0.0.0` containing three `.pbiviz` files; submit regular + Secure to Partner Center.
3. Optionally dispatch `release` with tag `2.0.0.0` now to inspect the draft body and assets, then delete the draft from the Releases page.
4. After approval, dispatch `release` with the approved tag; proof and publish the draft.

---

## Self-review

- **Spec coverage:** tagging model → runbook headers (T1, T3); `ci.yml` triggers/permissions/concurrency/test/prerelease/submission → T1, T2; `release.yml` steps 1–9 → T3; edge cases → guard + header note in T3; Node 24 → T1, T2, T3; verification → T4. No gaps.
- **Placeholders:** none; every step has the exact YAML or command.
- **Consistency:** submission artifacts use `${GITHUB_REF_NAME}` (4-part), release assets use `steps.version.outputs.semver` (3-part), matching the spec's decisions table; `steps.version`, `steps.baseline`, `steps.changelog` ids are used consistently within `release.yml`.
