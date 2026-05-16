---
title: Show Raw HTML toggle HTML-encoded attribute values via .outerHTML (issue #76)
date: 2026-05-15
category: ui-bugs
module: src/domain-utils.ts
problem_type: ui_bug
component: tooling
severity: medium
symptoms:
  - "Show Raw HTML textarea displays &amp;, &lt;, &gt;, &quot; in attribute values where the source had literal &, <, >, \""
  - "Users report visual 'mangled' their HTML because the debug view doesn't match what they pasted (GitHub #76)"
  - "Debug output diverges from what a browser dev tools Elements panel would show for the same live DOM"
  - "iframe src attributes with query strings render as src=\"...&amp;b=2\" instead of src=\"...&b=2\""
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - documentation
  - testing_framework
tags:
  - power-bi-visual
  - dom-serialization
  - outerhtml
  - dev-tools-display
  - debug-surface
  - entity-encoding
  - html-serializer
  - github-issue-76
---

# Show Raw HTML toggle HTML-encoded attribute values via .outerHTML (issue #76)

## Problem

The "Show Raw HTML" toggle in the Power BI visual's format pane is the only debug surface available to report authors inside Power BI Desktop, since Desktop has no developer tools. Authors use this textarea to introspect what the visual actually rendered after the sanitizer ran — to confirm their HTML/CSS arrived intact, or to see what was stripped.

The previous implementation in `src/domain-utils.ts` used `container.node().outerHTML` to populate that textarea. `.outerHTML` is the HTML-spec serializer: it produces a string that re-parses identically, which means it entity-encodes special characters inside attribute values and text nodes. Authors looking at the textarea saw `&amp;`, `&lt;`, and `&quot;` instead of the literal characters they had typed, and reasonably concluded the visual had mangled their input. The DOM was fine; only the debug display was misleading.

The semantic mismatch: `.outerHTML` is for HTML serialization (round-trippable output). Browser dev tools' Elements panel shows attribute values with **decoded** characters (the literal in-DOM string). The debug surface should match dev-tools fidelity, not HTML round-trippability — but it was using the wrong tool for the job.

Tracked as GitHub issue [#76](https://github.com/dm-p/powerbi-visuals-html-content/issues/76) on `dm-p/powerbi-visuals-html-content`.

## Symptoms

- `<iframe src="https://example.com/?a=1&b=2">` rendered correctly, but textarea displayed `src="https://example.com/?a=1&amp;b=2"`.
- `<p title="3 < 4">` rendered correctly, but textarea displayed `title="3 &lt; 4"`.
- `<p>Tom & Jerry</p>` displayed text as `Tom &amp; Jerry` in the raw output, even though the rendered page showed `Tom & Jerry`.
- Authors filed bug reports believing the visual had corrupted their data, when only the debug view was wrong.

## What Didn't Work

- **Always show the user's input string** (skip serializing the rendered DOM): rejected. Loses fidelity to what the sanitizer actually produced — the author can no longer see that `<script>` tags were stripped, or that CSS was rewritten. The debug surface must reflect post-sanitizer reality.
- **Keep `.outerHTML` and post-process to decode entities**: rejected. String-level entity decoding is fragile: the same `&amp;` sequence needs different handling in attribute-value context versus text-node context (e.g., `<` is legal in a text node but not in an attribute value), and the post-processor would re-introduce every parser corner case the browser already solved internally.
- **Add a "what was removed" diff diagnostic** alongside the raw view: out of scope. Deferred to a separate brainstorm — it raises defense-in-depth concerns about disclosing sanitizer rules as an oracle.
- **Drop the `pretty` dependency now that the walker took over**: evaluated and explicitly rejected. When a structural rewrite obviates a third-party helper, the right move is to evaluate dropping it consciously rather than carry it on autopilot — but in this case `pretty` still earns its keep by providing block-level indentation that would otherwise need reimplementation, and empirical verification confirmed it preserves the literal characters our walker emits. Defense-in-depth `try/catch` was added around the call instead.

## Solution

A new `domSerialize` walker in `src/domain-utils.ts` recursively serializes a DOM node with **dev-tools fidelity** rather than spec-compliant HTML round-trippability. `getRawHtml` now calls this walker instead of `.outerHTML`.

### The walker (compact form)

```typescript
// src/domain-utils.ts
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'source', 'track', 'wbr'
]);

/** @internal Dev-tools-style serializer: attribute values stay decoded. */
export const domSerialize = (node: Node): string => {
    switch (node.nodeType) {
        case Node.ELEMENT_NODE: {
            const el = node as Element;
            // SVG names are case-sensitive (e.g. linearGradient);
            // HTML names lowercased to match dev tools.
            const tag = el.namespaceURI === 'http://www.w3.org/2000/svg'
                ? el.tagName
                : el.tagName.toLowerCase();
            let attrs = '';
            for (const attr of el.attributes) {
                // Escape ONLY " — the delimiter. & < > ' stay literal
                // (dev-tools contract).
                const value = attr.value.replace(/"/g, '&quot;');
                attrs += ` ${attr.name}="${value}"`;
            }
            if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs}>`;
            let inner = '';
            for (const child of el.childNodes) inner += domSerialize(child);
            return `<${tag}${attrs}>${inner}</${tag}>`;
        }
        case Node.TEXT_NODE:
            return node.nodeValue ?? '';
        case Node.COMMENT_NODE:
            return `<!--${node.nodeValue ?? ''}-->`;
        case Node.DOCUMENT_FRAGMENT_NODE: {
            let out = '';
            for (const child of node.childNodes) out += domSerialize(child);
            return out;
        }
        default:
            return '';
    }
};
```

### The `outerHTML` swap in `getRawHtml`

```typescript
// BEFORE
return pretty(
    `${ssFragment} ${container.node().outerHTML}`
);

