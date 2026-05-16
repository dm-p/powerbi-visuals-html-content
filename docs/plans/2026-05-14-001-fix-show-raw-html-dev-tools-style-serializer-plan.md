---
title: 'fix: serialize raw HTML view with dev-tools-style walker'
type: fix
status: completed
date: 2026-05-14
origin: docs/brainstorms/2026-05-14-fix-show-raw-html-entity-encoding.md
---

# fix: serialize raw HTML view with dev-tools-style walker

## Summary

Replace the `.outerHTML` calls inside `getRawHtml` with a small custom DOM walker that emits attribute values and text nodes as literal characters (no HTML-spec entity encoding). The source DOM is unchanged — still the live, post-sanitization DOM — but the string it produces will match what a browser dev tools Elements panel shows, so report authors stop seeing misleading `&amp;` / `&lt;` artifacts when they toggle "Show Raw HTML". The work fits in two atomic commits: implement and test the walker, then swap the call site.

---

## Problem Frame

Power BI Desktop has no dev tools; `Show Raw HTML` is the primary debug surface for HTML-measure authors. The current implementation in [src/domain-utils.ts:365-377](src/domain-utils.ts#L365-L377) calls `.outerHTML` on the rendered DOM, which entity-encodes attribute values per the HTML spec. Users see `src="...&amp;num=5"` and conclude their HTML was mangled, when the rendered DOM is fine. See origin: [docs/brainstorms/2026-05-14-fix-show-raw-html-entity-encoding.md](docs/brainstorms/2026-05-14-fix-show-raw-html-entity-encoding.md) and [GitHub issue #76](https://github.com/dm-p/powerbi-visuals-html-content/issues/76).

---

## Assumptions

*This plan was authored without synchronous user confirmation on plan-time decisions. The items below are agent inferences that fill gaps in the origin brainstorm — un-validated bets that should be reviewed before implementation proceeds.*

- The walker lives inline in [src/domain-utils.ts](src/domain-utils.ts) as a private (non-exported) function. No new file. Rationale: single caller (`getRawHtml`), no reuse signal in the codebase.
- The HTML5 void-element list is an inline const at the top of the walker (or just above it). It is *not* added to [src/visual-constants.ts](src/visual-constants.ts) — it isn't reused elsewhere, and `visual-constants.ts` already carries the security-relevant allow/deny lists. Mixing display-time minutiae there would dilute that file's purpose.
- Attribute values are always emitted with double-quote delimiters. Values containing a literal `"` will produce technically-invalid HTML — accepted because this is a debug view, not an export format. The brainstorm's non-goal *"Producing output that is round-trippable as valid HTML"* covers this.
- Comment nodes are emitted as `<!--text-->`. Processing instructions and `<!DOCTYPE>` declarations are skipped — they don't appear in the post-sanitization fragments this code path renders.
- `pretty` (v2.0.0, wraps `js-beautify`) is expected to tolerate non-strict HTML output. If it throws or mangles the walker output during implementation, the fallback is to emit the walker output unindented (or with minimal newline-between-tags formatting) rather than block the fix.

---

## Requirements

- R1. The raw-HTML view must show attribute values and text-node content with literal characters (`&`, `<`, `>`, `"`, `'`), not HTML-spec entity-encoded forms — for the post-sanitization DOM. *(see origin: Goals 1)*
- R2. The view must continue to reflect *what was rendered*, not what was authored. Sanitizer removals show up as absences; sanitizer rewrites show their rewritten values. *(see origin: Goals 2)*
- R3. Existing reports must keep working. The `showRawHtml` setting key, default (`false`), and pane location must not change. *(see origin: Goals 3)*

**Origin actors:** none formalised in origin (single primary user: HTML-measure author in Power BI Desktop).
**Origin flows:** none formalised in origin (single flow: toggle `Show Raw HTML` → read textarea).
**Origin acceptance examples:** none formalised; origin provides six success criteria covered by test scenarios below.

---

## Scope Boundaries

- The CORS / null-origin iframe failure also discussed in [#76](https://github.com/dm-p/powerbi-visuals-html-content/issues/76) is unaddressable at the visual level.
- The sanitizer's allow/deny rules are not changed.
- No structured *"what was removed and why"* diagnostic — that is the follow-up brainstorm noted in origin.
- The output is intentionally not round-trippable as strict HTML.

### Deferred to Follow-Up Work

- Structured sanitization-changes diagnostic (origin "Follow-up work" section): a separate `ce-brainstorm` to design a structured report sourced from `uponSanitizeElement`, `uponSanitizeAttribute`, `sanitizeCss`, and `svg-payload-scan` decision points. Touches security-sensitive code and has defense-in-depth design questions (oracle disclosure of the rule set). Not gated on this fix.

---

## Context & Research

### Relevant Code and Patterns

- [src/domain-utils.ts:134-155](src/domain-utils.ts#L134-L155) — `resolveForRawHtml`, the entry point invoked from `visual.ts`. Hands containers to `getRawHtml` and writes the result into a readonly `<textarea>`. Unchanged by this plan.
- [src/domain-utils.ts:365-377](src/domain-utils.ts#L365-L377) — `getRawHtml`, the function with the two `.outerHTML` calls being replaced.
- [src/visual.ts:255-269](src/visual.ts#L255-L269) — `updateStatus`, the no-data status-container path that also invokes `resolveForRawHtml`. Same code path; gets the fix transitively.
- [src/sanitize-pipeline.ts:227-232](src/sanitize-pipeline.ts#L227-L232) — `getParsedHtmlAsDom`, which runs `marked.parse` for markdown-format content before sanitization. Markdown is handled implicitly: the post-sanitization DOM is what the walker sees, regardless of source format.
- [test/visual-constants.test.ts](test/visual-constants.test.ts) — example vitest pattern (`describe`/`it`/`expect`, named imports from `vitest`, relative source import).
- AGENTS.md test conventions: vitest, tests mirror source filenames, new source files ship with at least one corresponding test file. `npm run test:all` before declaring sanitization-adjacent work complete — this plan isn't strictly sanitization, but the full suite gate is cheap and worth running.

### Institutional Learnings

- No entries in `docs/solutions/` touch HTML serialization or the raw-HTML view. All existing solutions docs are sanitizer-rule regressions (CSS multiline control chars, SVG denylist, SMIL/data-URI, percent-encoded payloads, body styling cascade). None are directly applicable to a display-layer change.

### External References

- HTML5 spec, *Void elements*: `area, base, br, col, embed, hr, img, input, link, meta, source, track, wbr`. The walker uses this set verbatim.

---

## Key Technical Decisions

- **Custom DOM walker over string post-processing of `outerHTML`:** Walking the DOM directly gives access to decoded attribute values via `Element.attributes` / `getAttribute`, with no risk of conflating entity sequences in attribute contexts vs text-content contexts. String post-processing on an already-encoded `outerHTML` result is fragile (the same `&amp;` may need different handling depending on context).
- **Recursive walker, not iterative:** Sanitized DOM depth in this visual is bounded (the sanitizer doesn't preserve pathological depth). Recursion is the clear shape; an explicit stack adds nothing.
- **Walker stays private to `domain-utils.ts`:** Only `getRawHtml` calls it. If a second caller appears later, factor out then.
- **Treat `pretty` as provisional, not load-bearing:** The current implementation passes `.outerHTML` through `pretty` for indentation. That was useful when the source was opaque-from-the-outside. With our own walker, the walker can own indentation directly (depth counter + newlines between block-level children) and the `pretty` dependency becomes incidental. Evaluate during U2: if the walker emits readable output without `pretty`, drop the call (and check whether `pretty` is reachable from any other code path before removing the dependency entry from `package.json`). If we keep `pretty`, wrap it in try/catch so a failure on technically-invalid HTML falls back to walker output. *(see also Open Questions → Deferred to Implementation.)*

---

## Open Questions

### Resolved During Planning

- *Where does the walker live?* Inline in `src/domain-utils.ts`, private. Rationale in Assumptions.
- *Where does the void-element list live?* Inline at the top of the walker. Rationale in Assumptions.
- *How is markdown-format input handled?* No special case needed — `getParsedHtmlAsDom` runs `marked.parse` before sanitization, so the post-sanitization DOM (which the walker reads) is the rendered HTML. The user authored markdown but wants to see the rendered output — that's exactly what shows.

### Deferred to Implementation

- *Is `pretty` worth keeping at all?* The walker can own indentation directly — track recursion depth, emit a newline + indent before block-level children, keep inline children on a single line. Evaluate during U2: produce walker output both with and without `pretty` against the test payloads; if the walker's own output is readable, drop the `pretty` call entirely. If `pretty` isn't referenced anywhere else in `src/`, also remove it from `dependencies`/`devDependencies` in [package.json](package.json) and `@types/pretty` if unused. Tests in U2 should be assertion-shaped (substring/regex against expected attribute fragments), not whole-string equality, so indentation choice doesn't cascade into test churn.
    - **Resolution (implementation):** `pretty` was kept. Verified against the regression payloads that it preserves the walker's literal `&` / `<` / `>` / `'` in attribute values rather than re-encoding them. The `try`/`catch` around the call was kept as defense-in-depth (it now also `console.warn`s on failure, matching the pattern in `src/sanitize-pipeline.ts`) so that if a future `js-beautify` update ever throws on technically-invalid HTML, the debug toggle still returns the unindented walker output. The `pretty` and `@types/pretty` entries in `package.json` were therefore retained.
- *If we keep `pretty`, does it tolerate the walker's dev-tools-style output (literal `&` in attribute values)?* Implementer should write a unit test that exercises `getRawHtml` end-to-end with a payload containing `&`; if `pretty` throws or mangles, either drop it (per the question above) or wire the try/catch fallback described in Key Technical Decisions.
- Whitespace between siblings (e.g., the space introduced by source authoring between adjacent block elements) — preserve via `textContent` of the corresponding text nodes; let `pretty` reformat at top level. No special handling required unless tests show otherwise.
- Behavior for `xmlns` and namespaced SVG attributes (e.g., `xlink:href`): `getAttribute` returns these with their qualified names as strings. Implementer should verify in the SVG-corpus test that the qualified name round-trips.

---

## High-Level Technical Design

> *This illustrates the intended shape of the walker for review. It is directional guidance, not implementation specification. Implementing agent should treat it as context, not code to reproduce.*

```text
domSerialize(node) →
  switch node.nodeType:
    ELEMENT_NODE:
      tagName = node.tagName.toLowerCase()
      attrs   = join(node.attributes, ' ', a => `${a.name}="${a.value}"`)
      if tagName in VOID_ELEMENTS:
        return `<${tagName}${attrs ? ' ' + attrs : ''}>`
      children = join(node.childNodes, '', domSerialize)
      return `<${tagName}${attrs ? ' ' + attrs : ''}>${children}</${tagName}>`
    TEXT_NODE:
      return node.nodeValue ?? ''
    COMMENT_NODE:
      return `<!--${node.nodeValue ?? ''}-->`
    DOCUMENT_FRAGMENT_NODE:
      return join(node.childNodes, '', domSerialize)
    default:
      return ''   // ignore PI, doctype, etc.

getRawHtml(...) →
  raw = (stylesheet?  domSerialize(styleSheetContainer.node()) : '') + ' ' +
        domSerialize(container.node())
  try   return pretty(raw)
  catch return raw
```

VOID_ELEMENTS = ['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']

---

## Implementation Units

- U1. **Implement the dev-tools-style DOM walker and its tests**

**Goal:** Add a private `domSerialize(node: Node): string` function inside [src/domain-utils.ts](src/domain-utils.ts) that walks a DOM tree and emits a dev-tools-style HTML string. Cover it with vitest unit tests in a new file [test/domain-utils.test.ts](test/domain-utils.test.ts).

**Requirements:** R1, R2.

**Dependencies:** None.

**Files:**
- Modify: `src/domain-utils.ts`
- Create: `test/domain-utils.test.ts`

**Approach:**
- Define `VOID_ELEMENTS` as a small inline const directly above the walker.
- Recursive over `Node`. Branch on `nodeType` (`ELEMENT_NODE`, `TEXT_NODE`, `COMMENT_NODE`, `DOCUMENT_FRAGMENT_NODE`); ignore other types (PI, doctype) by returning empty string.
- Attribute serialization: iterate `Element.attributes`; format `name="value"` using `Attr.value` directly (no encoding). Always use double quotes.
- Void elements: emit `<tag attrs>` with no closing tag.
- Text nodes: emit `nodeValue` (or `''` when nullish).
- Comment nodes: emit `<!--text-->`.
- Fragment: concatenate child serialization.
- Tag names: lowercased for consistency with dev-tools display.

**Execution note:** Test-first. The walker has a clean input/output contract and every behavior in the test list below is specifiable before code lands.

**Patterns to follow:**
- Vitest layout from [test/visual-constants.test.ts](test/visual-constants.test.ts): named imports from `vitest`, nested `describe` blocks, relative source import.
- Strict TypeScript per [tsconfig.json](tsconfig.json) — no `any`; use `Node`, `Element`, `Attr`, `Text`, `Comment` from the DOM lib. Narrow via `node.nodeType` or `instanceof`.

**Test scenarios:**
- *Happy path:* Element with one attribute returns `<tag name="value">…</tag>` with literal value.
- *Happy path:* Element with multiple attributes preserves their order and emits them double-quoted.
- *Happy path:* Element with text children round-trips literal text content without entity encoding.
- *Edge case:* Attribute value containing `&` is emitted literally (no `&amp;`). Regression for [issue #76](https://github.com/dm-p/powerbi-visuals-html-content/issues/76). E.g., `<iframe src="https://example.com/?a=1&b=2">` round-trips with literal `&`.
- *Edge case:* Attribute values containing `<`, `>`, `'` are emitted literally.
- *Edge case:* Text node containing `&`, `<`, `>` is emitted literally.
- *Edge case:* Void element (`<br>`, `<img src="…">`, `<hr>`) emits no closing tag.
- *Edge case:* Nested element tree (e.g., `<div><p>x</p><p>y</p></div>`) serializes in source order.
- *Edge case:* Empty element (`<div></div>`) emits open and close tags.
- *Edge case:* Element with no attributes emits `<tag>...` (no trailing space inside the angle brackets).
- *Edge case:* Comment node emits `<!--…-->`.
- *Edge case:* DocumentFragment serializes by concatenating children.
- *Edge case:* Unknown node type (e.g., processing instruction) returns empty string without throwing.
- *Edge case:* SVG element with namespaced attribute (e.g., `xlink:href`) emits the qualified attribute name verbatim via `Attr.name`.
- *Edge case:* Tag name with mixed-case source (e.g., `<Div>`) emits lowercase (`<div>`).

**Verification:**
- `npm test` passes with all walker tests green.
- The walker IS exported as `domSerialize` (decision deviated from initial plan intent). Marked `@internal` in JSDoc to signal it is not part of the visual's public API; exported solely so unit tests in `test/domain-utils.test.ts` can import it directly without driving everything end-to-end via `resolveForRawHtml`. Same applies to `getRawHtml` for end-to-end test coverage of the stylesheet concatenation logic.

---

- U2. **Swap `getRawHtml` to use the walker**

**Goal:** Replace the two `.outerHTML` calls in `getRawHtml` ([src/domain-utils.ts:370-376](src/domain-utils.ts#L370-L376)) with calls into the walker from U1, and add a `try`/`catch` around `pretty(...)` so a `pretty` failure on technically-invalid HTML falls back to the walker output as-is.

**Requirements:** R1, R2, R3.

**Dependencies:** U1.

**Files:**
- Modify: `src/domain-utils.ts`
- Modify: `test/domain-utils.test.ts` (add end-to-end coverage for `getRawHtml`)

**Approach:**
- Replace `styleSheetContainer.node().outerHTML` with `domSerialize(styleSheetContainer.node())`.
- Replace `container.node().outerHTML` with `domSerialize(container.node())`.
- Decide whether to keep `pretty(...)` at all. If U1's walker produces readable output on its own (and the implementer is satisfied after running it against the test payloads), drop the `pretty` call. If kept, wrap it in try/catch — on error return the unprettified walker output. Decision recorded as a code comment or commit message; no need to thread it back into the plan.
- If `pretty` is dropped: grep `src/` for any other references, and if none, remove `pretty` and `@types/pretty` from [package.json](package.json). Run `npm install` to update the lockfile.
- `resolveForRawHtml` and the status-container path in `visual.ts` are unchanged; they pick up the fix transitively.

**Execution note:** Implementer should write the end-to-end test below first (failing) to confirm the regression is reproduced, then make the swap.

**Patterns to follow:**
- Existing `getRawHtml` signature, return type, and arrow-function-with-template-literal shape preserved. The only changes are the two `.outerHTML` calls and the `try`/`catch` around `pretty`.

**Test scenarios:**
- *Happy path:* `getRawHtml` called with a container that holds `<iframe src="https://example.com/?a=1&b=2"></iframe>` returns a string containing `src="https://example.com/?a=1&b=2"` (literal `&`, no `&amp;`). Covers R1 and origin Success Criteria #1.
- *Happy path:* `getRawHtml` called with `<p title="3 < 4">x</p>` returns a string containing `<p title="3 < 4">x</p>`. Covers origin Success Criteria #2.
- *Edge case:* `getRawHtml` called with a container whose DOM came from sanitizing `<script>alert(1)</script><p>hi</p>` returns a string containing `<p>hi</p>` and not `<script>`. Covers R2 and origin Success Criteria #3.
- *Edge case:* `getRawHtml` called with a container whose DOM came from sanitizing `<div style="position: fixed; color: red">x</div>` (where the sanitizer drops `position: fixed`) returns a string containing `style="color: red"`. Covers origin Success Criteria #4.
- *Edge case:* `getRawHtml` called with content rendered from a markdown-format measure (`**bold**` → `<p><strong>bold</strong></p>`) returns the post-marked, post-sanitization HTML. Covers origin Success Criteria #5.
- *Edge case:* `getRawHtml` with a user-supplied stylesheet emits the post-sanitization `<style>` text without entity encoding.
- *Edge case:* `getRawHtml` called when the container has no child nodes returns an empty (or whitespace-only) string without throwing. Covers origin test requirement #5 ("empty/undefined input").
- *Integration:* If `pretty(...)` throws on the walker output, `getRawHtml` returns the unprettified walker output rather than propagating the error. (Use a test that feeds the walker output through a mocked `pretty` that throws once.)

**Verification:**
- `npm test` passes including the new end-to-end coverage.
- `npm run test:all` passes — includes integration and `docs:check`. `docs/sanitization-rules.md` should not drift (no sanitizer changes).
- Manual UAT spot-check: load [test-uat](test-uat) workbook, toggle `Show Raw HTML` on a visual whose measure contains `&`, confirm the textarea shows the literal `&`. Mirrors how the bug was originally observed.
- `showRawHtml` toggle still works in `defaultBodyStyling` visibility tests in [test/visual-settings.test.ts](test/visual-settings.test.ts) (no changes needed there, but the suite must stay green).

---

## System-Wide Impact

- **Interaction graph:** `resolveForRawHtml` (unchanged) is called from `visual.ts` in two places: the main content path ([src/visual.ts:196](src/visual.ts#L196)) and the status-message path ([src/visual.ts:263](src/visual.ts#L263)). Both pick up the new walker output transitively.
- **Error propagation:** A `pretty(...)` failure on walker output is caught locally and returns the unprettified string. No upward propagation.
- **State lifecycle risks:** None. The walker is pure — input DOM, output string. No caching, no side effects.
- **API surface parity:** No public API change. `getRawHtml` and `resolveForRawHtml` keep their signatures. The walker is private.
- **Integration coverage:** End-to-end `getRawHtml` tests (U2) exercise the walker through the same call shape `visual.ts` uses.
- **Unchanged invariants:** The sanitizer pipeline (`sanitize-pipeline.ts`, `css-sanitizer.ts`, `svg-payload-scan.ts`, `visual-constants.ts`) is not touched. The `showRawHtml` setting key, default, and pane location remain unchanged. The `<textarea>` element used to display raw HTML and its `readonly` attribute are unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `pretty` (v2.0.0 / `js-beautify`) chokes on technically-invalid HTML produced by the walker (literal `&` in attribute values). | Two-pronged: prefer dropping `pretty` outright once the walker can self-format (see Key Technical Decisions). If kept, wrap in try/catch and fall back to walker output as-is. |
| Dropping `pretty` removes a dependency we didn't really need, but `pretty` may be referenced by code we haven't seen. | Before deleting the entry in `package.json`, grep `src/`, `scripts/`, and `test/` for any other `pretty` import. Remove only if unused. |
| Walker emits output that is misread as round-trippable HTML — a user copies it back into a measure and gets different rendering. | Origin already flags this as a non-goal; the brainstorm doc and the format-pane description (out of scope for this plan) document the dev-tools-style trade-off. No code mitigation needed beyond intent. |
| SVG namespaced attributes (`xlink:href`) misformatted by `Attr.name`. | Covered by a specific test in U1 (SVG namespaced attribute). Verify the qualified name round-trips literally. |
| Walker recursion stack for pathological deeply-nested DOM. | Sanitizer already enforces shape constraints; the visual's UAT corpora do not exercise pathological depth. Accept the risk; revisit only if a UAT regression appears. |
| UAT fixtures with `&`-bearing URLs may have been "calibrated" against the buggy display behavior and now look different. | UAT corpus is human-curated; spot-check per U2 verification. AGENTS.md grep advice for `test-uat/corpus.csv` applies if any regression surfaces, but no sanitizer rule changed so the underlying corpus is not at risk. |

---

## Documentation / Operational Notes

- No `docs/sanitization-rules.md` regeneration needed — the sanitizer is not touched.
- Consider updating the `Objects_ContentFormatting_ShowRawHTML_Description` resource string (the toggle's pane description in `src/visual-settings.ts`) to note that the view shows the rendered DOM in a dev-tools style and may not be valid HTML — deferred as a polish task, not a release blocker.
- After the fix lands, [issue #76](https://github.com/dm-p/powerbi-visuals-html-content/issues/76) can be closed with a comment that the encoding misinformation is fixed; the underlying CORS limitation (the other half of the issue) remains explicitly out of scope.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-14-fix-show-raw-html-entity-encoding.md](docs/brainstorms/2026-05-14-fix-show-raw-html-entity-encoding.md)
- Related code: [src/domain-utils.ts](src/domain-utils.ts), [src/visual.ts](src/visual.ts), [src/sanitize-pipeline.ts](src/sanitize-pipeline.ts), [src/visual-settings.ts](src/visual-settings.ts), [src/visual-constants.ts](src/visual-constants.ts), [test/visual-constants.test.ts](test/visual-constants.test.ts), [test/visual-settings.test.ts](test/visual-settings.test.ts)
- Related issues: [#76](https://github.com/dm-p/powerbi-visuals-html-content/issues/76)
- External docs: HTML5 spec — *void elements*
