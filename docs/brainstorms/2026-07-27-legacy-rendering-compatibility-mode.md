# Legacy (v1.6) rendering compatibility mode

- **Date:** 2026-07-27
- **Status:** Approved
- **Related:** W3.CSS compat layer (uncommitted, `style/visual.less` +
  `test/w3-compat.test.ts`), WP-C templating (default row template)

## Problem

2.0 does not render 1.6 reports like-for-like. Two causes were identified while
debugging the flags-migration regression (image rows growing 48px → 52px and
overflowing previously-fitting layouts):

1. **Styling.** v1.6 bundled the whole W3.CSS framework (`import
   'w3-css/w3.css'` in `src/visual.ts`, pulled in for the old landing page).
   Its element-level rules — `img { vertical-align: middle }`, `line-height:
   1.5`, heading treatment, `a { color: inherit }`, border-box sizing, etc. —
   were silently part of the content rendering environment for every 1.6
   report. 2.0 dropped the framework. A compat layer now exists in
   `style/visual.less` (scoped `:where(#htmlContent)`), but it is
   unconditional: new 2.0 reports are also stuck with W3.CSS's quirks.

2. **Row structure.** The default row template is
   `<div><div>{{row}}</div></div>` (`VisualConstants.templates.row`),
   deliberately mirroring 1.6's entry-div > inner-div nesting so migrated
   reports keep byte-identical DOM. New reports have no reason to carry the
   extra wrapper.

Goal: migrated 1.6 visuals keep legacy behaviour by default; newly created 2.0
visuals get modern behaviour by default; either can be switched explicitly.

## Decisions

### One combined toggle, visible in the pane

A single persisted bool drives **both** quirks. New capabilities object
`compatibility`, property `legacyRendering`, surfaced as its own
"Compatibility" card — "Use legacy (v1.6) rendering". The two quirks always
travel together in real migrations; a user who wants modern CSS with the old
structure can still author the double-div row template by hand (an authored
row template always wins, in both modes).

Rejected: two separate toggles (doubles the persistence surface, invites
confusing half-legacy states); a numeric `renderingVersion` enum (YAGNI — a
bool covers one legacy generation, and superseded properties must be kept
forever anyway, so a second bool later costs the same as the enum now).

### The property doubles as the version marker

Power BI gives a visual no signal about when an instance was created, so
"on for existing, off for new" must be inferred once and then persisted.

On each update the visual reads the **raw**
`metadata.objects.compatibility.legacyRendering` — not the formatting-settings
model, which cannot distinguish "absent" from "explicitly set to the default".
Absent ⇒ the instance is unclassified ⇒ run the heuristic. Present ⇒ the
persisted value wins and the heuristic never runs again. The pane toggle binds
to the same property, so after stamping it behaves as a normal editable
setting.

### Classification heuristic: data-bound rule

- Marker absent **+ data bound** in the update ⇒ migrated 1.6 visual ⇒ legacy
  **ON**.
- Marker absent **+ no data** (the landing state every freshly-dropped visual
  starts in) ⇒ new visual ⇒ legacy **OFF**.

"Data bound" means the update's dataViews carry the `content` role (the same
condition that takes the visual off the landing page) — an empty dataViews
array, or views without `content`, classify as "no data".

Known caveats (accepted):

- Pre-release 2.0 reports (UAT workbooks, testers) have data + no marker and
  flip to legacy ON once; flip them back by hand.
- Format-pane **"Reset to default" wipes the marker for one update**, but
  `resolveCompatibility` re-arms the persist guard whenever it observes a
  marker (any value), so the very next update — seeing the marker absent
  again — immediately re-stamps it from the session's cached mode rather than
  re-running the heuristic. In practice a reset is a no-op for rendering: the
  mode the session already resolved keeps rendering, and the marker is
  restored on the persist echo. Durable unmarking only happens if that
  echo never lands (e.g. the instance is torn down between the reset and the
  scheduled persist) — vanishingly rare, and recoverable with one toggle
  flip either way.

Rejected: persisted-objects heuristic (a 1.6 report whose author never touched
the format pane has no persisted objects and would misclassify as new); no
auto-detection (every migrated report renders wrong until someone intervenes —
exactly the regression wave this feature exists to prevent).

### Update-cycle & rendering-events discipline

`persistProperties` triggers an extra update, and certified visuals must pair
every update 1:1 with `renderingFinished`/`renderingFailed`
(`src/visual.ts` wraps each update in exactly one started→finished pair; the
codebase currently has **no** `persistProperties` calls — this is the first,
so the discipline is part of the design):

- **In-memory first, always.** On the first update of a session, if the marker
  is absent, the heuristic result is stored in an instance field and drives
  the render immediately. Rendering never waits on persistence; the current
  update completes its full event pair as today. The in-memory value is
  authoritative for the rest of the session.
- **Persist only when editable, after the cycle closes.** If
  `options.viewMode` is `Edit` or `InFocusEdit`, stamp the marker via
  `persistProperties` — deferred to a post-render task scheduled after
  `renderingFinished` has fired. The persist echo arrives as an ordinary new
  update: it sees the marker in `metadata.objects` (matching the in-memory
  value), renders idempotently (reconcile path ≈ no-op), and fires its own
  event pair. A once-per-session guard flag prevents re-persisting if the
  echo's metadata is slow to reflect.
- **View mode: never persist.** A viewer cannot save, so stamping would fire a
  wasted extra update on every open of an old report, forever. The heuristic
  re-derives the same in-memory answer each session (deterministic: data
  bound + no marker ⇒ legacy) at zero extra updates. The report gets durably
  stamped the first time someone opens it in edit mode and saves.

Consequence (accepted): an old report that is only ever viewed never gets a
marker and stays on the heuristic path indefinitely — fine, because the
heuristic is stable for it. The marker is an optimisation and an edit-mode
override anchor, not a correctness requirement.

## Gating mechanics

### Styling gate

`resolveStyling` toggles a class (working name `hc-legacy-v1`) on
`#htmlContent`; the compat block's scope in `style/visual.less` becomes
`:where(#htmlContent.hc-legacy-v1)`. `:where()` zeroes the scope's
specificity, so the cascade guarantee (user stylesheets, injected into
`<head>` after the bundle, win ties against the compat rules at bare-element
specificity) holds in both modes.

### Row-structure gate

`VisualConstants.templates.row` splits into:

- legacy: `<div><div>{{row}}</div></div>`
- modern: `<div>{{row}}</div>` (renders `<div class="htmlViewerEntry">content</div>`)

The template resolver picks the fallback by mode **only when the user has not
authored a row template**. The pane placeholder text follows the active mode.

## Testing

- Classification matrix: marker present/absent × data/no-data × viewMode —
  asserting the resolved mode, whether `persistProperties` is called, with
  what value, and that it is called at most once per session.
- Event discipline: persist is scheduled only after `renderingFinished` for
  the triggering update.
- `test/w3-compat.test.ts`: assert the new class-gated scope and that no
  compat rule fires without the class.
- Template defaults per mode; authored row template unaffected by mode.
- Pane toggle flip re-renders both gates.

## Non-goals

- No generic versioned-rendering machinery (`renderingVersion` enum).
- No changes for users who authored custom row templates or stylesheets —
  their values always win, unchanged.