// AFTER
const contentNode = container.node();
if (!contentNode) return '';
const ssFragment = includeStylesheet
    ? domSerialize(styleSheetContainer.node()!)
    : '';
// Conditional separator: no stray leading space when stylesheet absent.
const raw = `${ssFragment}${ssFragment ? ' ' : ''}${domSerialize(contentNode)}`;
try {
    return pretty(raw);
} catch (e) {
    console.warn(
        'getRawHtml: pretty() threw, returning unindented walker output:',
        e
    );
    return raw;
}
```

The conditional `${ssFragment ? ' ' : ''}` eliminates the stray leading space when no stylesheet is present. The `try/catch` keeps the debug toggle functional even if `pretty()` ever rejects technically-invalid HTML the walker emits.

### Dev-tools-style serialization for a sample DOM

Given this DOM (after sanitization):

```html
<div>
  <a href="https://example.com/?a=1&b=2" title="Tom &amp; Jerry">click</a>
  <p>3 < 4 and "quoted"</p>
</div>
```

`.outerHTML` (before) emits:

```html
<div><a href="https://example.com/?a=1&amp;b=2" title="Tom &amp; Jerry">click</a><p>3 &lt; 4 and "quoted"</p></div>
```

`domSerialize` (after) emits:

```html
<div><a href="https://example.com/?a=1&b=2" title="Tom & Jerry">click</a><p>3 < 4 and "quoted"</p></div>
```

Only the `"` attribute delimiter is escaped when present in a value — e.g., `<p data-json='{"k":"v"}'>` serializes as `<p data-json="{&quot;k&quot;:&quot;v&quot;}">` so the always-double-quoted attribute delimiter stays balanced.

### Test scenario sealing the regression

`test/domain-utils.test.ts` includes a verbatim reproduction of issue #76. The iframe is constructed directly via `createElement` rather than through the sanitizer pipeline so the test stays valid even if the sanitizer rules change to allow iframes:

```typescript
it('reproduces issue #76 verbatim — iframe with & in src serialized correctly even though sanitizer strips it today', () => {
    const { styleSheetContainer, container, dom } = buildContainers('');
    const iframe = dom.window.document.createElement('iframe');
    iframe.setAttribute(
        'src',
        'https://www.google.com/search?q=url+ampersand&num=5'
    );
    iframe.setAttribute(
        'style',
        'position: fixed; width: 100%; height: 100%'
    );
    (container.node() as Element).appendChild(iframe);
    const out = getRawHtml(
        styleSheetContainer,
        container,
        buildStylesheetSettings()
    );
    expect(out).toContain(
        'src="https://www.google.com/search?q=url+ampersand&num=5"'
    );
    expect(out).not.toContain('&amp;');
});
```

45+ unit tests in total cover walker primitives per node type, end-to-end `getRawHtml`, SVG tag-case preservation, the `pretty()` fallback path (via `vi.mock('pretty')`), and the issue-#76 reproduction. Four new lorem fixtures in `test/fixtures/lorem.ts` (anchor with `&`, attribute with `<` and `&`, text with HTML entities, attribute with `"`) let UAT workbook authors visually verify each scenario in Power BI Desktop.

### Adjacent cleanup

