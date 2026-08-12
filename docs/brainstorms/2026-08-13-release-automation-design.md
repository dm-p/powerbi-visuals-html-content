# Release automation: channel prereleases + tagged production releases

- **Date:** 2026-08-13
- **Status:** Approved
- **Related:** Deneb `ci.yml` prerelease job (deneb-viz/deneb) — the reference
  implementation for the channel-tag mechanics; `config/editions.mjs` /
  `scripts/select-edition.mjs` (edition composition this design extends)

## Problem

The repo is heading into beta testing for 2.0.0 and has no release automation.
Releases to date (e.g. 1.6.0) were hand-built and hand-published. We want:

1. **Prerelease channels.** Tagging a commit with a versioned channel tag
   (`2.0.0.alpha-1`, `2.0.0.beta-1`) and fast-forwarding the moving `alpha` /
   `beta` tag to the same commit automatically packages the visual and
   publishes a rolling prerelease showing the diff from the last production
   release tag (e.g. `1.6.2.0`). Unlike Deneb, we publish **two** editions per
   channel drop — regular and secure — with channel-prefixed GUIDs so they
   side-load cleanly alongside production visuals.
2. **Production releases.** Pushing a Power BI 4-part tag (`2.0.0.0`)
   automatically builds all **three** editions with their production GUIDs and
   creates a release named with the semantic version (`2.0.0`), following the
   pattern of the repo's existing releases.

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| Channel build identity in Power BI | GUID prefix **and** displayName suffix **and** channel icon (assets already added) |
| Internal 4-part `version` in channel packages | Left as committed (e.g. `2.0.0.0`); filenames/GUIDs carry identity, release notes tell testers to quote the filename |
| Test gating | Full suite (lint, unit, `docs:check`, integration) on production releases; packaging + lean-bundle check only on channel drops |
| Production publish flow | Draft release — workflow builds everything and generates the body; maintainer proofs and publishes manually |
| Changelog sourcing | Auto-generated conventional-commit changelog on channel pages; production pages link to the html-content.com changelog as canonical **and** append the generated commit list |
| Channel identity mechanism | Approach A — optional channel argument to `scripts/select-edition.mjs` (rejected: CI-side `jq` mutation — not locally reproducible; explicit per-channel edition entries — repetitive) |
| Remedial builds (4th-digit bump, same `x.y.z`) | Supersede the existing `x.y.z` release: replace it if still a draft; **fail** if already published (manual delete/un-publish required to supersede a live release) |

## Design

### Tagging model

Mirrors Deneb exactly for prereleases; adds an automated production path Deneb
does not have.

- **Prerelease:** push a versioned channel tag matching
  `^\d+\.\d+\.\d+\.(alpha|beta)-\d+$` (e.g. `2.0.0.beta-1`) and fast-forward
  the moving channel tag (`alpha` / `beta`) to the same commit. The workflow
  triggers on the moving tag (`alpha`, `alpha-*`, `beta`, `beta-*`), resolves
  the channel from the tag name, then **fails fast** if no versioned channel
  tag for that channel sits on the same commit (with an actionable error
  telling the maintainer how to tag).
- **Production:** push a 4-part numeric tag (`2.0.0.0`). The workflow
  validates the exact tag shape (`^\d+\.\d+\.\d+\.\d+$` — the on-trigger glob
  is looser than the real rule, so a job step re-validates) and asserts the
  tag equals `visual.version` in `pbiviz.json`, failing fast on drift.
- **Remedial production builds:** the release identity is `x.y.z`; a 4-part
  tag is one build of it. Per the recommended AppSource pattern (a failed
  submission is remediated by bumping only the fourth digit), pushing
  `2.0.0.1` supersedes the `2.0.0` release created from `2.0.0.0`: if the
  existing `2.0.0` release is still a **draft**, it is deleted and recreated
  as a fresh draft on the new tag; if it is already **published**, the job
  fails with instructions (delete or un-publish manually to supersede a live
  release). Superseded 4-part tags remain in git history.

### Workflow structure

One new file: `.github/workflows/release.yml`, with two jobs gated by tag
pattern:

