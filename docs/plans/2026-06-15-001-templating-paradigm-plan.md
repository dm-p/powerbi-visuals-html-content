---
title: 'feat: templating paradigm (Templates card + in-context render)'
type: feat
status: approved
date: 2026-06-15
origin: docs/brainstorms/2026-06-15-templating-paradigm.md
---

# feat: templating paradigm (Templates card + in-context render)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan unit-by-unit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Templates** card (Body + Row templates, static or DAX-driven via conditional formatting, row template per-row via selector CF) that lets authors wrap and compose structural HTML (e.g. a `<table>` across granularity rows), rendered by substituting tokens into the template strings then parsing each string **in its correct content model** — extending WP-B's orchestrator + identity-keyed reconcile rather than replacing it.

**Architecture:** Tokens `{{content}}`/`{{row}}` are substituted into the template strings (whitespace-tolerant function replacer) **before** any parse/sanitize, so they never reach DOMPurify. Each resulting string is parsed with `Range.createContextualFragment` against the live join container (so `<tr>` parses as a table row) and sanitized **in place** (`DOMPurify IN_PLACE`). The body template's `{{content}}` slot is located via a transient HTML comment marker and becomes the persistent keyed-join container. WP-B's `computeRenderFingerprint` / orchestrator dispatch / content-diff carry forward; default templates reproduce today's DOM byte-for-byte.

**Tech Stack:** TypeScript, powerbi-visuals-api 5.11.0, powerbi-visuals-utils-formattingmodel 6.0.1, powerbi-visuals-utils-dataviewutils 6.1.0, d3-selection, DOMPurify, marked, vitest (jsdom), Playwright, pbiviz.

---

## Summary

Today each row's content is parsed independently into a `.htmlViewerEntry` > inner `<div>` node ([resolveHtmlGroupElement](../../src/domain-utils.ts#L290)), so structural HTML spanning rows is impossible (the browser auto-closes per-row tags) and there is no way to wrap static markup around the output. This plan adds a **Templates** card with `bodyTemplate` (`{{content}}` token) and `rowTemplate` (`{{row}}` token) text properties — both conditional-formattable, the row template per-row via a wildcard selector — and a render path that assembles by **token substitution → in-context parse → in-place sanitize**, so a `<table>` body + `<tr>` row + `<td>` content compose into one valid table while each row stays an identity-keyed node that reconcile can preserve (iframes survive). Eight units: property plumbing → pure template engine → CF data wiring → in-context sanitize entry point → body-container resolution → templated row render + generalized reconcile → orchestrator wiring → verification gate. Defaults reproduce current output byte-for-byte; zero sanitizer-rule churn throughout.

---

## Problem Frame

