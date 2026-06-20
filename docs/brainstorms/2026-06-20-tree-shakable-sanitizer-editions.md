# Tree-shakable sanitizer for the base editions

**Date:** 2026-06-20
**Status:** Design approved, pending plan
**Branch:** `chore/remove-dead-render-path` (off `2.0.0`) — implementation should land on its own branch off `2.0.0`

## Goal

Keep the **base** editions (`standalone`, `standard`) as lean as possible by
physically excluding the sanitizer subtree from their bundles. Sanitization is
not needed in those editions — they ship with the `WebAccess` privilege and
trust author input — so `dompurify`, `postcss` + `postcss-value-parser` (via
`css-sanitizer`), and `svg-payload-scan` are dead weight there.

Only the **certified** edition (`sanitize: true`) runs the sanitizer, and it is
the only edition Microsoft audits. It stays the committed default so a plain
`pbiviz package` always builds the real, auditable sanitizer.

Estimated win: ~100KB+ minified out of the base bundles (`dompurify` +
`postcss` + `postcss-value-parser`), measurable in the existing Statoscope
reports (`webpack.statistics.*.html`).

## Why the current approach can't tree-shake

`config/visual.json` (`{ "sanitize": true }`) is imported as
`import * as config from '../config/visual.json'` and read as `config.sanitize`
at runtime in `sanitize-pipeline.ts`. Because the flag is a **runtime property
read**, the `if (!config.sanitize) return` branches only skip work at runtime —
the heavy modules are still statically imported and bundled in every edition.

Two independent facts make this unavoidable with the current shape:

1. **No build-time elimination of the flag.** `powerbi-visuals-tools@7.1.0`
   exposes no webpack hook (`webpackConfig` is internal; there is no user
   merge/`DefinePlugin`/`resolve.alias` seam — verified). Even a build-time
   `false` constant would not help, because:
2. **Unused side-effectful imports are not dropped.** `import DOMPurify from
   'dompurify'` is a static, side-effectful module edge. webpack keeps such
   imports even when the binding is unused, and the project builds with
   `concatenateModules: false` (scope hoisting off). So terser DCE +
   `sideEffects` heuristics cannot be relied upon.

The only robust elimination is **module-graph separation**: the heavy deps must
be importable *only* from a module that the base edition's graph never
includes.

## What `pbiviz.mjs` does and does not solve

`powerbi-visuals-tools` (6.0.0+) supports a `.mjs` form of its config files:
`readJsonFromRoot`/`readJsonFromVisual` try `<name>.mjs` (dynamic `import()`,
default export) and fall back to `<name>.json` (`utils.js`). So `pbiviz.mjs` can
**compute** edition metadata (guid, displayName, icon, description) from a
build-time signal — cleanly replacing the merge-and-revert of `pbiviz.json` in
`bin/package-custom`.

What it does **not** do:

- It cannot change the webpack module graph, so it cannot tree-shake the
  sanitizer. The code seam (below) is still required.
- **`capabilities.mjs` is not honored at package time.** The webpack plugin's
  capabilities extractor receives `options.capabilities` as a **path string**
  and `JSON.parse`s the raw `capabilities.json`
  (`powerbi-visuals-webpack-plugin/src/extractor/capabilities.js`); it never
  resolves a `.mjs`. Per-edition privileges must therefore ride on the
  capabilities **path** that `pbiviz.mjs` points to, not on a `capabilities.mjs`.

## Architecture: the seam and the backend split

Invert where the `sanitize` decision lives. Instead of a runtime branch inside
every parse function, **the choice becomes which backend module is compiled**,
and the parse functions become edition-agnostic.

