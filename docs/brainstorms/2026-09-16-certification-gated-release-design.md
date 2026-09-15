# Certification-gated releases: submission tags + dispatched draft release

- **Date:** 2026-09-16
- **Status:** Approved
- **Related:** `docs/brainstorms/2026-08-13-release-automation-design.md` (the
  flow this supersedes for production tags); Deneb `ci.yml` `submission` job and
  `release.yml` (deneb-viz/deneb) — the reference implementation.

## Problem

Today, pushing a 4-part production tag (`2.0.0.0`) runs the quality gate,
packages all three editions and **immediately** creates a draft release named
`2.0.0`. The AppSource submission happens afterwards, and Microsoft may reject
it. That leaves a draft release for a build that never shipped, and a remedial
tag (`2.0.0.1`) has to supersede it via delete-and-recreate logic.

Deneb separates the two concerns: a 4-part tag is a **submission** (CI gates
and builds the packages as a workflow artifact, no release object), and a
manually dispatched **release** workflow publishes the draft only once
Microsoft has approved that tag. We want the same here, with the one
difference that HTML Content ships **three** editions and all three must be
attached to the draft.

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| How the release workflow picks its tag | Explicit, required `workflow_dispatch` input (Deneb-exact). No "latest tag" resolution — you publish precisely the tag Microsoft approved. |
| What a 4-part tag push does | Full quality gate + package **all three** editions with production GUIDs, uploaded as a single workflow artifact. No release object. |
| Changelog baseline | Latest **published** GitHub release (`releases/latest`), which excludes drafts and prereleases by definition. For 2.0.0 this is `1.6.0.0` (1.6.1/1.6.2 were tagged but never released). |
| File layout | Full Deneb layout: `test.yml` + tag jobs fold into `ci.yml`; the dispatch workflow is `release.yml`. |
| Test gate on publish | None. The tag was gated at submission (and should be protected from force-moves by a repo ruleset — see Edge cases); publish rebuilds with `npm ci` and keeps only the cheap post-package assertions. |
| Remedial builds | The by-tag guard replaces the x.y.z supersede-and-delete logic: a published release for the tag fails closed; an existing draft is updated in place. |
| Runner Node version | Bump every `setup-node` step from 20 to **24** (Actions warns that Node 20 is deprecated). `powerbi-visuals-tools` 7.2.1 requires only `>=20.19.0`; local development is already on 24. |

## Design

### Tagging and release model

- **Channel drops** (`alpha`/`beta` + versioned channel tags): unchanged.
- **Submission:** bump `visual.version` in `pbiviz.json` to `x.y.z.N`, commit,
  tag the commit `x.y.z.N` and push the tag. CI validates the tag (exact
  4-part shape, equals `pbiviz.json`), runs the full gate and uploads the
  three packages as a workflow artifact. Rejected by Microsoft → fix, bump only
  the fourth digit, commit, re-tag. Superseded tags stay in history.
- **Publish:** once Microsoft approves, dispatch `release.yml` from `main` with
  the approved tag. It rebuilds the three editions at that tag and creates a
  **draft** release named with the 3-part version (`2.0.0`). The maintainer
  proofs the body and publishes from the Releases page.

### `ci.yml`

Created with `git mv .github/workflows/release.yml .github/workflows/ci.yml`
so history follows; `test.yml` is deleted.

- **Triggers:** `push` to `main` and `certification-remediation`; `push` of
  the existing tag globs (`alpha`, `alpha-*`, `beta`, `beta-*`,
  `[0-9]*.[0-9]*.[0-9]*.[0-9]*`); `pull_request`.
- **Permissions:** `contents: read` at the workflow level; jobs that publish
  elevate themselves.
- **Concurrency:** one run per ref, grouped on the full `github.ref` (so a
  branch and a same-named tag can never share a group and disagree on the
  cancel policy). `cancel-in-progress` is the expression
  `!startsWith(github.ref, 'refs/tags/')`: branch/PR runs supersede freely
  (a cancelled `test` run strands nothing, and `test.yml` had no
  serialization before), while tag runs never cancel (a half-finished
  prerelease is exactly the state that strands a deleted release).
- **Node:** every `setup-node` step in both files uses `node-version: '24'`
  (the only change to `prerelease`).
- **Job `test`** — `if: !startsWith(github.ref, 'refs/tags/')`. The current
  `test.yml` steps verbatim (checkout, `npm ci`, Playwright cache and install,
  lint, unit, docs drift, integration).
- **Job `prerelease`** — unchanged apart from the Node bump.
- **Job `submission`** — the current `release` job with the changelog,
  supersede and create-release steps removed:
  1. Validate the tag: exact `^\d+\.\d+\.\d+\.\d+$` and equal to
     `pbiviz.json` `visual.version` (runs before `setup-node`, fail fast).
  2. `npm ci`, then the full gate (identical to `test`).
  3. Package the three editions, clearing `dist`/`.tmp/drop` before each, with
     the sanitizer-leakage check and `assert-production-version.mjs`. Files are
     named with the **4-part tag** (the submission identity):
     `HTML-Content.<tag>.pbiviz`, `HTML-Content-Secure.<tag>.pbiviz`,
     `HTML-Content-Standalone.<tag>.pbiviz`.
  4. `actions/upload-artifact@v4`: name `HTML-Content.<tag>`, path
     `release-artifacts/*.pbiviz`, `retention-days: 90`,
     `if-no-files-found: error`, `overwrite: true` (a "re-run all jobs" on a
     run that already uploaded would otherwise 409 at the last step). This
     artifact is what gets downloaded and submitted to Partner Center
     (regular + Secure).