- `prerelease` — runs when the ref is a moving channel tag.
- `release` — runs when the ref is a 4-part numeric tag.

`.github/workflows/test.yml` is untouched (it does not run on tag pushes and
continues to gate branches/PRs).

Both jobs need `permissions: contents: write` (release creation) and
`fetch-depth: 0` + tag fetch (changelog baseline + points-at lookups).

### Channel identity — `select-edition.mjs` overlay

`scripts/select-edition.mjs` gains an optional second positional argument:

```
node scripts/select-edition.mjs <edition> [channel]   # channel: alpha | beta
```

When a channel is supplied, after composing the edition overlay the script
additionally:

- prefixes the resolved GUID with the uppercased channel — e.g.
  `BETAhtmlContent443BE3AD55E043BF878BED274D3A6855` (standard/beta),
  `ALPHAhtmlContent443BE3AD55E043BF878BED274D3A6865` (certified/alpha) —
  the same composition pattern as the existing `STANDALONE` prefix;
- suffixes the resolved displayName — `HTML Content (Beta)`,
  `HTML Content Secure (Alpha)`;
- swaps the icon asset per edition + channel:
  `assets/palette_icon_standard_{alpha|beta}.png` for `standard`,
  `assets/palette_icon_secure_{alpha|beta}.png` for `certified`;
- **errors** for `standalone` + channel (channels build regular + secure only)
  and for any unknown channel value.

With no channel argument, behaviour is byte-identical to today. The overlay is
locally reproducible: a maintainer can build the exact bytes of a channel
package with one command when triaging a tester report.

The internal `visual.version` is never modified by the channel overlay.

### Job composition

| | `prerelease` (alpha/beta) | `release` (4-part tag) |
| --- | --- | --- |
| Editions built | `standard`, `certified` | `standard`, `certified`, `standalone` |
| Channel overlay | applied (GUID prefix, name suffix, icon) | none — production GUIDs |
| Gate | package each edition + `scripts/check-no-sanitizer.mjs` on the standard build | `npm run eslint`, `npm test`, `npm run docs:check`, Playwright integration, then package + lean checks (`check-no-sanitizer` on standard and standalone) |
| Artifact names | `HTML-Content.{2.0.0.beta-1}.pbiviz`, `HTML-Content-Secure.{2.0.0.beta-1}.pbiviz` | `HTML-Content.{2.0.0}.pbiviz`, `HTML-Content-Secure.{2.0.0}.pbiviz`, `HTML-Content-Standalone.{2.0.0}.pbiviz` |
| Release | rolling channel prerelease on the moving tag; previous channel release deleted then recreated; auto-published with `prerelease: true` | **draft** release, tag `2.0.0.0`, name `2.0.0`; maintainer proofs and publishes |

Artifact renaming: all editions share the internal visual name, so each
`pbiviz package` output is renamed (`mv` with a glob that fails the job on
zero or multiple matches, Deneb-style) to its final artifact name before the
next edition is packaged.