```
src/sanitize/
  index.ts              ← public API (LIGHT). The only module the rest of the app imports.
                          Owns parse + markdown (marked, createContextualFragment).
                          Delegates sanitizing to the backend — no config.sanitize branches.
  backend.ts            ← GENERATED selector (git-ignored). One line:
                          export * from './backend.certified'  (default)
                          export * from './backend.passthrough'
  backend.certified.ts  ← the HEAVY half of today's sanitize-pipeline.ts (dpConfig,
                          the hooks, withSanitizerHooks, recordCoreRemovals,
                          getSanitizedDataUri, isInPlaceSanitizableRoot, the test-only
                          getSanitizedHtmlForTesting). SOLE importer of dompurify,
                          css-sanitizer, svg-payload-scan, diagnostics-sink. enabled = true.
                          (The light parse/markdown wrappers move to index.ts.)
  backend.passthrough.ts← stub: identity/no-op, ~12 lines, zero heavy imports.
                          enabled = false.
```

`css-sanitizer.ts` and `svg-payload-scan.ts` do **not** move and are unchanged —
they remain imported only by `backend.certified.ts`.

No explicit `interface`/`abstract`/factory and no separate contract file:
TypeScript structural typing enforces that both backends match; an optional
`satisfies` check on each backend gives a compile guard. This keeps the seam at
the irreducible 4-file floor.

### Backend contract (structural)