### `release.yml`

New file mirroring Deneb's, adapted to three editions and this repo's
conventions (Node 24, SHA-pinned third-party actions, edition scripts).

- **Trigger:** `workflow_dispatch` with a required string input `tag`
  (e.g. `2.0.0.1`). Dispatch from `main`; the input selects the code, not the
  workflow logic.
- **Permissions/concurrency:** `contents: read` default, job elevates to
  `contents: write`; `concurrency.group: release-<tag>`, no cancel.
- **Injection hygiene:** `RELEASE_TAG` is a job-level env var; `run:` steps
  read it from the environment, never via `${{ }}` interpolation. `with:`
  blocks may use the expression form.
- **Steps:**
  1. Checkout `ref: refs/tags/<tag>` (fully qualified; fails outright if the
     tag doesn't exist). Shallow: the changelog action compares the two tags
     via the REST API (verified against the pinned source — no git usage),
     and nothing else reads history.
  2. Validate tag shape and `pbiviz.json` match; emit `semver` (tag minus the
     4th part) as the release title.
  3. Guard: `gh api repos/.../releases/tags/<tag> --jq .draft`. That endpoint
     only returns **published** releases (drafts 404), so: HTTP 404 →
     continue (an existing draft, if any, is updated in place); exit 0 with
     anything other than a literal `true` → error (a published release, or
     unexpected output — fails closed; never overwrite a live release's
     name/body/assets); any other API failure → error.
  4. Baseline: `gh api repos/.../releases/latest --jq .tag_name`; empty →
     error.
  5. Changelog via `requarks/changelog-action` (repo's pinned SHA),
     `fromTag: <tag>` (the newer end — the action's naming is inverted),
     `toTag: <baseline>`. Runs **before** the builds so an empty range fails
     fast.
  6. `setup-node` 24, `npm ci`.
  7. Package the three editions exactly as `submission` does, but named with
     the **3-part semver** (existing release-asset convention):
     `HTML-Content.<semver>.pbiviz`, `HTML-Content-Secure.<semver>.pbiviz`,
     `HTML-Content-Standalone.<semver>.pbiviz`. The semver reaches the shell
     via a step `env: SEMVER`, keeping the "no `${{ }}` inside `run:`"
     invariant absolute.
  8. `softprops/action-gh-release` (repo's pinned SHA): `draft: true`,
     `tag_name: <tag>`, `name: <semver>`, `files: release-artifacts/*.pbiviz`,
     `fail_on_unmatched_files: true`. Body = the existing three-package table
     and organizational-visual note, reworded to state that the release is as
     published to AppSource, followed by "Changes since <baseline>", the
     generated changelog and a `compare/<baseline>...<tag>` link.
  9. Diagnostic `upload-artifact` (`if: always()`, `continue-on-error`,
     `overwrite: true`) so a failed create still leaves the packages
     retrievable.

### Edge cases

- **Stray draft for an earlier tag of the same x.y.z** (e.g. `2.0.0.0` was
  dispatched by mistake, then `2.0.0.1` is approved): the guard is by tag, so
  a second draft named `2.0.0` would be created. Delete the stale draft by hand
  first. The runbook says so.
- **Re-dispatch after a fix to the workflow itself:** allowed while the
  release is a draft; assets with the same name are replaced, but the
  draft's existing name and body are kept (the action updates in place). To
  regenerate the notes, delete the draft and dispatch again.
- **Tag force-moves:** the publish workflow skips the test gate on the
  strength of the submission run, which only holds if 4-part tags cannot be
  moved afterwards. Add a repository ruleset protecting
  `[0-9]*.[0-9]*.[0-9]*.[0-9]*` tags from update/delete (a settings change,
  outside this branch).
- **No published release yet** (fresh repo): the baseline step fails loudly
  rather than generating an unbounded changelog.

### Runbook (header comment in both files)

```
Submission:
    # bump visual.version in pbiviz.json to 2.0.0.0, commit
    git tag 2.0.0.0 <commit>
    git push origin 2.0.0.0
-> ci.yml `submission` gates the commit and uploads artifact
   HTML-Content.2.0.0.0 (three .pbiviz). Download; submit regular + Secure
   to Partner Center. Rejected? Fix, bump to 2.0.0.1, commit, re-tag.

Publish (after Microsoft approves):
    Actions -> release -> Run workflow (from main), tag = 2.0.0.1
-> DRAFT release "2.0.0" with three assets. Proof and publish manually.
   If a draft "2.0.0" from an earlier tag exists, delete it first.
```

## Verification

- No `actionlint`/Docker locally: validate both files parse as YAML and
  review the job `if:` gates by hand.
- The PR's own `pull_request` run exercises the merged `test` job in `ci.yml`.
- Live fire: the first real `2.0.0.0` push exercises `submission`. Dispatch
  `release` against it **before** approval to inspect the draft, then delete
  the draft; the guard permits a later re-dispatch.

## Out of scope

- Any change to the channel (`alpha`/`beta`) prerelease job.
- Automated Partner Center submission.
- Changes to `scripts/` or `config/editions.mjs`.