`resolveHtmlGroupElement` ([domain-utils.ts:290-309](../../src/domain-utils.ts#L290-L309)) appends a `<div>` per entry and parses `d.content` into it independently; `bindVisualDataToDom`/`reconcileVisualDataToDom` ([domain-utils.ts:455-559](../../src/domain-utils.ts#L455-L559)) hard-code a `<div class="htmlViewerEntry">` row root and a `#htmlContent` join container. This forecloses #127 (wrap static HTML around output) and #138 (a `<table>` whose granularity rows are its `<tr>`s — the per-row independent parse auto-closes tags and the wrapper divs break table semantics). Full rationale, users, goals, non-goals, and the six key technical decisions: [origin brainstorm](../brainstorms/2026-06-15-templating-paradigm.md).

---

## Requirements

- R1. A **Templates** card (`templates` object) with `bodyTemplate` (token `{{content}}`) and `rowTemplate` (token `{{row}}`) `text` properties, localized. Defaults: body `{{content}}`, row `<div><div>{{row}}</div></div>` — reproducing today's output byte-for-byte. *(origin: Goals 1–2, Decision 1)*
- R2. Tokens are substituted as plain strings **before** any parse/sanitize via a whitespace-tolerant function replacer that never re-scans the inserted value; tokens never reach the sanitizer. *(origin: Decision 2)*
- R3. Structural HTML spanning rows renders correctly: every template/content string is parsed in its correct content model (`Range.createContextualFragment` against the live container), never as a standalone fragment. *(origin: Goal 3, Decision 6)*
- R4. Reconcile is preserved under custom templates: a row's DOM node (and its iframe) survives when its identity persists and its resolved `(rowTemplate ⊕ content)` is unchanged; changed/entered rows re-render; removed rows exit. *(origin: Goal 4)*
- R5. Conditional formatting: `bodyTemplate` is single-value CF (from `metadata.objects`); `rowTemplate` is per-row selector CF (read `categorical.categories[i].objects[rowIndex]` → `metadata.objects` → code default). *(origin: Goal 1, Decision 3)*
- R6. Sanitization is per-changed-row (body once per rebuild), performed **in place** (`DOMPurify IN_PLACE`) on nodes already parsed in their content model; the DOMPurify ruleset is unchanged. *(origin: Decision 6, Goal 5)*
- R7. `format: markdown` applies only to row *content* (content → HTML before `{{row}}` substitution); templates are always HTML. *(origin: Decision 4)*
- R8. A row template must resolve to exactly one root element (it becomes the `.htmlViewerEntry` keyed node); a non-conforming template degrades to a `<div class="htmlViewerEntry">` wrapper. *(origin: Decision 5)*
- R9. `computeRenderFingerprint` includes the resolved body-template and the static row-template value (per-row CF variation is caught by the per-row content-diff, not the fingerprint); the join container is cached and re-established only on rebuild. *(origin: mapping table)*
- R10. Zero sanitizer-rule churn (`docs/sanitization-rules.md` and `test-uat/*.csv` untouched; DOMPurify config unchanged); all three editions package; existing unit + integration suites stay green. *(origin: Goals 5–6)*

---

## Scope Boundaries

- No **field-direct** template binding — not available at API 5.11.0 (`VisualEnumerationInstanceKinds` has only `Constant`/`Rule`/`ConstantOrRule`). Authors drive templates via the fx rule editor (a DAX measure).
- No general template language (loops, conditionals, partials, a handlebars runtime). v1 is two tokens + CF.
- No escaping of literal token text *inside* a template (documented limitation).
- No standalone "disable auto-closing tags" toggle (#138's literal ask) — solved structurally.
- Multi-root row templates degrade gracefully; not a first-class shape.
- No bundle diet, #153 (highlight), #47 (draggable).
- No change to the DOMPurify ruleset, the CSS sanitizer, or the sanitizer fixture corpus (`test-uat/*.csv`).

---

## Context & Research

### Relevant Code and Patterns

- [src/visual.ts:202-308](../../src/visual.ts#L202-L308) — `buildRenderSteps()` returns the injected `RenderSteps` closures (`resolveContainer`, `renderEmptyOrRaw`, `rebuild`, `reconcile`, `bindInteractivity`). `rebuild`/`reconcile` call `bindVisualDataToDom`/`reconcileVisualDataToDom` + `resolveHtmlGroupElement` + `stampRenderedContent` + `finalizePopulatedRender`. These closures are the wiring surface for U7.
- [src/visual.ts:318-336](../../src/visual.ts#L318-L336) — `finalizePopulatedRender(merged, viewModel, settings)`: raw-HTML view, capture `this.dataElements`, hover, hyperlink delegation. Unchanged by this plan; both render paths still call it.
- [src/domain-utils.ts:290-309](../../src/domain-utils.ts#L290-L309) — `resolveHtmlGroupElement(dataElements, format, allowHyperlinks)`: today's per-entry parse. Generalized into the template render in U6.
- [src/domain-utils.ts:455-472](../../src/domain-utils.ts#L455-L472) — `bindVisualDataToDom`; [532-559](../../src/domain-utils.ts#L532-L559) — `reconcileVisualDataToDom` (keyed join, `{merged, toRender}`), [494-498](../../src/domain-utils.ts#L494-L498) — `stampRenderedContent`. The keyed-join shape and content stamp are carried forward by U6.
- [src/sanitize-pipeline.ts:239-253](../../src/sanitize-pipeline.ts#L239-L253) — `getParsedHtmlAsDom(content, format, options)`: already binds `Range.prototype.createContextualFragment` to a **document-level** range (no element context) and runs `getSanitizedContent` (string→string). U4 adds an element-context + in-place variant.
- [src/sanitize-pipeline.ts:258-742](../../src/sanitize-pipeline.ts#L258-L742) — `getSanitizedContent`: registers `uponSanitizeAttribute`/`uponSanitizeElement` hooks, runs `preprocessStyleTags`, builds `dpConfig` (note `IN_PLACE: false` at [729](../../src/sanitize-pipeline.ts#L729)), `purify.sanitize(preprocessed, dpConfig)`. U4 extracts the hook-registration + config so a node/in-place path can reuse it (DRY) without changing any rule.
- [src/visual-settings.ts:104-117](../../src/visual-settings.ts#L104-L117) — `ContentFormattingCardNoData.noDataMessage` and [186-197](../../src/visual-settings.ts#L186-L197) `StylesheetCardMain.stylesheet`: working examples of `formattingSettings.TextArea({ name, value, selector: undefined, instanceKind: ConstantOrRule })` — the exact template for the **single-value** CF body property. The composite-card pattern (`FormattingSettingsCompositeCard` + `Group`, `cards = [...]`) at [12-16, 41-54, 178-197](../../src/visual-settings.ts#L12-L16) is the template for the Templates card.
- [src/categorical-table.ts:44-82](../../src/categorical-table.ts#L44-L82) — `mapCategoricalToTable`: the per-row loop (`for i in 0..rowCount`) building `rows` + `identities`. U3 adds a per-row `objects` bag here.
- [src/view-model.ts:103-162](../../src/view-model.ts#L103-L162) — `mapDataView`: maps each row to `IHtmlEntry`. U3 resolves the per-row `rowTemplate` here and the single `bodyTemplate` onto the view model.
- [src/render-orchestrator.ts:19-38](../../src/render-orchestrator.ts#L19-L38) — `computeRenderFingerprint`; U7 appends the template values.
- [src/visual-constants.ts:215-237](../../src/visual-constants.ts#L215-L237) — `dom` selectors (`contentIdSelector` = `htmlContent`, `entryClassSelector` = `htmlViewerEntry`). U5 adds a marker/anchor constant.
- [capabilities.json:29-119](../../capabilities.json#L29-L119) — `objects`; add a `templates` object. [test/domain-utils.test.ts](../../test/domain-utils.test.ts) and [test/render-orchestrator.test.ts](../../test/render-orchestrator.test.ts) — the jsdom + d3 binding-test and value-shim patterns to mirror.

### Key API facts

- **Conditional formatting (research-confirmed at installed versions).** CF can be applied to `text` properties (MS docs: "Color, Text, Icon, Web URL"); this repo already ships it on `noDataMessage`/`stylesheet` via `instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule`. There is **no field-binding kind** at API 5.11.0 (`VisualEnumerationInstanceKinds` = `Constant | Rule | ConstantOrRule` only). Single/static CF value → `dataView.metadata.objects`; per-row CF value → `dataView.categorical.categories[i].objects[rowIndex]` (`DataViewCategoricalColumn.objects?: DataViewObjects[]`, index-aligned to the column's `values`). Read with `dataViewObjects.getValue<string>(bag, { objectName, propertyName }, defaultValue)` from `powerbi-visuals-utils-dataviewutils` (6.1.0 — no `getCategoricalObjectValue` helper; index the array yourself). Per-row "apply to each value" requires `selector = dataViewWildcard.createDataViewWildcardSelector(DataViewWildcardMatchingOption.InstancesOnly)` plus `altConstantSelector` for the static default; certification-safe (no privilege/network surface).
- **`Range.createContextualFragment(html)`** parses `html` using the range's start node as the **context element** — so a range positioned inside a live `<tbody>` parses `<tr>...</tr>` as a real table row instead of foster-parenting it. Universal in evergreen browsers and Power BI's embedded Chromium; jsdom supports it (used today at [sanitize-pipeline.ts:244](../../src/sanitize-pipeline.ts#L244)). The current call uses `document.createRange()` with no position → document context; the new entry point sets the range inside the target container.
- **`DOMPurify.sanitize(node, { IN_PLACE: true })`** sanitizes an existing DOM node's subtree in place and returns it, running the same hooks. The repo's `dpConfig` already declares `IN_PLACE: false` ([sanitize-pipeline.ts:729](../../src/sanitize-pipeline.ts#L729)); the node path flips it to `true`. `preprocessStyleTags` is a string pass — the node path runs it on the string *before* `createContextualFragment`, and the `uponSanitizeElement` `<style>` backstop ([sanitize-pipeline.ts:654-664](../../src/sanitize-pipeline.ts#L654-L664)) still fires on the node path.
- **`VisualUpdateType` is a `const enum`** esbuild/vitest does not inline across modules (WP-B learning, [docs/solutions/tooling-decisions/esbuild-vitest-const-enum-external-dts-not-inlined-2026-06-15.md](../solutions/tooling-decisions/esbuild-vitest-const-enum-external-dts-not-inlined-2026-06-15.md)) — but this plan adds no new `VisualUpdateType` use, so the trap doesn't recur. The fingerprint extension is plain string work.
- **d3 `selection.append(fn)`** accepts a creator *function* returning the element to append, so `enter().append(d => buildRowRoot(...))` adopts an externally-built (parsed + sanitized) row root.

### Institutional Learnings

- [docs/solutions/design-patterns/identity-keyed-dom-reconcile-stateful-entries-2026-06-15.md](../solutions/design-patterns/identity-keyed-dom-reconcile-stateful-entries-2026-06-15.md) — the WP-B reconcile pattern this plan generalizes (key on `identity.getKey()`, content-stamp, render only the changed subset).
- [docs/solutions/performance-issues/mapdataview-per-row-formatters-quadratic-selection-2026-06-12.md](../solutions/performance-issues/mapdataview-per-row-formatters-quadratic-selection-2026-06-12.md) — keep per-row work O(1); resolve templates once per row in the existing map loop, not per render.
- No existing solution doc covers templating; a new learning is expected post-merge via `/ce-compound`.

---

## Key Technical Decisions

- **Substitute-then-parse-in-context (the load-bearing decision).** Tokens are replaced in the template *strings* before parsing, so the sanitizer only ever sees token-free, content-model-valid markup; the brace chars never need special handling. Parsing in-context (`createContextualFragment` against the live container) + in-place sanitize is what makes a `<tr>` survive AND keeps each row an identity-keyed node for reconcile. (Decisions 2, 6.)
- **Extend WP-B, don't fork.** The orchestrator dispatch and the keyed-join algorithm are unchanged; `enter()` generalizes from a fixed `<div>` to the row-template root, `resolveHtmlGroupElement` becomes the templated render, and the join container generalizes from `#htmlContent` to the body slot. The default-template case is the trivial case and reproduces today's DOM, so the WP-B behavioural tests stay green; the few unit tests that call the old signatures are updated in-place.
- **Default templates reproduce today byte-for-byte.** Body `{{content}}` → no wrapper, rows go straight into `#htmlContent` (join container = `#htmlContent`, no body parse). Row `<div><div>{{row}}</div></div>` → outer `<div>` gets `.htmlViewerEntry`, inner `<div>` preserves the current `.htmlViewerEntry > div` nesting. (Decision 1, maintainer-confirmed.)
- **Body slot via transient comment marker.** `{{content}}` → `<!--HC:CONTENT-->` (valid in every content model, unlike a bare token in `<tbody>`); parse in `#htmlContent` context, locate the comment, record its parent as the join container, drop in a persistent visual-owned anchor at that position, remove the comment, then in-place sanitize the body. Entered rows insert before the anchor so static siblings (header/footer) keep their position. (Decision 6 / §5.)
- **Content-diff key = `(rowTemplate ⊕ content)`.** `__renderedContent` stores `rowTemplate + ' ' + content` (raw, pre-markdown) so a selector-CF template change re-renders just that row; a `format` change forces a rebuild via the fingerprint, so markdown need not enter the diff key.
- **CF property placement.** `bodyTemplate`: `selector: undefined` + `ConstantOrRule` (single value from `metadata.objects`). `rowTemplate`: `createDataViewWildcardSelector(InstancesOnly)` + `altConstantSelector` + `ConstantOrRule` (per-row from the column `objects[]`, else metadata, else default).
- **Single render path.** No "is this a custom template" branch in the orchestrator: default and custom both flow through the template render. This is the cleanest reading of "WP-B survives WP-C" and removes drift risk; the parity guarantee is the byte-identical default plus the existing suite staying green.

---

## Open Questions

### Resolved During Planning

- *Can a `text` property carry per-row DAX values?* Yes — `ConstantOrRule` + wildcard selector; values land on `categorical.categories[i].objects[rowIndex]`. Confirmed against installed source (api 5.11.0, formattingmodel 6.0.1, dataviewutils 6.1.0). No data role needed.
- *Does the token syntax risk sanitization?* No — substitution precedes parsing, so tokens never reach DOMPurify; brace chars aren't HTML-special regardless.
- *Does the table case need a virtual-DOM diff?* No — `createContextualFragment` against the live container parses `<tr>` correctly, and the existing keyed join transplants unchanged rows.

### Deferred to Implementation

- *Which column carries the per-row `objects` bag* when the content role is a measure vs a grouping. U3 scans categories then values for the first column with an `objects` array; verify in UAT that the CF rule output lands where expected (fall back to scanning all columns if a specific binding misses).
- *In-place sanitize parity with the string path for `<style>` in templates.* U4 runs `preprocessStyleTags` on the string before `createContextualFragment` and relies on the existing `<style>` element-hook backstop; confirm with a fixture that a `<style>` inside a template is sanitized identically. Does not change any rule.
- *Anchor vs sole-child container.* The common slot is the sole content of its parent (`<tbody>{{content}}</tbody>`); the anchor mechanism (U5) additionally supports a slot with static siblings. If UAT shows no real demand for siblings-in-the-same-parent, the anchor can be simplified later — it does not block any goal.
- *`rowTemplate` constant-vs-rule selector wiring.* U1 sets `selector = wildcard` + `altConstantSelector = undefined` + `instanceKind: ConstantOrRule`. Verify in UAT that the fx dialog offers both a global constant and a per-row rule, and that the constant form lands in `metadata.objects` (U3's read order — per-row → metadata → default — already covers both). If the dialog needs a non-undefined `altConstantSelector` to expose the constant option, set it then; it does not change the read path.

---

## High-Level Technical Design

> *Directional guidance for review. **Signatures are binding; exact bodies illustrative** (matching the WP-B plan convention).*

### Pure template engine (`src/template-engine.ts`)

```ts
import powerbi from 'powerbi-visuals-api';
import { dataViewObjects } from 'powerbi-visuals-utils-dataviewutils';
import { VisualConstants } from './visual-constants';
import { VisualFormattingSettingsModel } from './visual-settings';

export const CONTENT_TOKEN = /\{\{\s*content\s*\}\}/g;
export const ROW_TOKEN = /\{\{\s*row\s*\}\}/g;

/** Replace every `token` occurrence with `value`; function replacer => no `$`
 *  interpretation and the inserted value is never re-scanned. */
export function substitute(template: string, token: RegExp, value: string): string {
    return template.replace(token, () => value);
}

const TEMPLATES_OBJECT = 'templates';

/** Single body template: per-`metadata.objects` CF value, else static value, else default. */
export function resolveBodyTemplate(
    dataView: powerbi.DataView | undefined,
    settings: VisualFormattingSettingsModel
): string {
    const fallback = settings.templates.templatesCardMain.bodyTemplate.value;
    return dataViewObjects.getValue<string>(
        dataView?.metadata?.objects,
        { objectName: TEMPLATES_OBJECT, propertyName: 'bodyTemplate' },
        fallback
    );
}

/** Per-row row template: per-row `objects` bag, else metadata.objects, else static value. */
export function resolveRowTemplate(
    rowObjects: powerbi.DataViewObjects | undefined,
    metadataObjects: powerbi.DataViewObjects | undefined,
    settings: VisualFormattingSettingsModel
): string {
    const staticValue = settings.templates.templatesCardMain.rowTemplate.value;
    const id = { objectName: TEMPLATES_OBJECT, propertyName: 'rowTemplate' };
    const metaValue = dataViewObjects.getValue<string>(metadataObjects, id, staticValue);
    return dataViewObjects.getValue<string>(rowObjects, id, metaValue);
}
```

### In-context parse + in-place sanitize (`src/sanitize-pipeline.ts`)

```ts
/** Parse `content` in the content model of `contextEl` (so `<tr>` etc. survive),
 *  then sanitize the parsed node(s) in place. Tokens must already be substituted.
 *  `getSanitizedContent`'s hook registration + dpConfig are extracted into a shared
 *  internal so this path and the string path apply the identical ruleset. */
export const parseAndSanitizeInContext = (
    content: string,
    format: RenderFormat,
    contextEl: Element,
    options?: SanitizeOptions
): DocumentFragment => {
    const converted = format === 'markdown' ? marked.parse(content).toString() : content;
    const preprocessed = config.sanitize ? preprocessStyleTags(converted) : converted;
    const range = document.createRange();
    range.selectNodeContents(contextEl);            // context = contextEl
    const fragment = range.createContextualFragment(preprocessed);
    if (config.sanitize) {
        withSanitizerHooks((purify) =>
            Array.from(fragment.childNodes).forEach((n) => {
                if (n.nodeType === Node.ELEMENT_NODE) {
                    purify.sanitize(n as Element, { ...dpConfig, IN_PLACE: true });
                }
            }, options)
        );
    }
    return fragment;
};
```

### Body-container resolution + templated render (`src/domain-utils.ts`)

```ts
export interface TemplateContainer {
    container: HTMLElement;   // the live keyed-join parent (#htmlContent or the body slot's parent)
    anchor: Comment | null;   // persistent insert-before anchor at the {{content}} slot, or null
}

/** Default body ({{content}}) => { container: rootEl, anchor: null } with no wrapper.
 *  Custom body => parse (comment-marker) into rootEl, locate slot parent + anchor, in-place sanitize. */
export function resolveTemplateContainer(
    rootEl: HTMLElement,
    bodyTemplate: string,
    options: SanitizeOptions
): TemplateContainer;

/** Resolved per-row diff key: rowTemplate joined to raw content (pre-markdown). */
export const rowRenderKey = (d: IHtmlEntry): string => `${d.rowTemplate} ${d.content}`;

export interface TemplatedRenderOptions {
    format: RenderFormat;
    allowHyperlinks: boolean;
    hasSelection: boolean;
}

/** Full (re)build of all rows into `tc.container`. */
export function renderTemplatedEntries(
    tc: TemplateContainer, data: IHtmlEntry[], opts: TemplatedRenderOptions
): Selection<HTMLElement, IHtmlEntry, any, any>;   // returns merged

/** Keyed reconcile: retain unchanged-key rows (iframe survives), (re)build entered/changed. */
export function reconcileTemplatedEntries(
    tc: TemplateContainer, data: IHtmlEntry[], opts: TemplatedRenderOptions
): { merged: Selection<HTMLElement, IHtmlEntry, any, any>; toRender: Selection<HTMLElement, IHtmlEntry, any, any> };
```

`buildRowRoot(container, d, opts)` (shared internal): `const rowHtml = substitute(d.rowTemplate, ROW_TOKEN, d.content)` → `parseAndSanitizeInContext(rowHtml, opts.format, container, { allowHyperlinks })` → take the **single** element root (Decision 5; if `≠1` element root, wrap the fragment in a fresh `<div>`), add `.htmlViewerEntry` (+ `unselected` per `shouldDimPoint`), stash `__renderedContent = rowRenderKey(d)`, return the element. Markdown applies only inside `buildRowRoot` (the content arm), never to template markup.

### Orchestrator fingerprint (`src/render-orchestrator.ts`)

```ts
// append to the computeRenderFingerprint array:
settings.templates.templatesCardMain.bodyTemplate.value,
settings.templates.templatesCardMain.rowTemplate.value,
```

---

## Implementation Units

- [ ] U1. **Templates card property plumbing (additive, defaults reproduce today)**

**Goal:** Add the `templates` capabilities object, the `TemplatesSettings` card + slices, defaults, and localization. Nothing consumes them yet — output is unchanged.

**Requirements:** R1, R5 (declaration only).

**Files:**
- Modify: `capabilities.json` (`objects`)
- Modify: `src/visual-constants.ts` (new `templates` defaults block)
- Modify: `src/visual-settings.ts` (`TemplatesSettings` card + `cards`)
- Modify: `stringResources/en-US/resources.resjson`
- Test: `test/visual-settings.test.ts`

- [ ] **Step 1: Write the failing test** (append to `test/visual-settings.test.ts`)

```ts
describe('TemplatesSettings', () => {
    it('exposes body + row templates with byte-identical defaults', () => {
        const settings = new VisualFormattingSettingsModel();
        const main = settings.templates.templatesCardMain;
        expect(main.bodyTemplate.value).toBe('{{content}}');
        expect(main.rowTemplate.value).toBe('<div><div>{{row}}</div></div>');
        expect(main.slices).toContain(main.bodyTemplate);
        expect(main.slices).toContain(main.rowTemplate);
        expect(settings.cards).toContain(settings.templates);
    });
    it('marks both template slices conditional-formattable', () => {
        const main = new VisualFormattingSettingsModel().templates.templatesCardMain;
        const CR = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;
        expect(main.bodyTemplate.instanceKind).toBe(CR);
        expect(main.rowTemplate.instanceKind).toBe(CR);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/visual-settings.test.ts -t Templates`
Expected: FAIL — `settings.templates` is undefined.

- [ ] **Step 3: Add defaults** — `src/visual-constants.ts`, a new top-level block inside `VisualConstants` (after `stylesheet`)

```ts
templates: {
    body: '{{content}}',
    row: '<div><div>{{row}}</div></div>'
},
```

- [ ] **Step 4: Add the capabilities object** — `capabilities.json`, inside `objects` (after `stylesheet`)

```json
"templates": {
    "properties": {
        "bodyTemplate": { "type": { "text": true } },
        "rowTemplate": { "type": { "text": true } }
    }
},
```

- [ ] **Step 5: Add the settings card** — `src/visual-settings.ts`. Import the wildcard selector, add the card class, and register it in `cards`.

```ts
// top of file, with the other imports:
import { dataViewWildcard } from 'powerbi-visuals-utils-dataviewutils';

// in VisualFormattingSettingsModel:
templates = new TemplatesSettings();
cards = [this.contentFormatting, this.stylesheet, this.crossFilter, this.templates];

// new classes (place after CrossFilterSettings):
export class TemplatesSettings extends FormattingSettingsCompositeCard {
    name = 'templates';
    displayNameKey = 'Objects_Templates';
    descriptionKey = 'Objects_Templates_Description';
    templatesCardMain = new TemplatesCardMain(Object());
    groups: Array<FormattingSettingsGroup> = [this.templatesCardMain];
}

class TemplatesCardMain extends FormattingSettingsGroup {
    name = 'templates-main';
    // Body template: single value (applies once) — static or CF "apply to all".
    bodyTemplate = new formattingSettings.TextArea({
        name: 'bodyTemplate',
        displayNameKey: 'Objects_Templates_BodyTemplate',
        descriptionKey: 'Objects_Templates_BodyTemplate_Description',
        placeholder: '{{content}}',
        value: VisualConstants.templates.body,
        selector: undefined,
        instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule
    });
    // Row template: per-row CF via wildcard selector + a static/default counterpart.
    rowTemplate = new formattingSettings.TextArea({
        name: 'rowTemplate',
        displayNameKey: 'Objects_Templates_RowTemplate',
        descriptionKey: 'Objects_Templates_RowTemplate_Description',
        placeholder: '<div><div>{{row}}</div></div>',
        value: VisualConstants.templates.row,
        selector: dataViewWildcard.createDataViewWildcardSelector(
            dataViewWildcard.DataViewWildcardMatchingOption.InstancesOnly
        ),
        altConstantSelector: undefined,
        instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule
    });
    slices: Array<FormattingSettingsSlice> = [this.bodyTemplate, this.rowTemplate];
}
```

- [ ] **Step 6: Add localization** — `stringResources/en-US/resources.resjson`

```json
"Objects_Templates": "Templates",
"Objects_Templates_Description": "Wrap and compose your content with HTML templates. Use the {{content}} token in the body template to mark where rows go, and the {{row}} token in the row template to mark where each row's value goes.",
"Objects_Templates_BodyTemplate": "Body template",
"Objects_Templates_BodyTemplate_Description": "HTML wrapped around all rows. The {{content}} token marks where the rendered rows are inserted. Supports conditional formatting from a measure.",
"Objects_Templates_RowTemplate": "Row template",
"Objects_Templates_RowTemplate_Description": "HTML wrapped around each row. The {{row}} token marks where the row's value goes. Supports per-row conditional formatting from a measure.",
```

- [ ] **Step 7: Run tests + lint + format**

Run: `npx vitest run test/visual-settings.test.ts -t Templates` → PASS
Run: `npm test` → all green (defaults unused, so existing tests unaffected)
Run: `npm run eslint`
Run: `npx prettier --config .prettierrc --check capabilities.json src/visual-constants.ts src/visual-settings.ts` (use `--write` then re-check if needed; gate the commit on the check's exit code)

- [ ] **Step 8: Commit** (stage explicitly — never `git add -A`; `test-uat/*.tmdl` + `.github/hooks/` WIP must stay unstaged)

```bash
git add capabilities.json src/visual-constants.ts src/visual-settings.ts stringResources/en-US/resources.resjson test/visual-settings.test.ts
git commit -m "feat: add Templates card (body + row template properties, CF-enabled)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

- [ ] U2. **Pure template engine: tokens, substitution, CF resolution**

**Goal:** Create `src/template-engine.ts` with the token regexes, `substitute`, `resolveBodyTemplate`, `resolveRowTemplate` (per High-Level Technical Design). Pure — no DOM, no host.

**Requirements:** R2, R5.

**Files:**
- Create: `src/template-engine.ts`
- Create: `test/template-engine.test.ts`

- [ ] **Step 1: Write failing tests** — `test/template-engine.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { substitute, CONTENT_TOKEN, ROW_TOKEN, resolveRowTemplate } from '../src/template-engine';

describe('substitute', () => {
    it('replaces all occurrences, tolerant of inner whitespace', () => {
        expect(substitute('<tr>{{row}}</tr>', ROW_TOKEN, '<td>x</td>')).toBe('<tr><td>x</td></tr>');
        expect(substitute('{{ content }}{{content}}', CONTENT_TOKEN, 'A')).toBe('AA');
    });
    it('does not re-scan the inserted value (content containing a token is inert)', () => {
        expect(substitute('<i>{{row}}</i>', ROW_TOKEN, 'see {{row}} docs')).toBe('<i>see {{row}} docs</i>');
    });
    it('does not interpret $ in the inserted value', () => {
        expect(substitute('{{row}}', ROW_TOKEN, '$& $1 $$')).toBe('$& $1 $$');
    });
});

describe('resolveRowTemplate', () => {
    const settings = { templates: { templatesCardMain: { rowTemplate: { value: 'DFLT' } } } } as any;
    it('prefers the per-row objects bag, then metadata, then the static value', () => {
        const id = 'templates';
        const row = { [id]: { rowTemplate: 'ROW' } } as any;
        const meta = { [id]: { rowTemplate: 'META' } } as any;
        expect(resolveRowTemplate(row, meta, settings)).toBe('ROW');
        expect(resolveRowTemplate(undefined, meta, settings)).toBe('META');
        expect(resolveRowTemplate(undefined, undefined, settings)).toBe('DFLT');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/template-engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/template-engine.ts`** — exactly as in High-Level Technical Design (token regexes, `substitute`, `resolveBodyTemplate`, `resolveRowTemplate`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/template-engine.test.ts` → PASS

- [ ] **Step 5: Lint, format, commit**

Run: `npm run eslint` ; `npx prettier --config .prettierrc --check src/template-engine.ts test/template-engine.test.ts`

```bash
git add src/template-engine.ts test/template-engine.test.ts
git commit -m "feat: pure template engine (tokens, substitution, CF resolution)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

- [ ] U3. **Per-row CF objects + view-model template resolution**

**Goal:** Surface the per-row `objects` bag from the categorical adapter and resolve `bodyTemplate` (onto the view model) + `rowTemplate` (onto each entry) in `mapDataView`.

**Requirements:** R5, R7 (carries the raw content for later markdown).

**Files:**
- Modify: `src/categorical-table.ts` (`ISimulatedTable`, `mapCategoricalToTable`)
- Modify: `src/view-model.ts` (`IViewModel`, `IHtmlEntry`, `mapDataView`)
- Test: `test/categorical-table.test.ts`, `test/view-model.test.ts` (mirror existing files)

- [ ] **Step 1: Write the failing tests**

```ts
// test/categorical-table.test.ts — add:
it('surfaces a per-row objects bag aligned to row index', () => {
    const objects = [{ templates: { rowTemplate: 'A' } }, undefined];
    const categorical = makeCategorical(/* 2 rows, content category with objects */ { objects });
    const table = mapCategoricalToTable(categorical, host);
    expect(table.objects[0]).toEqual({ templates: { rowTemplate: 'A' } });
    expect(table.objects[1]).toBeUndefined();
});

// test/view-model.test.ts — add:
it('resolves per-row rowTemplate and a single bodyTemplate', () => {
    // dataView with categorical objects on row 0 + metadata.objects.templates.bodyTemplate
    handler.mapDataView([dataView], settingsWithDefaults, host);
    expect(handler.viewModel.bodyTemplate).toBe('<main>{{content}}</main>');
    expect(handler.viewModel.htmlEntries[0].rowTemplate).toBe('<tr>{{row}}</tr>');
    expect(handler.viewModel.htmlEntries[1].rowTemplate).toBe('<div><div>{{row}}</div></div>'); // default
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/categorical-table.test.ts test/view-model.test.ts`
Expected: FAIL — `table.objects` / `viewModel.bodyTemplate` undefined.

- [ ] **Step 3: Extend the simulated table** — `src/categorical-table.ts`

```ts
import DataViewObjects = powerbi.DataViewObjects;
// ISimulatedTable:
objects: (DataViewObjects | undefined)[]; // one per row (CF bag), aligned to rows
// in mapCategoricalToTable, after building columns:
const objectsColumn = [...categories, ...values].find((c) => c.objects);
// in the row loop body (inside for i): collect objects[i]
// after the loop, return { columns, rows, identities, objects }
const objects = Array.from({ length: rowCount }, (_, i) => objectsColumn?.objects?.[i]);
```

- [ ] **Step 4: Resolve templates in the view model** — `src/view-model.ts`

```ts
import { resolveBodyTemplate, resolveRowTemplate } from './template-engine';
// IViewModel: add `bodyTemplate: string;`
// IHtmlEntry: add `rowTemplate: string;`
// reset(): bodyTemplate: VisualConstants.templates.body  (import VisualConstants)
// in mapDataView, after the { columns, rows, identities } destructure, also pull `objects`:
const { columns, rows, identities, objects } = mapCategoricalToTable(dataViews[0].categorical, host);
const metadataObjects = dataViews[0].metadata?.objects;
// per-row map: add rowTemplate to each entry
rowTemplate: resolveRowTemplate(objects[index], metadataObjects, settings),
// after building htmlEntries:
this.viewModel.bodyTemplate = resolveBodyTemplate(dataViews[0], settings);
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run test/categorical-table.test.ts test/view-model.test.ts` → PASS
Run: `npm test` → green (entries now carry `rowTemplate`; nothing renders it yet)

- [ ] **Step 6: Lint, format, commit**

```bash
git add src/categorical-table.ts src/view-model.ts test/categorical-table.test.ts test/view-model.test.ts
git commit -m "feat: resolve per-row row template + single body template in view model

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

- [ ] U4. **In-context parse + in-place sanitize entry point**

**Goal:** Extract the shared sanitizer hooks/config and add `parseAndSanitizeInContext` (per High-Level Technical Design). No rule change — a routing/entry-point addition.

**Requirements:** R3, R6.

**Files:**
- Modify: `src/sanitize-pipeline.ts`
- Test: `test/sanitize-pipeline.test.ts` (or the existing sanitizer unit test file)

- [ ] **Step 1: Write the failing tests**

```ts
import { parseAndSanitizeInContext } from '../src/sanitize-pipeline';

it('parses <tr> in a <tbody> context without foster-parenting', () => {
    const tbody = document.createElement('tbody');
    const frag = parseAndSanitizeInContext('<tr><td>cell</td></tr>', 'html', tbody);
    const tr = frag.firstElementChild!;
    expect(tr.tagName).toBe('TR');
    expect(tr.querySelector('td')?.textContent).toBe('cell');
});
it('strips dangerous markup identically to the string path', () => {
    const div = document.createElement('div');
    const frag = parseAndSanitizeInContext('<img src=x onerror="alert(1)"><script>bad()</script>', 'html', div);
    const html = Array.from(frag.childNodes).map((n) => (n as Element).outerHTML ?? '').join('');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
});
it('sanitizes a <style> body inside a template (backstop fires)', () => {
    const div = document.createElement('div');
    const frag = parseAndSanitizeInContext('<style>a{background:url(javascript:alert(1))}</style>', 'html', div);
    expect((frag.firstElementChild as HTMLElement)?.innerHTML ?? '').not.toContain('javascript');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/sanitize-pipeline.test.ts -t context`
Expected: FAIL — `parseAndSanitizeInContext` not exported.

- [ ] **Step 3: Refactor + add the entry point** — `src/sanitize-pipeline.ts`
  - Extract the two `addHook` registrations + the `dpConfig` literal from `getSanitizedContent` into a shared internal `withSanitizerHooks(run, options)` that does `removeAllHooks()` → `addHook(...)` → `run(purify)` → `finally removeAllHooks()`. Have `getSanitizedContent` call it (`return withSanitizerHooks((p) => p.sanitize(preprocessed, { ...dpConfig }), options)`), so the string path is behaviourally unchanged.
  - Add `parseAndSanitizeInContext` exactly as in High-Level Technical Design, reusing `withSanitizerHooks` with `{ ...dpConfig, IN_PLACE: true }`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/sanitize-pipeline.test.ts` → PASS (incl. all pre-existing sanitizer tests — the string path is unchanged)
Run: `npm run test:integration` (Playwright sanitizer corpus) → green; **zero `test-uat/*.csv` regen**

- [ ] **Step 5: Lint, format, commit**

```bash
git add src/sanitize-pipeline.ts test/sanitize-pipeline.test.ts
git commit -m "feat: in-context parse + in-place sanitize entry point (no rule change)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

- [ ] U5. **Body-template container resolution (comment-marker slot + anchor)**

**Goal:** `resolveTemplateContainer(rootEl, bodyTemplate, options)` returns the live keyed-join container and an insert-before anchor. Default body → `{ container: rootEl, anchor: null }` (no wrapper, byte-identical). Custom body → parse via comment marker, in-place sanitize, cache container + anchor.

**Requirements:** R3, R6, R9.

**Files:**
- Modify: `src/domain-utils.ts` (`TemplateContainer`, `resolveTemplateContainer`)
- Modify: `src/visual-constants.ts` (`dom`: `contentSlotMarker: 'HC:CONTENT'`)
- Test: `test/domain-utils.test.ts`

- [ ] **Step 1: Write the failing tests** (jsdom; mirror the existing binding-test setup)

```ts
it('default body returns the root container with no wrapper', () => {
    const root = makeDiv();
    const tc = resolveTemplateContainer(root, '{{content}}', {});
    expect(tc.container).toBe(root);
    expect(tc.anchor).toBeNull();
    expect(root.children.length).toBe(0);
});
it('custom table body returns the <tbody> slot parent as the container', () => {
    const root = makeDiv();
    const tc = resolveTemplateContainer(root, '<table><tbody>{{content}}</tbody></table>', {});
    expect(tc.container.tagName).toBe('TBODY');
    expect(root.querySelector('table tbody')).toBe(tc.container);
});
it('preserves static siblings and places the anchor at the slot position', () => {
    const root = makeDiv();
    const tc = resolveTemplateContainer(root, '<section><h1>H</h1>{{content}}<footer>F</footer></section>', {});
    expect(tc.container.tagName).toBe('SECTION');
    expect(tc.anchor).not.toBeNull();
    expect(tc.anchor!.previousSibling?.nodeName).toBe('H1');
    expect(tc.anchor!.nextSibling?.nodeName).toBe('FOOTER');
});
it('sanitizes the body template', () => {
    const root = makeDiv();
    resolveTemplateContainer(root, '<div onclick="x()">{{content}}</div>', {});
    expect(root.querySelector('div')?.hasAttribute('onclick')).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/domain-utils.test.ts -t resolveTemplateContainer`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the marker constant** — `src/visual-constants.ts` `dom` block

```ts
contentSlotMarker: 'HC:CONTENT',
```

- [ ] **Step 4: Implement `resolveTemplateContainer`** — `src/domain-utils.ts` (illustrative body; signature binding)

```ts
export interface TemplateContainer { container: HTMLElement; anchor: Comment | null; }

export function resolveTemplateContainer(
    rootEl: HTMLElement, bodyTemplate: string, options: SanitizeOptions
): TemplateContainer {
    rootEl.replaceChildren();
    const marker = VisualConstants.dom.contentSlotMarker;
    // Default (token only, ignoring whitespace) => no wrapper.
    if (substitute(bodyTemplate, CONTENT_TOKEN, ' ').replace(/\s/g, '') === ' ') {
        return { container: rootEl, anchor: null };
    }
    // Substitute the slot for a comment marker (valid in every content model),
    // parse in the rootEl context, locate it, anchor it, drop it, then sanitize.
    const withMarker = substitute(bodyTemplate, CONTENT_TOKEN, `<!--${marker}-->`);
    const range = document.createRange();
    range.selectNodeContents(rootEl);
    const frag = range.createContextualFragment(withMarker);
    rootEl.appendChild(frag);
    const commentNode = findComment(rootEl, marker);          // TreeWalker(SHOW_COMMENT)
    const parent = (commentNode?.parentNode as HTMLElement) ?? rootEl;
    const anchor = document.createComment(marker);            // persistent, visual-owned
    if (commentNode) parent.replaceChild(anchor, commentNode);
    else parent.appendChild(anchor);
    sanitizeElementInPlace(rootEl, options);                  // shared sanitizer (U4 internal)
    return { container: parent, anchor };
}
```

(`findComment` = `TreeWalker` over `SHOW_COMMENT` matching `nodeValue === marker`. `sanitizeElementInPlace` = thin wrapper over `withSanitizerHooks` from U4 that sanitizes `rootEl` in place; the anchor is a comment and is unaffected by sanitization since it is the visual's own node added before the in-place pass — or re-add it after if the config strips comments; verify in Step 5.)

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run test/domain-utils.test.ts -t resolveTemplateContainer` → PASS
(If the in-place sanitize strips the anchor comment, re-insert the anchor *after* the sanitize pass at the recorded index — add a test asserting `tc.anchor.isConnected`.)

- [ ] **Step 6: Lint, format, commit**

```bash
git add src/domain-utils.ts src/visual-constants.ts test/domain-utils.test.ts
git commit -m "feat: resolve body-template join container via comment-marker slot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

- [ ] U6. **Templated row render + generalized keyed reconcile**

**Goal:** `renderTemplatedEntries` (rebuild-all) and `reconcileTemplatedEntries` (keyed) build each row root from its template via `parseAndSanitizeInContext`, apply `.htmlViewerEntry`, enforce single-root (Decision 5), and stamp the `(rowTemplate ⊕ content)` diff key. Default templates reproduce today's two-div DOM.

**Requirements:** R3, R4, R7, R8.

**Files:**
- Modify: `src/domain-utils.ts` (`rowRenderKey`, `buildRowRoot`, `renderTemplatedEntries`, `reconcileTemplatedEntries`)
- Test: `test/domain-utils.test.ts`

- [ ] **Step 1: Write the failing tests** (jsdom)

```ts
const entry = (key: string, content: string, rowTemplate = '<div><div>{{row}}</div></div>') =>
    ({ identity: { getKey: () => key }, content, rowTemplate, selected: false, tooltips: [] } as any);

it('default template reproduces the two-div .htmlViewerEntry > div structure', () => {
    const tc = { container: makeDiv(), anchor: null };
    renderTemplatedEntries(tc, [entry('a', 'X')], { format: 'html', allowHyperlinks: false, hasSelection: false });
    const outer = tc.container.querySelector('.htmlViewerEntry')!;
    expect(outer.tagName).toBe('DIV');
    expect(outer.firstElementChild?.tagName).toBe('DIV');          // inner wrapper preserved
    expect(outer.textContent).toContain('X');
});
it('a <tr> row template yields a real table row (no auto-close, no wrapper div)', () => {
    const tbody = document.createElement('tbody');
    const tc = { container: tbody, anchor: null };
    renderTemplatedEntries(tc, [entry('a', '<td>c</td>', '<tr>{{row}}</tr>')], opts);
    const tr = tbody.querySelector('tr')!;
    expect(tr.classList.contains('htmlViewerEntry')).toBe(true);
    expect(tr.querySelector('td')?.textContent).toBe('c');
    expect(tbody.querySelector('div')).toBeNull();
});
it('reconcile retains the same node for an unchanged row (iframe survives)', () => {
    const tc = { container: makeDiv(), anchor: null };
    reconcileTemplatedEntries(tc, [entry('a', 'A'), entry('b', 'B')], opts);
    const aNode = tc.container.querySelector('.htmlViewerEntry')!;
    reconcileTemplatedEntries(tc, [entry('a', 'A'), entry('b', 'B2')], opts);
    expect(tc.container.querySelectorAll('.htmlViewerEntry')[0]).toBe(aNode);   // a retained
});
it('reconcile re-renders a changed row and exits a removed row', () => {
    const tc = { container: makeDiv(), anchor: null };
    reconcileTemplatedEntries(tc, [entry('a', 'A'), entry('b', 'B')], opts);
    reconcileTemplatedEntries(tc, [entry('a', 'A2')], opts);
    expect(tc.container.querySelectorAll('.htmlViewerEntry').length).toBe(1);
    expect(tc.container.textContent).toContain('A2');
});
it('a multi-root row template degrades to a single .htmlViewerEntry wrapper', () => {
    const tc = { container: makeDiv(), anchor: null };
    renderTemplatedEntries(tc, [entry('a', 'x', '<span>{{row}}</span><span>!</span>')], opts);
    const roots = tc.container.querySelectorAll(':scope > .htmlViewerEntry');
    expect(roots.length).toBe(1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/domain-utils.test.ts -t Templated`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** — `src/domain-utils.ts` (illustrative bodies; signatures binding)
  - `rowRenderKey(d)` and `buildRowRoot(container, d, opts)` per High-Level Technical Design (single-root enforcement: if the sanitized fragment has exactly one `ELEMENT_NODE` child, that's the root; else create a `<div>`, move the fragment into it).
  - `renderTemplatedEntries`: `tc.container` (insert before `tc.anchor` if present) keyed join `selectAll(':scope > .htmlViewerEntry').data(data, key)`; `enter().append((d) => buildRowRoot(tc.container, d, opts))` (insert before anchor); `merged.order()`; return merged.
  - `reconcileTemplatedEntries`: same keyed join; `exit().remove()`; `enter().append((d) => buildRowRoot(...))`; `changed = update.filter(node.__renderedContent !== rowRenderKey(d))`; for `changed`, replace each node with a freshly built root (`this.replaceWith(buildRowRoot(...))`) and re-select; `merged.classed('unselected', shouldDimPoint)`, `.order()`; `toRender = entered + changed`; return `{ merged, toRender }`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/domain-utils.test.ts` → PASS (incl. pre-existing tests; default templates keep the old structure)

- [ ] **Step 5: Lint, format, commit**

```bash
git add src/domain-utils.ts test/domain-utils.test.ts
git commit -m "feat: templated row render + identity-keyed reconcile (default = byte-identical)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

- [ ] U7. **Wire into the visual + extend the fingerprint**

**Goal:** Route `rebuild`/`reconcile`/`renderEmptyOrRaw` through the template engine (cached join container), and add the template values to `computeRenderFingerprint`. Default output unchanged; custom templates now render and reconcile.

**Requirements:** R4, R9, R10.

**Files:**
- Modify: `src/visual.ts` (`buildRenderSteps`, a cached `templateContainer` field, reset)
- Modify: `src/render-orchestrator.ts` (`computeRenderFingerprint`)
- Test: `test/render-orchestrator.test.ts` (fingerprint), existing `test/visual.*` if present

- [ ] **Step 1: Write the failing tests** — `test/render-orchestrator.test.ts`

```ts
it('fingerprint changes when the body template changes', () => {
    expect(computeRenderFingerprint(settings({ bodyTemplate: '<main>{{content}}</main>' })))
        .not.toBe(computeRenderFingerprint(settings()));
});
it('fingerprint changes when the static row template changes', () => {
    expect(computeRenderFingerprint(settings({ rowTemplate: '<li>{{row}}</li>' })))
        .not.toBe(computeRenderFingerprint(settings()));
});
```

(Extend the local `settings()` factory in that file with `templates.templatesCardMain.bodyTemplate/rowTemplate`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/render-orchestrator.test.ts -t fingerprint`
Expected: FAIL — template values not in the fingerprint.

- [ ] **Step 3: Extend the fingerprint** — `src/render-orchestrator.ts`, append the two template values to the `computeRenderFingerprint` array (per High-Level Technical Design).

- [ ] **Step 4: Wire the render steps** — `src/visual.ts`
  - Add `private templateContainer: TemplateContainer | undefined;`
  - In `rebuild`: `this.templateContainer = resolveTemplateContainer(this.contentContainer.node()!, viewModel.bodyTemplate, { allowHyperlinks: behavior.hyperlinks.value })`; then `const merged = renderTemplatedEntries(this.templateContainer, viewModel.htmlEntries, { format, allowHyperlinks, hasSelection })`; `this.finalizePopulatedRender(merged, viewModel, settings)`. (Replaces the `selectAll('*').remove()` + `bindVisualDataToDom` + `resolveHtmlGroupElement` + `stampRenderedContent` lines.)
  - In `reconcile`: reuse `this.templateContainer` (rebuild establishes it; if undefined, fall back to a rebuild); `const { merged, toRender } = reconcileTemplatedEntries(this.templateContainer, viewModel.htmlEntries, opts)`; `this.finalizePopulatedRender(merged, viewModel, settings)`. (`toRender` is already rendered+stamped inside the helper — no separate `resolveHtmlGroupElement`.)
  - In `renderEmptyOrRaw` and the `catch` reset: set `this.templateContainer = undefined` (kind change / error → re-establish on next rebuild). The orchestrator's `reset()` already forces a rebuild; clearing the cached container keeps it consistent.
  - Remove now-unused imports (`bindVisualDataToDom`, `resolveHtmlGroupElement`, `stampRenderedContent`) only if no longer referenced; keep `reconcileVisualDataToDom` removed if fully superseded (confirm no other callers).

- [ ] **Step 5: Run the suites**

Run: `npx vitest run test/render-orchestrator.test.ts` → PASS
Run: `npm test` → all green (default templates → identical render path output; existing orchestrator dispatch tests unchanged)

- [ ] **Step 6: Lint, format, commit**

```bash
git add src/visual.ts src/render-orchestrator.ts test/render-orchestrator.test.ts
git commit -m "feat: render via the template engine; template values in fingerprint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

- [ ] U8. **Verification gate**

**Goal:** Prove the feature end-to-end and the non-breaking/zero-churn guarantees.

**Requirements:** R10 (and a final pass over R1–R9).

**Files:** none (gate only).

- [ ] **Step 1: Full unit + integration suites**

Run: `npm run test:all` → all green (unit + Playwright integration).

- [ ] **Step 2: Zero sanitizer-rule churn**

Run: `git status --short test-uat/ docs/sanitization-rules.md` → no modifications attributable to this branch (the only `test-uat` change is the pre-existing `expressions.tmdl` WIP). Confirm `npm run docs:check` (or the repo's docs sync script) is green.

- [ ] **Step 3: Package all three editions**

Run the repo's package script for lite / standard / standalone (e.g. `npm run package:all` or the per-edition `pbiviz package`) → all succeed.

- [ ] **Step 4: Manual UAT (Power BI Desktop)** — checklist:
  - Default (no templates set) → output identical to 2.0.0 (regression check, incl. a custom stylesheet using `.htmlViewerEntry > div`).
  - Static body wrap (header/footer) renders around rows (#127).
  - `<table><tbody>{{content}}</tbody></table>` body + `<tr>{{row}}</tr>` row + `<td>` content → one valid table across granularity (#138).
  - Per-row row template via a CF rule (e.g. overdue → `<tr class="red">{{row}}</tr>`).
  - Body template via a measure (single-value CF).
  - Markdown content inside a templated cell.
  - Reconcile mode: iframe in a templated cell survives data refresh / cross-filter / resize; changed row re-renders.
  - Raw-HTML toggle reflects the assembled, sanitized output.
  - Empty ↔ populated ↔ raw transitions; dev-visual vs AppSource-swap caution ([powerbi-appsource-replaces-dev-visual](../../README.md)).
  - Template-borne dangerous markup (`<script>`, `onerror`, `javascript:` href) is stripped.

- [ ] **Step 5:** Hand off to **superpowers:finishing-a-development-branch**.

---

## System-Wide Impact

- **Render path:** `rebuild`/`reconcile` now flow through `resolveTemplateContainer` + `renderTemplatedEntries`/`reconcileTemplatedEntries`. `resolveHtmlGroupElement` and `bindVisualDataToDom` are superseded for the entry render (remove if no remaining callers; `reconcileVisualDataToDom` is generalized into `reconcileTemplatedEntries`). `finalizePopulatedRender`, hover, hyperlink delegation, raw-HTML, and interactivity binding are unchanged and still operate on the merged row roots.
- **Data layer:** `ISimulatedTable` gains `objects`; `IViewModel` gains `bodyTemplate`; `IHtmlEntry` gains `rowTemplate`. `mapDataView` does one extra O(1) `getValue` per row (keeps the per-row cost bound, per the WP-A learning).
- **Settings/capabilities:** a new `templates` object/card across all three editions (shared `capabilities.json`); two new CF-enabled text properties; new resjson keys. `getFormattingModel` exposes the card automatically.
- **Sanitizer:** one new entry point (`parseAndSanitizeInContext`) + a shared-hooks refactor; **no rule, config, or fixture change**.
- **Orchestrator:** `computeRenderFingerprint` gains two fields; dispatch logic unchanged.

---

## Risks

- **In-context parse + in-place sanitize is load-bearing** (R3/R6). Mitigation: U4's tests assert table-context survival AND dangerous-markup stripping parity with the string path; the string path is refactored to share the exact hooks/config (no rule drift).
- **Default-output parity** (R1/R10). Mitigation: U6's first test pins the two-div structure; the whole existing suite stays green in U7/U8; UAT regression check with a `.htmlViewerEntry > div` stylesheet.
- **Per-row `objects` column ambiguity** (R5). Mitigation: U3 scans categories then values for the first column with an `objects` array; UAT verifies the CF rule output lands as expected; widen the scan if a binding misses.
- **Changed-row replacement in reconcile** (R4). The update-selection node is replaced via `replaceWith(buildRowRoot(...))`; ensure `.order()` runs against the live children afterward (U6 test covers changed + exit + retained in one pass).
- **Anchor survival through in-place sanitize** (U5). The anchor is the visual's own comment node; if the config strips comments, re-insert it post-sanitize at the recorded index (U5 Step 5 verifies `isConnected`).
- **Scope.** Largest of the three WPs. Mitigation: eight independently-testable units; CF (U2/U3) and render (U5/U6) are separable, so CF could ship a release after the render engine if needed without rework.

---

## Documentation / Operational Notes

- **Branching:** cut a `feat/templating` (or similar) branch from `2.0.0` before U1 (subagent-driven-development must not implement on a shared integration branch without consent). The spec (`0fc88fa`) and this plan are already committed on `2.0.0`.
- **Staging discipline:** every commit stages files explicitly; never `git add -A` — the working tree carries unrelated WIP (`test-uat/html-content-uat.SemanticModel/definition/expressions.tmdl`, `.github/hooks/`). Keep the `expressions.tmdl` path and any `_alpha` GUID out of commits.
- **Release notes:** new "Templates" card (#127, #138); defaults reproduce current output; conditional formatting (incl. per-row) on templates; reconcile preserved under templates. No breaking change.
- **Post-merge:** run `/ce-compound` to capture the substitute-then-parse-in-context + in-place-sanitize pattern and the CF `.objects` read path as learnings (none exist yet for templating).
- **Editions:** confirm the shared `capabilities.json` propagates to lite/standard/standalone (it does today for `renderMode`); no per-edition divergence intended.
