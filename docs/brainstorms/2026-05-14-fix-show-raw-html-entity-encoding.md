---
title: Fix Show-Raw-HTML entity encoding misinforming users
date: 2026-05-14
status: implemented
related_issue: https://github.com/dm-p/powerbi-visuals-html-content/issues/76
---

# Fix Show-Raw-HTML entity encoding misinforming users

## Problem

The "Show Raw HTML" toggle in the Content Formatting card is one of the only debugging affordances available to report authors writing HTML measures in Power BI Desktop, where browser devtools are unavailable. The intent of the toggle is to act as a substitute for a dev tools Elements panel — letting authors see the rendered DOM so they can mentally diff it against the measure source and understand what the visual produced from their input.

Currently, the implementation in [src/domain-utils.ts:365-377](src/domain-utils.ts#L365-L377) reads the post-sanitization DOM via `container.node().outerHTML` and runs it through the `pretty` package. The DOM source is correct — that's the rendered output the user wants to see — but `.outerHTML` is the HTML-spec serializer, which entity-encodes attribute values: `&` → `&amp;`, `<` → `&lt;`, `"` → `&quot;`, etc. A user-authored `<iframe src="...?q=x&num=5">` displays in the textarea as `src="...?q=x&amp;num=5"`. The DOM contains the correct URL; the textbox display gaslights the user into thinking the visual mangled it.

This breaks the debug-surface contract: the user is trying to verify *what the visual rendered from their input*, and the encoding makes a correctly-rendered DOM look corrupted. Because authors have no other introspection tool in Power BI Desktop, this feature actively misleads the workflow it exists to support.

The owner acknowledged this on [issue #76](https://github.com/dm-p/powerbi-visuals-html-content/issues/76) in 2023. The same misinformation affects any attribute value or text node containing `&`, `<`, `>`, `"`, or `'` — not just the iframe URL in the original report.

## Users and outcome

**Primary user:** A report author writing HTML or markdown measures (or building report templates) in Power BI Desktop, who toggles "Show Raw HTML" to debug why a visual isn't rendering as expected.

**Outcome that changes for them:**
- Today: they see `src="...&amp;num=5"`, conclude the visual encoded their URL wrong, file a bug, or work around it (often unsuccessfully).
- After this change: they see a faithful representation of the rendered DOM — literal `&` in attributes, sanitizer-removed tags absent, sanitizer-rewritten style values shown verbatim — and can mentally diff against their measure source to understand what the visual did.

## Goals

1. The raw-HTML view must show the post-sanitization DOM in a form that matches what a browser dev tools Elements panel would display — i.e., attribute values rendered with literal characters, not HTML-spec entity encoding.
2. The view must continue to reflect *what was rendered*, not what was authored. If the sanitizer removed a tag or attribute, that absence is visible in the output; if it rewrote a `style` value, the rewritten value is what shows. The user does the input-vs-output diff themselves.
3. Existing reports must keep working. The setting key (`showRawHtml`), default (`false`), and visible toggle behavior stay the same.

## Non-goals

- Fixing the CORS / null-origin iframe failure also discussed in #76 — that is a Power BI sandboxing limitation, not addressable at the visual level.
- Changing what the sanitizer allows, blocks, or transforms.
- Producing a structured *"what was removed and why"* diagnostic. That's a separate brainstorm (see "Follow-up work").
- Producing output that is round-trippable as valid HTML. Dev-tools-style display intentionally trades strict HTML validity for readability — a value containing literal `&` is not valid HTML, but it accurately represents what the DOM contains.
- Localising or restyling the formatting card.

## Approach (recommended): replace `.outerHTML` with a dev-tools-style serializer

The DOM source stays the same — `getRawHtml` continues to read from the live post-sanitization DOM (`styleSheetContainer.node()` and the content container). What changes is how the DOM is converted to a string.

**Replace `.outerHTML` with a custom walker** that produces output in the style of a dev tools Elements panel:

- For each element node, emit the opening tag with its attributes. Attribute values come from `Element.attributes[i].value` (or `getAttribute`) — these are the *decoded* in-DOM values, with literal `&`, `<`, etc., not the entity-encoded form `.outerHTML` produces.
- Recurse into child nodes.
- For text nodes, emit `textContent` literally (no entity re-encoding).
- For void elements (`<br>`, `<img>`, `<hr>`, etc.) emit the no-closing-tag form.
- For elements with no children, emit `<tag></tag>` or the appropriate self-closing form depending on the element class.
- Run the resulting string through `pretty` (or a small inline indenter) for readability — same as today.

For the stylesheet container, the same walker applies: it serializes the `<style>` element with its post-sanitization `textContent`, again without entity-encoding.

This approach intentionally:
- Reads the **live sanitized DOM** as the source of truth (matches the existing behaviour and the user's mental model of "what got rendered").
- Trades strict HTML-spec correctness for human-readable accuracy in the output.
- Does not attempt to detect or annotate sanitizer changes — that responsibility belongs to the follow-up diagnostic brainstorm.

## Alternatives considered

**A — Always show the user's input string.** Earlier draft of this brainstorm. Rejected: the user's intent is to debug *what was rendered*, not to see their own input echoed back. Showing the input loses fidelity to the sanitized DOM — they can't see that `<script>` was stripped, that `position: fixed` was dropped from a style, etc.

**B — Keep `.outerHTML`, post-process to decode entities in attribute values.** Functionally similar to the recommended approach, but operates on a serialized string instead of walking the DOM. Rejected because string post-processing is fragile (the same entity sequences may appear inside `<script>`-like text contexts and need different handling), and because walking the DOM directly is simpler and produces a more predictable result.

**C — Build an input-vs-output diff or structured "what was removed" report.** Out of scope for this fix; documented as follow-up work.

## Success criteria

1. Authoring `<iframe src="https://example.com/?a=1&b=2">` as a measure and toggling Show Raw HTML displays `src="https://example.com/?a=1&b=2"` verbatim (literal `&`, no `&amp;`). Regression for issue #76.
2. Authoring `<p title="3 < 4">x</p>` displays `<p title="3 < 4">x</p>` with literal `<` in the attribute value.
3. Authoring HTML containing a tag the sanitizer strips (e.g., `<script>alert(1)</script><p>hi</p>`) shows the post-sanitization DOM only — the stripped tag is absent from the output, mirroring what a dev tools inspector would show.
4. Authoring HTML containing a `style="position: fixed; color: red"` attribute where the sanitizer rewrites `position: fixed` away shows the rewritten value (`style="color: red"`), not the original.
5. Markdown-format measures show the post-marked-rendering, post-sanitization DOM (the rendered HTML), not the markdown source.
6. The existing `showRawHtml` setting key, default (`false`), and pane location are unchanged.

## Test requirements

New tests live in [test/domain-utils.test.ts](test/domain-utils.test.ts) (create if absent — mirrors `src/domain-utils.ts`). At minimum:

1. Serializer returns attribute values containing `&` with the literal character, not `&amp;` (regression for issue #76).
2. Serializer returns attribute values containing `<`, `>`, `"`, `'` with literal characters where the live DOM holds the literal — not entity-encoded.
3. Serializer reflects sanitizer-applied changes: an input with `<script>` shows no `<script>` in the output; an input with a denied `style` declaration shows the surviving declarations only.
4. Serializer with a user-supplied stylesheet emits the post-sanitization `<style>` text without entity-encoding.
5. Serializer with an empty / undefined input returns an empty string (no crash).
6. Serializer handles void elements (`<br>`, `<img>`, `<hr>`) without emitting a closing tag.
7. Serializer handles nested tags and produces output that `pretty` (or the chosen indenter) can format readably.
8. Markdown-format input produces the marked-rendered, sanitized DOM in the output (not the markdown source).

Where useful, reuse a small subset of the input/output pairs from [test-integration/csp-harness/corpus.ts](test-integration/csp-harness/corpus.ts) so the same payloads exercise both security and display-fidelity paths.

UAT corpus impact: check `test-uat/corpus.csv` for rows that exercise raw-HTML display; regenerate UAT if `npm run uat:generate` rules change.

## Open questions to resolve in planning

- Exact handling of void elements and their canonical list. Reuse existing constants if any exist in [src/visual-constants.ts](src/visual-constants.ts); otherwise pick the HTML5 void-element list.
- Whether to write the walker as a small recursive function in [src/domain-utils.ts](src/domain-utils.ts) or factor it into a new file. Lean toward inline unless reuse appears.
- Self-closing form for SVG/MathML embedded content — match what the live DOM exposes, don't fight it.
- The "no data" status-container path ([src/visual.ts:255-269](src/visual.ts#L255-L269)) currently goes through the same `resolveForRawHtml`. Treat that path the same way — the user's "status message" is dev-set HTML, but showing it dev-tools-style is consistent and harmless.

## Dependencies and assumptions

- The `pretty` package (already a dependency) handles arbitrary HTML strings without throwing. Verify in planning; if it doesn't tolerate the dev-tools-style output (which is technically invalid HTML in some cases), either swap to a small inline indenter or wrap in try/catch and fall back to unindented output.
- No Power BI capabilities or settings schema change is required.

## Follow-up work

A separate brainstorm should cover the actionable sanitization diagnostic — a structured *"what was removed and why"* report sourced from the existing `uponSanitizeElement`, `uponSanitizeAttribute`, `sanitizeCss`, and `svg-payload-scan` decision points. That work is more invasive of security-sensitive code, has design questions around defense-in-depth (the visual becoming an interactive oracle for the rule set), and should not be coupled to this bug fix.

## Handoff to planning

Suggested next step: `/ce-plan` against this document. The plan should sequence: implement the dev-tools-style serializer with its tests, swap `getRawHtml` to use it, run `npm test` and `npm run test:all` (the latter includes the docs check), and verify against the test-uat workbook before declaring done.