| Member | certified | passthrough |
|---|---|---|
| `sanitizeHtmlString(html, options?) → string` | `preprocessStyleTags` + DOMPurify (today's `getSanitizedContent`) | returns `html` |
| `preprocessHtmlString(html) → string` | `preprocessStyleTags` | returns `html` |
| `sanitizeFragmentInPlace(fragment, options?) → void` | in-place DOMPurify loop | no-op |
| `sanitizeCssString(css) → string` | `sanitizeCss(css, 'stylesheet')` | returns `css` |
| `enabled: boolean` | `true` | `false` |

### `index.ts` (light, edition-agnostic)

| Function | index.ts does | Notes |
|---|---|---|
| `getParsedHtmlAsDom(content, format, opts)` | markdown→`marked`, then `parse(backend.sanitizeHtmlString(converted, opts))` | certified = `parse(preprocess+purify)` as today; passthrough = `parse(converted)` as today's `sanitize:false` branch |
| `parseAndSanitizeInContext(content, format, ctxEl, opts)` | markdown, `backend.preprocessHtmlString`, context-parse, `backend.sanitizeFragmentInPlace` | preprocess split out so the in-context string transform is still applied in the certified edition |
| `getSanitizedCss(css)` | `if (!css) return ''`, then `backend.sanitizeCssString(css)` | empty-string guard is edition-agnostic, lives once here |

`index.ts` also re-exports `sanitizeFragmentInPlace` (= backend's, for
`domain-utils`'s `resolveTemplateContainer`), the `SanitizeOptions` type, and
`sanitizerEnabled` (= `backend.enabled`, replacing `visual.ts`'s
`config.sanitize` read for the diagnostics Sanitizer tab).

### Parity claim

Both editions stay byte-identical to today:

- **Certified** `getParsedHtmlAsDom` = `parse(preprocess + purify)`, as now.
- **Base** `getParsedHtmlAsDom` = `parse(converted)` — exactly today's
  `sanitize:false` branch (no preprocess, no purify).
- All markdown/parse logic and the `if (!css) return ''` guard are
  edition-agnostic and live once in `index.ts`.

### Consumer churn (small)

- `domain-utils.ts`: import path `'./sanitize-pipeline'` → `'./sanitize'` (same
  names: `getParsedHtmlAsDom`, `getSanitizedCss`, `parseAndSanitizeInContext`,
  `sanitizeFragmentInPlace`, `SanitizeOptions`); the `getParsedHtmlAsDom`
  re-export follows.
- `visual.ts`: drop `import * as config from '../config/visual.json'`; use
  `sanitizerEnabled` from `'./sanitize'` for `sanitizeEnabled`.
- `diagnostics/types.ts`: a comment mentions `config.sanitize` — update wording.
- `config/visual.json`: **deleted**.

## Build and edition wiring

One build-time signal flows through git-ignored generated artifacts (plus two
committed, static capabilities files), so nothing committed is ever mutated and
there is no revert dance.

**`scripts/select-edition.mjs <edition>`** (the explicit prestep) writes two
generated, git-ignored artifacts:

- `src/sanitize/backend.ts` → `certified` or `passthrough` selector line.
- `config/active-edition.mjs` → `export default '<edition>'` — the cross-process
  handoff that `pbiviz.mjs` reads (prestep and `pbiviz` run in separate
  processes).

**Capabilities are two committed files, not generated.** `capabilities.json`
(certified, `privileges: []`) and `capabilities.webaccess.json` (identical
except the `WebAccess` privilege) are both committed; `pbiviz.mjs` just points
the `capabilities` path at the right one per edition. Privileges therefore live
in exactly one place — the JSON file — with nothing injected at build time. The
only cost is that the two files can drift if one is edited and not the other; a
small unit test asserts they are identical except for `privileges`, which closes
that gap cheaply.

**`pbiviz.mjs`** (honored, computed — replaces `pbiviz.json` + the merge/guid
patch in `bin/package-custom`):

- Reads `config/active-edition.mjs` (falls back to `certified` if absent).
- Returns the base config patched with that edition's guid / displayName / icon
  / description.
- Sets the `capabilities` path per edition: `certified → capabilities.json`,
  base → `capabilities.webaccess.json`.

**Edition data** lives in one source — `config/editions.mjs` (repurposed from
today's `config/package.json`): guid, displayName, icon, description, `sanitize`
bool, and the `capabilities` path per edition. (Privileges are not duplicated
here — they live in the committed capabilities files.)

### npm scripts

```jsonc
"package":            "node scripts/select-edition.mjs certified && pbiviz package",
"package-standalone": "node scripts/select-edition.mjs standalone && pbiviz package",
"package-standard":   "node scripts/select-edition.mjs standard && pbiviz package",
"prestart":           "node scripts/select-edition.mjs certified",   // dev = real sanitizer
"postinstall":        "node scripts/select-edition.mjs certified"     // fresh clone can build
```

Arg-based (matches today's `--mode` style — no `cross-env`/Windows shell
concerns). The build only ever writes the two git-ignored generated files and
never mutates a committed file, so a failed base build leaves nothing dirty; the
next `prestart` / `postinstall` / `package` resets generated state to certified.

### Deleted

- `config/visual.json` and its runtime `import * as config`.
- `bin/package-custom`'s 3-file merge-and-revert (it collapses to "select
  edition, then `pbiviz package`").
- The `sanitize` flag and guid-merge data fold into `config/editions.mjs`.

## Testing

- **Certified backend tests:** existing sanitizer tests retarget their import
  from `./sanitize-pipeline` to `./sanitize/backend.certified` — unchanged
  coverage of the real sanitizer.
- **`index.ts` (light layer):** tests for markdown/parse + correct delegation,
  run against the default certified backend (proves byte-identical behavior to
  today).
- **Passthrough parity test:** import `backend.passthrough`; assert
  `sanitizeHtmlString` / `sanitizeCssString` return input unchanged,
  `sanitizeFragmentInPlace` leaves the fragment untouched, `enabled === false`.
- **Capabilities drift guard:** assert `capabilities.json` and
  `capabilities.webaccess.json` are identical except for the `privileges` field,
  so the two committed files cannot silently diverge.
- **Anti-regression guard (the one that matters):** after
  `npm run package-standalone`, scan the packaged `visual.js` for a
  DOMPurify/postcss fingerprint and assert it is **absent**. This stops a
  careless `import … from './backend.certified'` in `index.ts` from silently
  dragging the deps back into the base bundle. Also surfaces the bundle-size
  delta. Wire into CI alongside the existing `cert-check` / `test:integration`.

## Error-handling parity

The certified backend keeps every fail-closed guard verbatim — it is the
audited path and is moved, not modified. The passthrough backend has nothing to
fail closed: base editions trust input by design (that is what the `WebAccess`
privilege is). No new error surface is introduced — only import-path churn,
which the parity tests pin down.

## Out of scope

- Any change to the certified sanitizer's rules or behavior.
- Internals of `css-sanitizer.ts` / `svg-payload-scan.ts`.
- The diagnostics dialog (already gates the Sanitizer tab on `sanitizerEnabled`).
```