- **TS strictness pass** (commit `09857a7`): enabled `esModuleInterop: true` in `tsconfig.json` to allow `import pretty from 'pretty'` and `import OverlayScrollbars from 'overlayscrollbars'` (both `export = X` modules), replacing legacy `require(...)` and `import * as X` forms. Wrapped four d3 `.style()` calls in `() => …` so d3 selects the `ValueFn` overload (the `string | null` return of `resolveBodyStyle` doesn't match the narrow scalar overloads). Refactored `resolveHtmlGroupElement`'s `.append(function)` returning a `DocumentFragment` to `.each(function)` doing the `appendChild` side-effect honestly.
- **Code-review pass** (commit `97d475d`): 12 items including null guards in `getRawHtml`, `@internal` JSDoc on `domSerialize` and `getRawHtml`, conversion of index-loops to `for…of`, expanded JSDoc, `console.warn` binding correctness, SVG case preservation, `postcss-value-parser` default import in `src/css-sanitizer.ts`, and `DOMPurify` default import in `src/sanitize-pipeline.ts`.

## Why This Works

- **Right tool for the right contract.** Dev tools and the textarea both want "what's in the DOM, readable." A custom walker reads `Element.attributes[i].value` directly — that's already the decoded in-DOM string. `.outerHTML` re-encodes for round-trippability, a different goal.
- **Minimal escaping preserves fidelity.** Escaping only `"` keeps attribute delimiters balanced without surprising the author with re-encoded `&`, `<`, `>`, or `'`. The output is intentionally not guaranteed to re-parse — it's a debug view, not a serialization format.
- **SVG case preservation** keeps tag names like `<linearGradient>` and `<feGaussianBlur>` correct (SVG uses case-sensitive element names), while HTML tags lowercase to match dev tools' canonical display.
- **Walker-shaped tests** cover each `nodeType` branch independently, so future contributors changing one branch can't silently regress another.
- **The `pretty()` try/catch** is defense-in-depth: the walker can emit technically-invalid HTML (e.g. unclosed `<p>` inside `<p>` from author input, or attribute values containing `"`), and `pretty` might reject it; the toggle stays useful with unindented output rather than crashing the visual.
- **Reproduction test bypasses the sanitizer** by constructing the iframe via `createElement`, so the regression test stays valid even if sanitizer rules later strip or rewrite iframes.

## Prevention

- **For any debug surface showing "what the system produced," prefer a custom walker over `.outerHTML`** when the goal is dev-tools fidelity rather than HTML round-trippability. They are different contracts and conflating them will mislead users.
- **Distinguish "what re-parses" from "what reads."** HTML serialization (`.outerHTML`, `XMLSerializer`) optimizes for the former; debug surfaces want the latter. Pick deliberately.
- **For attribute escaping, prefer the minimal targeted escape needed for delimiter balance** (only `"` when wrapping in `"..."`) rather than blanket entity encoding. Authors should see what they typed.
- **When carrying a third-party utility through a structural rewrite, explicitly evaluate whether it's still earning its keep.** Don't drop it on reflex either — keep it if it still provides value, but make the decision consciously and add defense-in-depth (try/catch) when its inputs change shape.
- **Seal regressions against their adjacent moving parts.** The issue-#76 reproduction test bypasses the sanitizer so it remains valid if sanitizer rules later allow or strip iframes — the test isolates the serializer behavior from unrelated changes.
- **Surface invariants in tests at the boundary the user observes** — for a debug textarea, that's the final string; not the DOM, not the intermediate fragments.

## Related Issues

- [GitHub issue #76](https://github.com/dm-p/powerbi-visuals-html-content/issues/76) — origin bug report (iframe URL with `&` showing as `&amp;` in raw HTML view).
- [docs/brainstorms/2026-05-14-fix-show-raw-html-entity-encoding.md](../brainstorms/2026-05-14-fix-show-raw-html-entity-encoding.md) — the brainstorm that established the dev-tools-style contract (status: implemented).
- [docs/plans/2026-05-14-001-fix-show-raw-html-dev-tools-style-serializer-plan.md](../plans/2026-05-14-001-fix-show-raw-html-dev-tools-style-serializer-plan.md) — the implementation plan (status: completed).

### Relevant files

- `src/domain-utils.ts` — `domSerialize` walker, refactored `getRawHtml`
- `test/domain-utils.test.ts` — 45+ tests including issue #76 reproduction and `pretty` fallback
- `test/fixtures/lorem.ts` — 4 new UAT fixtures exercising the entity scenarios
- `src/css-sanitizer.ts` — `postcss-value-parser` default-import fix
- `src/sanitize-pipeline.ts` — `DOMPurify` default-import fix
- `tsconfig.json` — `esModuleInterop: true`

### Commits on `fix/improve-raw-output`

- `b0ea999` feat: add dev-tools-style DOM serializer (domSerialize)
- `c117db6` fix: serialize Show Raw HTML view with dev-tools-style walker
- `13b97dc` test: add lorem fixtures + verbatim #76 reproduction
- `09857a7` refactor: clean up TypeScript errors surfaced by VS Code in domain-utils.ts
- `0b273aa` tests: Update UAT workbook and instructions for validation
- `97d475d` fix: address code-review findings on Show Raw HTML serializer
- `55a9b2f` docs: fix typo
- `0813c3e` fix: escape literal " in attribute values + trim leading space in raw HTML