Prerelease release title: `{Alpha|Beta} Channel: Latest Build ({2.0.0.beta-1})`
(matches Deneb's rolling-release convention).

### Changelog generation

`requarks/changelog-action` (the action Deneb uses), conventional-commit
grouped:

- **Baseline (`toTag`):** newest tag matching `^\d+\.\d+\.\d+\.\d+$`,
  excluding — on production runs — **every tag sharing the current tag's
  `x.y.z`** (not just the pushed tag itself), so a remedial `2.0.0.1` still
  diffs against `1.6.2.0` rather than `2.0.0.0`. Channel-tag shapes can never
  become the baseline — drift is always measured from the last shipped
  production release (e.g. `1.6.2.0`).
- **`fromTag`:** the pushed tag (versioned channel tag for prereleases; the
  4-part tag for production).

## Release-page copy

Approved verbatim; `{braces}` are workflow-filled placeholders. Trivial
wording polish at implementation time is acceptable.

### Prerelease (rolling channel release)

**Title:** `{Alpha|Beta} Channel: Latest Build ({2.0.0.beta-1})`

```markdown
HTML Content {Alpha|Beta} Channel build — the latest early-access build for testing and feedback.

Two packages are attached, one per edition:

| Package | Edition | What it does |
| --- | --- | --- |
| `HTML-Content.{2.0.0.beta-1}.pbiviz` | **HTML Content** | Full HTML rendering, including external content where your tenant allows it. |
| `HTML-Content-Secure.{2.0.0.beta-1}.pbiviz` | **HTML Content Secure** | Sanitizes markup and blocks external communication, matching the behavior of the certified AppSource visual. |

Both packages use channel-specific visual IDs (prefixed `{ALPHA|BETA}`), so they can be side-loaded into reports alongside the AppSource or production visuals without interfering with them, and they will not auto-update.

> **Note on the Secure edition:** this build is **not** tied to AppSource and carries **none of the certification benefits** of the published certified visual. It is provided so you can verify that sanitization and external-communication blocking work as expected against your own content before the certified release catches up.

**These builds are not supported for production use** and are intended for testing and feedback only.

When reporting issues, please quote the full package filename (e.g. `HTML-Content.{2.0.0.beta-1}.pbiviz`) — the version shown inside Power BI reads `{x.y.z.0}` for all channel builds and does not identify the drop on its own.

---

## Changes since {1.6.2.0}

{generated conventional-commit changelog}
```

### Production (draft release)

**Title:** `{2.0.0}` (from tag `{2.0.0.0}`)

```markdown
Details for this release are available [in the changelog](https://html-content.com/docs/change-log) on the documentation site.

Three packages are attached, one per edition:

| Package | Edition | Distribution |
| --- | --- | --- |
| `HTML-Content.{2.0.0}.pbiviz` | **HTML Content** | AppSource (production visual ID) |
| `HTML-Content-Secure.{2.0.0}.pbiviz` | **HTML Content Secure** | AppSource, certified (production visual ID) |
| `HTML-Content-Standalone.{2.0.0}.pbiviz` | **HTML Content — Standalone** | Side-load only (independent visual ID) |

> **Note:** the regular and Secure packages use the **production AppSource visual IDs**. To use them directly you will need to deploy them as [organizational visuals](https://learn.microsoft.com/power-bi/developer/visuals/power-bi-custom-visuals-organization) — otherwise, simply wait for AppSource publication to catch up with this release. The Standalone package has its own visual ID and can be side-loaded into any report, but is independent of AppSource and will not auto-update.

---

## Changes since {1.6.2.0}

{generated conventional-commit changelog}
```

## Error handling / guards

- Moving channel tag with no versioned channel tag on the commit → fail fast
  with instructions (before install/build), Deneb-style.
- Unsupported channel name derived from the moving tag → fail.
- Production tag not matching the exact 4-part shape → fail.
- Production tag ≠ `pbiviz.json` `visual.version` → fail (version drift).
- Remedial tag while the same-`x.y.z` release is already published → fail
  with instructions (never silently delete or mutate a live release).
- Artifact rename `mv` fails the job on zero/multiple glob matches
  (missing or ambiguous build output cannot publish a mis-named release).
- `check-no-sanitizer.mjs` failing on a non-secure build fails the job (a
  sanitizer accidentally bundled into the regular/standalone edition is a
  release blocker).
- Workflow token defaults to read-only; only the release jobs elevate to
  `contents: write`.

## Testing

- `select-edition.mjs` channel overlay: unit-test the composed output
  (GUID prefix, name suffix, icon path, standalone+channel error, no-channel
  byte-identical behaviour). The script is pure file generation, so tests can
  run it and assert on the generated files.
- Workflow itself: exercised by cutting `2.0.0.alpha-1` + `alpha` as the first
  real drop (workflow YAML is not meaningfully unit-testable; guards above
  make failure modes loud).

## Out of scope

- Cleaning up channel releases/tags when a production release ships (manual,
  as with Deneb).
- Stamping channel iteration into the internal 4-part version (explicitly
  decided against).
- Any change to `test.yml` or branch CI.
- AppSource submission automation.
