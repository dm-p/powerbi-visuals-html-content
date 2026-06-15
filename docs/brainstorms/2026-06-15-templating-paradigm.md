---
title: Templating paradigm (WP-C)
date: 2026-06-15
status: approved
related_issues:
    - https://github.com/dm-p/powerbi-visuals-html-content/issues/127
    - https://github.com/dm-p/powerbi-visuals-html-content/issues/138
---

# Templating paradigm (WP-C)

## Problem

Today the visual renders one pre-built HTML/markdown string per row. [view-model.ts:140-154](../../src/view-model.ts#L140-L154) maps each row's `content` column straight to an entry's `content`, and [resolveHtmlGroupElement](../../src/domain-utils.ts#L290-L309) parses **each entry's content independently** into its own `.htmlViewerEntry` > inner `<div>` node. There is no way to:

- wrap static HTML around the whole output — a table header, a layout container, a footer ([#127](https://github.com/dm-p/powerbi-visuals-html-content/issues/127)); or
- compose structural HTML that spans rows — e.g. a real `<table>` where the granularity rows are its `<tr>`s ([#138](https://github.com/dm-p/powerbi-visuals-html-content/issues/138)).

The root cause for the table case (the maintainer's own diagnosis on #138): *"each granularity row is parsed independently into a DOM fragment, and the browser automatically closes any unclosed tags during that parsing. On top of that, each row gets wrapped in `<div class="htmlViewerEntry"><div>...</div></div>`, which breaks table semantics."* A `<table>` opened in row 1 and closed in row N cannot survive per-row fragment parsing, and the per-row wrapper divs are invalid inside `<tbody>`.

Authors work around this with one giant DAX measure that emits the entire structure — which collides with the 2.1M-character measure limit and forfeits per-row selection IDs (no native cross-filter / drillthrough / tooltips at the row grain).

This is the third of three architectural work packages (WP-A: categorical mapping, shipped 2.0.0; WP-B: render lifecycle modes, shipped 2.0.0; **WP-C: this**). WP-B was deliberately built as the seam this package extends — *"its `.data().join(key)` is the exact primitive Reconcile needs"* and the orchestrator is *"the seam WP-C will build on"* ([WP-B brainstorm L17, L39](2026-06-13-render-lifecycle-modes.md#L17)).

## Users and outcome

**Primary users:**

- A report author who wants to **wrap static HTML** around the rendered rows — a heading/footer, or a styled container (#127, iwaumans).
- A report author who wants to **compose structural HTML across rows** — a `<table>`/`<ul>` whose rows are the granularity grain — without hitting the per-row parse limitation or the single-measure character cap (#138, jdusek92; #127, Shadowfita's character-limit angle).
- A report author who wants **per-row structural variation driven by DAX** — e.g. a different row wrapper for "overdue" vs "ok" rows (#127, mlongoria's task board).

**Outcome that changes for them:**

- Today: the only authoring surface is the content measure itself; structure that spans or wraps rows is impossible at the row grain.
- After this change: a **Templates** card exposes a **Body template** (wraps all rows) and a **Row template** (wraps each row), each authorable as static text **or** driven from a DAX measure via conditional formatting; the row template additionally varies **per row** via selector-based conditional formatting. The output is assembled as one structure and built through the DOM, so tables/lists work and the row grain still carries selection IDs. WP-B reconcile still preserves unchanged rows (iframes survive) under custom templates.

## Goals

1. A **Templates** card with two `text` properties: **Body template** (token `{{content}}`) and **Row template** (token `{{row}}`). Both support conditional formatting; the row template additionally supports **selector-based (per-row)** conditional formatting.
2. **Defaults reproduce current output byte-for-byte.** Body default `{{content}}` (no wrapper; rows go directly into `#htmlContent` as today). Row default `<div><div>{{row}}</div></div>` (outer becomes the `.htmlViewerEntry` keyed node; inner div preserves today's `.htmlViewerEntry > div` structure). Existing reports and custom stylesheets are unaffected.
3. **Solve #138.** Structural HTML spanning rows (e.g. `<table>`) renders correctly by parsing every template/content string **in its correct content model** (`Range.createContextualFragment` against the live container) rather than as standalone concatenated fragments — so the browser never auto-closes a stray tag.
4. **Preserve WP-B reconcile under custom templates.** This *extends* the identity-keyed join rather than replacing it: unchanged rows (and their iframes) survive updates; only entered/changed rows are re-rendered and re-sanitized; the orchestrator's decision logic is untouched.
5. **Zero sanitizer-rule churn.** Templates are untrusted HTML (static text *and* DAX/CF strings) routed through the existing [sanitize-pipeline.ts](../../src/sanitize-pipeline.ts) / DOMPurify path. No change to the DOMPurify config, `docs/sanitization-rules.md`, or `test-uat/*.csv`.
6. **No new data role, no new privileges.** CF text values (incl. per-row) are read from the dataView via the documented `objects` path; `"privileges": []` stays. Certification-safe.

## Non-goals

- **Field-direct template binding.** Not available at `powerbi-visuals-api` 5.11.0 — `VisualEnumerationInstanceKinds` has only `Constant` / `Rule` / `ConstantOrRule`; no `…OrField` kind exists. Authors drive templates via the fx **rule editor** (a DAX measure returning the HTML), not by dropping a field on the property. This matches the #127/#138 design intent exactly.
- **A general template language** (loops, conditionals, partials, a handlebars/mustache runtime). v1 is two tokens + CF. Handlebars was floated on #127 and judged overkill; the granularity grain already provides row iteration.
- **A standalone "disable auto-closing tags" toggle** (#138's literal ask). Solved structurally by the template engine instead, per the maintainer's #138 reply — no toggle is exposed.
- **Escaping literal token text *inside a template*** (an author who wants the characters `{{row}}` to appear as text in their template markup). Rare; documented limitation in v1. Author *content* that contains the tokens is handled safely (see Decision 2).
- **Multi-root row templates as a first-class shape.** A row template must resolve to a single root element; non-conforming templates degrade gracefully (Decision 5).
- **Bundle diet, #153 (highlight), #47 (draggable).** Separate work.

## Key technical decisions

These were settled during brainstorming; rationale captured inline.

1. **Default row template = `<div><div>{{row}}</div></div>` (byte-identical), not `<div>{{row}}</div>`.** Today's row DOM is two divs (`.htmlViewerEntry` > inner `<div>` > content). A single-div default would drop the inner wrapper and break custom stylesheets targeting `.htmlViewerEntry > div`. The two-div default reproduces today exactly; the only cost is a slightly redundant-looking default value in the pane. (Cleaner single-div + a release-note breaking change was the considered alternative; byte-identical won for a certified, compat-sensitive visual.) **Confirmed by the maintainer:** the two-div setup, though redundant for a data row, has been the established structure for ~6 years and authors rely on it — it stays as the default.
2. **Tokens `{{content}}` / `{{row}}` (handlebars-style); substituted as plain strings *before* any parse/sanitize, via a whitespace-tolerant function replacer.** Chosen over `{%…%}` because `{{…}}` is the most recognizable placeholder syntax for users and aligns with any future handlebars-style expansion (floated on #127). Substitution uses `replace(/\{\{\s*row\s*\}\}/g, () => value)` — the function replacer never re-interprets `$` or re-scans the inserted value, so author *content* containing the tokens is inert automatically, and optional inner whitespace (`{{ row }}`) is tolerated. Because substitution happens before parsing, the tokens **never reach the sanitizer** (Decision 6) — they can't be stripped and need no special rules. Literal token text *inside a template* is not escapable in v1 (non-goal).
3. **Body CF is single-value; per-row (selector) CF is row-template-only.** The body template applies once, so it resolves from `dataView.metadata.objects` (the fx "apply to all" value). The row template resolves **per row** from `dataView.categorical.categories[i].objects[rowIndex]`, falling back to `metadata.objects`, then the code default. This is exactly the supported pattern (research-confirmed; the visual already ships `ConstantOrRule` text CF on `stylesheet`/`noDataMessage`).
4. **`format: markdown` applies only to row *content*, never to template markup.** Per row: convert content markdown→HTML first, substitute into `{{row}}`, then the surrounding template markup is parsed as HTML. Templates are structural and always HTML.
5. **Row template must resolve to exactly one root element** (it becomes the keyed `.htmlViewerEntry` node, 1:1 with the data row). A template that parses to ≠1 root degrades to wrapping its output in the default `<div class="htmlViewerEntry">` (still renders; not a clean table row) and is documented.
6. **Sanitization stays per-changed-row (extends WP-B), via in-context parse + in-place sanitize.** WP-B's explicit guarantee — *"skipping parse+sanitize for unchanged entries"* ([WP-B L71](2026-06-13-render-lifecycle-modes.md#L71)) — is preserved: only entered/content-changed rows are (re)sanitized. Each row/body string is parsed in its correct content model with `Range.createContextualFragment` (against the live container) and then sanitized **in place** (`DOMPurify.sanitize(node, { IN_PLACE: true })`), so a `<tr>` is handled as table markup rather than foster-parented. The body template is parsed/sanitized once per rebuild. The DOMPurify ruleset is unchanged.

## Approach (recommended): a template engine layered onto the WP-B seam

WP-C is an **extension** of WP-B's orchestrator + identity-keyed join, not a new render path. The mapping:

| WP-B piece (today) | WP-C change |
|---|---|
| `RenderOrchestrator.render()` decision logic ([render-orchestrator.ts:72](../../src/render-orchestrator.ts#L72)) | **unchanged** — still classifies entry-affecting vs viewport-only and picks rebuild/reconcile |
| `computeRenderFingerprint` ([render-orchestrator.ts:19](../../src/render-orchestrator.ts#L19)) | **extend** with the resolved body-template value and the static row-template value — a static template edit forces a clean rebuild, as `format`/`renderMode` already do. Per-row CF-driven row-template variation is caught by the per-row content-diff (below), **not** the global fingerprint |
| keyed join in `reconcileVisualDataToDom` ([domain-utils.ts:532](../../src/domain-utils.ts#L532)) | **algorithm unchanged**; `enter().append('div')` generalizes to append the row template's **root element**, with `htmlViewerEntry` injected onto it |
| render step `resolveHtmlGroupElement` ([domain-utils.ts:290](../../src/domain-utils.ts#L290)) — already an injected `RenderSteps` closure | **swapped** to: substitute the (markdown-resolved) content into the row-template string, parse it in the container's content model (`createContextualFragment`), and sanitize in place |
| join container = `#htmlContent` ([visual.ts:109](../../src/visual.ts#L109)) | for a custom body template: parse it once into `#htmlContent`; the `{{content}}` insertion point (located via a transient comment marker) becomes the **persistent** join container (cached across updates, re-established only on rebuild). Default body template → container stays `#htmlContent` (no wrapper) |
| content-diff stamp `__renderedContent` ([domain-utils.ts:494](../../src/domain-utils.ts#L494)) | diff against the resolved **(row-template ⊕ content)** per-row string, so a selector-based template change also invalidates that row |

### 1. Template resolution (pure, testable)

A new module — call it `src/template-engine.ts` — owns the pure parts, mirroring WP-A/WP-B's "extract the decisions as pure functions" pattern:

- `resolveBodyTemplate(settings, dataView)` → the single body-template string (CF from `metadata.objects`, else static value, else default `{{content}}`).
- `resolveRowTemplate(rowIndex, settings, dataView)` → the per-row row-template string (CF from `categories[i].objects[rowIndex]`, else `metadata.objects`, else default).
- `substitute(template, token, value)` → whitespace-tolerant function-replacer (no `$` re-interpretation, no re-scan).
- `assembleRowHtml(rowTemplate, contentHtml)` and the `{{content}}` location logic.

These are unit-tested without a DOM or host (the const-enum/value-shim caveat from WP-B does not apply here — no `VisualUpdateType` use).

The resolved templates are carried on the view model (the row template string joins each `IHtmlEntry`, since it can vary per row). The CF read slots into the existing per-row loop in [categorical-table.ts:44-82](../../src/categorical-table.ts#L44-L82) / [view-model.ts:140](../../src/view-model.ts#L140) via `dataViewObjects.getValue<string>(cat.objects?.[i], PROP, default)`.

### 2. Rendering: substitute-then-parse-in-context (the #138 fix)

Tokens are plain string markers, substituted into the template strings **before any HTML parsing or sanitization** — so they never reach DOMPurify (Decisions 2/6). Parsing then happens **in the correct content model** via `Range.createContextualFragment`, which parses an HTML string using a live container node as its context — so a `<tr>` string parses as a table row, not a foster-parented fragment.

On **rebuild** (first render, body-template change, or any fingerprint change):

1. Custom body template: substitute `{{content}}` → a transient HTML **comment marker** (`<!--HC:CONTENT-->`, valid in every content model incl. table contexts, unlike a bare token which foster-parents out of `<tbody>`). Parse the body in the `#htmlContent` context, find the marker, record its parent as the **join container** and its position, remove the marker, then sanitize the body subtree **in place** (`DOMPurify.sanitize(node, { IN_PLACE: true })`). Cache the container. Default body template → container stays `#htmlContent`, no wrapper parsed.

Per row that must (re)render — **entered + content-changed only** (WP-B's skip-unchanged is preserved):

2. Build the row string: substitute `{{row}}` → the row's content (markdown→HTML first if `format: markdown`).
3. Parse it in the join container's context (`createContextualFragment`), so `<tr>`/`<td>` resolve correctly; sanitize the parsed node **in place**. Its single root becomes the `.htmlViewerEntry` keyed node (Decision 5).
4. The keyed d3 join runs on the container's children (`container.selectAll('.htmlViewerEntry').data(data, key)`); entered/changed rows adopt the freshly parsed+sanitized node, unchanged rows keep their live node.
5. `.htmlViewerEntry` + selection/hover/tooltip/dimming bind to the row's root element exactly as today.

**Why auto-closing disappears:** every string is parsed in its correct content model (`createContextualFragment` against the live container), never as a standalone concatenated fragment — so the browser never auto-closes a `<table>`/`<tr>`. The `<table>` comes from the body template; each row string (`<tr>…<td>…</td>…</tr>`) is parsed in the `<tbody>` context.

**Reconcile** is WP-B unchanged in shape: unchanged-key rows are retained (DOM node + iframe survive), changed/new rows re-rendered, exited rows removed, `.order()` applied. The persistent join container means the live `<tbody>` and its keyed `<tr>`s carry across data-only updates. A body-template change is a fingerprint change → clean rebuild (acceptable; template edits are interactive and rare).

### 3. Conditional formatting

- **Capabilities:** a new `templates` object (the "Templates" card, per the #127 design) with two `text` properties — `bodyTemplate`, `rowTemplate` — each `{"type": {"text": true}}`.
- **Slices** ([visual-settings.ts](../../src/visual-settings.ts)): `formattingSettings.TextArea` with `instanceKind: ConstantOrRule`. The row-template slice adds `selector: createDataViewWildcardSelector(InstancesOnly)` + `altConstantSelector` to offer both a single default and a per-row rule.
- **Read path** (net-new; `src/` reads no `.objects` today): `dataViewObjects.getValue<string>(...)` from `metadata.objects` (body, single) and `categorical.categories[i].objects[rowIndex]` (row, per-row), via `powerbi-visuals-utils-dataviewutils`.
- **Security:** CF strings are untrusted and rendered as HTML → routed through the existing sanitizer exactly like bound content.
- **Versions (research-confirmed):** `powerbi-visuals-api` 5.11.0, `powerbi-visuals-utils-formattingmodel` 6.0.1, `…-dataviewutils` 6.1.0 — all capabilities available; `noDataMessage`/`stylesheet` are working in-repo proof of `ConstantOrRule` text CF.

### 4. Sanitization & security

- Untrusted inputs: bound content (today), **plus** body/row template strings (static text and CF/DAX). All flow through [sanitize-pipeline.ts](../../src/sanitize-pipeline.ts); **no rule changes**.
- **Tokens never reach the sanitizer.** `{{content}}`/`{{row}}` are substituted into the template strings *before* parsing; DOMPurify only ever sees token-free, content-model-valid markup. So the token syntax can never be "sanitized away" and needs no special sanitizer rules (the brace characters aren't HTML-special regardless).
- Sanitization is **per-changed-row** (preserving WP-B's skip-unchanged guarantee) and **once-per-rebuild** for the body template, performed **in place** (`DOMPurify.sanitize(node, { IN_PLACE: true })`) on nodes already parsed in their correct content model — so a `<tr>`/`<td>` row is sanitized as table markup, not foster-parented. This needs a small `sanitize-pipeline` entry point that sanitizes an existing node in place (today's `getParsedHtmlAsDom` only takes a string); the DOMPurify config is unchanged.
- `showRawHtml` reflects the assembled, sanitized live DOM via the existing [getRawHtml](../../src/domain-utils.ts#L575) walker — no special-casing needed.

### 5. Error handling & edge cases

- **All-or-nothing envelope** unchanged: any throw (a malformed template, a sanitizer edge) propagates to the outer `catch` → `renderingFailed` + content wipe + status; `orchestrator.reset()` already clears cached render state so the next update rebuilds.
- **Persistent join container** must be cached like `scrollbars`/`dataElements` and invalidated on rebuild; a stale container reference after a kind transition (populated ↔ no-data ↔ raw) must reset (extends the WP-B `lastKind` tracking).
- **Default templates** route through the same engine with the container = `#htmlContent` and the two-div row node → identical paint and identical reconcile behavior to WP-B.
- **`{{content}}` insertion-point location** is resolved by the transient comment-marker mechanism (§2): the marker is valid in every content model, located after an in-context parse, and removed before in-place sanitization — no bare token is ever parsed.
- **Multi-root / empty row template** → default-wrapper fallback (Decision 5).
- **Selector-based row template + reconcile:** the content-diff baseline includes the resolved row template, so flipping a row's template via CF re-renders just that row.

### 6. Testing strategy

1. **Template resolution (unit):** body single-value vs default; row per-row vs metadata vs default; CF read from a mocked `categorical.objects[i]`.
2. **Substitution (unit):** function-replacer (whitespace-tolerant, no re-scan); content containing literal tokens stays inert; `$`-bearing content not mis-expanded; multiple `{{content}}` occurrences.
3. **Keyed join with template roots (jsdom):** extend the WP-B DOM-binding test — bind `[a,b,c]` with a custom row root (`<tr>`), capture node references, re-bind `[a,b',c]`, assert a/c retained (iframe-survival proof) and b re-rendered; `[a,c]` proves exit; assert `.htmlViewerEntry` lands on the template root.
4. **Table assembly (jsdom + Playwright):** body `<table><tbody>{{content}}</tbody></table>` + row `<tr>{{row}}</tr>` + content `<td>` → one valid `<table>`, no stray auto-closed tags, no wrapper divs inside `<tbody>`.
5. **Iframe survival under templates (Playwright):** iframe in a templated cell; data update with unchanged content → same iframe node, no reload; content change → re-render.
6. **Sanitization parity:** template-borne dangerous markup is stripped identically to bound content; **zero** `test-uat/*.csv` / `docs/sanitization-rules.md` regen.
7. **Backward-compat parity:** default templates → existing suite green (lorem, hyperlinks, stylesheet, body-styling, WP-B reconcile/classify tests) unchanged; `docs:check` green.
8. **Manual UAT (Power BI Desktop):** static body wrap; `<table>` across granularity (#138); per-row row template via CF rule (mlongoria's overdue/ok); body CF from a measure; markdown content inside a templated cell; raw-HTML toggle; empty↔populated transitions; reconcile + iframe across refresh/cross-filter/resize; dev-visual/AppSource-swap caution.

## Migration and compatibility

- **Defaults reproduce current output byte-for-byte** (Decision 1, Goal 2): body `{{content}}`, row `<div><div>{{row}}</div></div>`. Saved reports render identically; opting into templates is an explicit author choice.
- All three editions (lite, standard, standalone) inherit the new properties from shared `capabilities.json`.
- **Zero sanitizer-surface churn** — no `docs/sanitization-rules.md` regen, no UAT CSV regen; templates reuse the existing pipeline.
- New string resources (`Objects_Templates_*`, property + token help text) added to `stringResources/en-US/resources.resjson`.
- Reconcile semantics under default templates are identical to WP-B; under custom templates, reconcile still preserves unchanged rows.

## Risks

- **In-context parse + in-place sanitize** (`createContextualFragment` + `DOMPurify IN_PLACE`) is the load-bearing primitive; it must be proven to (a) preserve table/list structure and (b) strip dangerous markup identically to the neutral-context path. Mitigation: add template-context sanitization *tests* in the unit/Playwright suites (new assertions only — **not** a regen of the rule-encoding `test-uat/*.csv` corpus, and no DOMPurify rule change). Table tags are already in the allowlist, so this is a routing proof, not a rule extension.
- **`createContextualFragment` availability** — universal in evergreen browsers and Power BI's embedded Chromium; no polyfill needed.
- **CF read is net-new code** (`src/` reads no `.objects` today). Mitigation: wire into the existing per-row loop; unit-test the read with mocked objects bags.
- **Scope:** full CF + selectors is the widest of the three options considered. Mitigation: the pure resolution layer, the rendering layer, and the CF layer are separable implementation units; CF could ship a release after the render engine if needed without rework.

## Follow-up work

- **Advanced template language** (conditionals/loops/partials) if demand emerges — explicitly deferred.
- **Token escaping inside templates** if authors hit it.
- **Per-row context coverage beyond table-family** (e.g. `<select><option>`) if a real use case appears.
- **#124** (free dimension/measure layouts) could now be revisited as an *additive* data role feeding the content grain, per the WP-A note — non-breaking, not a mapping change.
