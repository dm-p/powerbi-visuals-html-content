# Channel build identity: stamped version + landing NOT-FOR-PRODUCTION badge

- **Date:** 2026-08-13
- **Status:** Approved
- **Related:** Release automation (docs/brainstorms/2026-08-13-release-automation-design.md,
  merged as PR #189) — this design supersedes that spec's "internal 4-part
  version left as committed" decision **for channel builds only**. Production
  and no-channel builds remain byte-identical to today.

## Problem

Round-trip testing of the publication process surfaced two gaps in channel
(alpha/beta) builds:

1. Every channel drop reports the committed version (`2.0.0.0`) inside Power
   BI — the landing page and the visualizations-pane tooltip cannot identify
   which drop (or rebuild) a tester is actually running. Release notes work
   around this by telling testers to quote the package filename.
2. Nothing inside the rendered visual warns that a channel build is not for
   production use.

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| 4th version segment for channel builds | Deneb-style date + commit hash: `2.0.0.20260813#b044cfdc` (rejected: the versioned tag — unavailable to local builds, can't distinguish rebuilds; tag+hash hybrid — longest form, same plumbing cost) |
| Landing indicator | Channel-named warning badge: `ALPHA BUILD — NOT FOR PRODUCTION USE` / `BETA BUILD — NOT FOR PRODUCTION USE` (rejected: plain text line — too easy to miss; badge + version-prefix — redundant) |
| Where the stamp is computed | Approach A — `scripts/select-edition.mjs` computes it once and flows it through the generated handoff (rejected: computing inside `resolveEditionConfig` — makes the pure resolver impure and risks script/pbiviz.mjs drift; CI-only env var — local builds would package unstamped, defeating the local verification requirement) |
| Translation for the badge | None — the repo has no i18n infrastructure (`stringResources: []`, no locale files); all splash strings are hardcoded English literals and the badge follows suit |

## Design

### 1. Version stamping

- `scripts/select-edition.mjs`, when invoked with a channel, computes:
  `STAMP = <base x.y.z>.<YYYYMMDD UTC>#<git rev-parse --short=8 HEAD>`
  (e.g. `2.0.0.20260813#b044cfdc`; `<base x.y.z>` is the committed
  `pbiviz.json` version minus its 4th part).
- The stamp is passed to `resolveEditionConfig(base, edition, channel,
  versionOverride)` as a new optional 4th argument. The resolver applies it
  as `visual.version` **only inside the channel branch**; passing an override
  without a channel throws (loud misuse guard). The resolver stays pure —
  git/clock access lives in the script.
- The stamp is persisted in the generated handoff: `config/active-edition.mjs`
  gains `export const versionOverride = '…';` (undefined when absent).
  `pbiviz.mjs` reads it back and passes it through, so the packaged metadata
  (visualizations pane) and `RESOLVED_VISUAL` (landing page) carry the
  identical value from a single computation — no midnight-rollover or
  commit-drift between the two consumers.
- Old-format generated files (no `versionOverride` export) resolve as
  `undefined` — same backward-compat contract as the existing `channel`
  export.
- The stamp format lives in a single place in `select-edition.mjs` so a
  fallback (see Testing) is a one-line change.

### 2. Landing badge

- `src/visual-config.generated.ts` gains
  `export const CHANNEL: 'alpha' | 'beta' | undefined` (written by
  `select-edition.mjs`).
- `src/landing/handler.ts` passes it into `SplashOptions` as optional
  `channel`; `buildSplash`/`buildHeader` in `src/landing/splash.ts` append,
  directly under the `hc-landing-version` div, a badge div
  (`hc-landing-channel-badge`) with text
  `ALPHA BUILD — NOT FOR PRODUCTION USE` /
  `BETA BUILD — NOT FOR PRODUCTION USE`. No badge when `channel` is
  undefined.
- Styling in `style/visual.less` following the existing `hc-landing-*`
  conventions: warning-tinted pill (amber family), small-caps/bold, visible
  without dominating the hero.
- The version line needs no change — it renders whatever
  `RESOLVED_VISUAL.version` says, which is now the stamp.

### 3. Workflow + guard updates

- `.github/workflows/release.yml` (prerelease job):
  - Drop the `Resolve internal visual version` step (its output fed only the
    release-body line being replaced).
  - Replace the body line "the version shown inside Power BI reads `…` for
    all channel builds and does not identify the drop on its own" with:
    "the in-visual version (shown on the landing page and in the
    visualizations pane) pins the exact build date and commit, e.g.
    `2.0.0.20260813#b044cfdc` — include it when reporting issues along with
    the package filename."
- `scripts/assert-channel-identity.mjs` gains a third assertion: the packaged
  `visual.version`'s 4th segment matches `^\d{8}#[0-9a-f]{7,}$`.
- The production job is untouched (no channel, no stamp; its tag ↔
  `pbiviz.json` version assertion continues to hold).

### 4. Testing and the merge gate

- Unit (vitest):
  - Resolver: stamp applied as `visual.version` for channel + override;
    override without channel throws; no-channel version untouched (existing
    assertion stays); base never mutated (existing test now also covers the
    version path).
  - Splash: badge present with correct wording per channel; absent when no
    channel.
- Empirical, **before the PR merges** (hard gate):
  1. `node scripts/select-edition.mjs standard beta` then
     `npx pbiviz package` — confirms `pbiviz` accepts the `#` version.
  2. `node scripts/assert-channel-identity.mjs BETA` — now also validates the
     stamp.
  3. The user imports the built `.pbiviz` into Power BI Desktop and confirms:
     (a) the visualizations-pane tooltip shows the stamped version;
     (b) the landing page shows the stamped version and the badge.
- **Fallback if Desktop rejects `#`:** digits-only stamp
  (`2.0.0.20260813`) in `visual.version`, with the full `date#hash` shown on
  the landing page only. Isolated to the stamp-format constant in
  `select-edition.mjs` plus (if triggered) a landing-only suffix; decision
  point is the Desktop check above.

## Out of scope

- Any change to production/no-channel builds, the standalone edition, or the
  production release job.
- The diagnostics dialog (channel identity there can ride a later change if
  wanted).
- i18n infrastructure.
