# UAT testing with the corpora

Four CSV exports are available for manual UAT in Power BI Desktop. The first three share the same column shape (a single binding pattern handles all); the fourth has its own shape because the CSS payload is operator-pasted into the format pane rather than bound to the visual.

| File | Sanitization surface | Hyperlinks toggle | Purpose |
|---|---|---|---|
| `test-uat/corpus.csv` | 1 (inline `style`) + 2 (`<style>` in data) | OFF (production default) | **Sanitization regression.** Every malicious and clean payload from the security corpus alongside the sanitized output produced by the current sanitizer. Use this to verify attack-vector handling. |
| `test-uat/lorem.csv` | 1 + 2 | OFF (production default) | **Rich-text rendering fidelity.** Body-styling-shaped fixtures — paragraphs, headings, ordered/unordered/nested lists, blockquotes, tables, article structure — that the visual must render unchanged. Use this to exercise default body styling and rich-text content. |
| `test-uat/hyperlinks.csv` | 1 + 2 | ON | **Hyperlinks-enabled rendering and rejection.** Positive cases (`<a href="https://...">` and SVG `<a>` with both `href` and `xlink:href` forms must survive and render as clickable links delegating to `host.launchUrl`) and negative cases (`javascript:`, `data:`, `mailto:`, `tel:`, fragment-only, and relative hrefs must still be dropped even with the toggle ON, because the format-pane toggle controls whether `href` may populate; the per-tag scheme allowlist independently controls which schemes survive). Bind in a Power BI report page with the visual's **Allow opening URLs** setting enabled. |
| `test-uat/stylesheet.csv` | 3 (Custom stylesheet setting) | OFF (production default) | **Custom-stylesheet sanitization.** Pairs of (HTML payload, CSS payload) where the operator binds the HTML and pastes the CSS into the format pane. Tests the third sanitization surface (per `docs/sanitization-rules.md`) — surfaces 2 and 3 share `sanitizeCss(..., 'stylesheet')` but reach the DOM via different injection points, and the body-styling cascade override (issue #144) is gated on whether surface 3 is supplied. |

## Regenerating the CSVs

Re-run `npm run uat:generate` after any change to the source corpora or the sanitizer. Three vitest suites assert that the CSVs stay in lockstep with their fixture sources — a stale CSV fails CI:

- `test/lorem-rendering.test.ts` covers `lorem.csv` ↔ `LOREM_PAYLOADS`
- `test/hyperlinks-rendering.test.ts` covers `hyperlinks.csv` ↔ `HYPERLINKS_PAYLOADS`
- `test/stylesheet-rendering.test.ts` covers `stylesheet.csv` ↔ `STYLESHEET_PAYLOADS`

The basic corpus, 'lorem', and 'hyperlinks' tests use these columns:

| Column | Description |
|---|---|
| `id` | Stable unique identifier for the row |
| `description` | Plain-language description of the case |
| `type` | `malicious`, `clean`, `lorem`, or `hyperlinks` |
| `category` | Grouping (e.g. `css-url-per-property`, `event-handler`, `clean-baseline`, `lorem`) |
| `cspCategory` | CSP directive most likely to fire if the sanitizer leaks (`none` for clean and lorem rows) |
| `source` | Provenance: cert report, OWASP, code review, baseline, etc. |
| `input` | Raw HTML payload exactly as it would arrive from a data field |
| `sanitizedOutput` | The sanitizer's output for the current rule set |

Each row in `test-uat/stylesheet.csv` carries:

| Column | Description |
|---|---|
| `id` | Stable identifier with the `style-` prefix |
| `description` | Plain-language description of the test case |
| `expected_outcome` | Short visual confirmation hint — what the operator should see |
| `html_input` | The HTML payload to bind to the visual (Values field) |
| `html_sanitized` | What the HTML sanitizer emits for `html_input` (reference; should match what the visual renders) |
| `css_input` | The CSS to paste into the format pane Custom stylesheet setting |
| `css_sanitized` | What `getSanitizedCss(css_input)` emits — what the visual will actually inject into `<head>` |

## To use in Power BI Desktop

The [Test Workbook](../test-uat/html-content-uat.pbip) can be opened in any version of Power BI that supports PBIP format.

### Local Workbook Setup

1. Edit [expressions.tmdl](../test-uat/html-content-uat.SemanticModel/definition/expressions.tmdl) and edit the `[add current path here]` placeholder for `RepoRoot` to match the path of the current file for your checkout, e.g.:

    If you've checked out to `C:\Repos` and left the repo name intact:
    
    - Your value will be: `C:\Repos\powerbi-visuals-html-content`.
    - The full expression value will be `"C:\Repos\powerbi-visuals-html-content\test-uat"`.

2. Open the project in Power BI Desktop and click **Refresh** to load the CSV data to the semantic model.

3. Double-check that the workbook is set to [allow testing of a published custom visual](https://learn.microsoft.com/en-us/power-bi/developer/visuals/submission-testing#enable-developer-mode-in-power-bi-desktop). It's committed with this setting, but Power BI likes to reset it each time the workbook is opened.

4. Load the packaged visual and confirm you're loading the local version rather than the AppSource one.

Once loaded, you will need to refresh the visual, as Power BI doesn't reload visuals on the active canvas. The easiest way is to navigate away from the current page and back, which will force a re-initialization.

### Sanitizer Testing (Data Only)

This tab is used to manually verify that all potential vulnerabilities are addressed and that common rendering cases are not sanitized.

This page has the **HTML Content (lite)** visual already set up with a live render and a raw output version, which (if you're using the AppSource GUID and have reloaded) will require no further setup.

When ready, use the slicer to navigate each test and visually confirm:

1. Any test under `clean` renders without any sanitization (valid)

2. Any test under `malicious` generates empty output (sanitized).

### Sanitizer Testing (Data + Stylesheet)

This tab is used to verify that CSS pasted into the visual's format pane > **Stylesheet** > **Custom stylesheet** setting is sanitized correctly. This is the third sanitization surface (per [`docs/sanitization-rules.md`](sanitization-rules.md)) and the only one whose sanitized output reaches the DOM via `<style id="visualUserStylesheet">` in the page `<head>` rather than the visual's content container.

Its layout is similar to **Sanitizer Testing (Data Only)**, in that it has two instances of **HTML Content (lite)**: one showing rendered output and one showing raw output. The table shows both input HTML and CSS and their expected (sanitized) output for comparison/validation.

There is a mix of clean and adversarial scenarios:

- **Clean baselines**: 
    - Basic class selectors
    - CSS variables
    - modern functions (`clamp`, `rgba`)
    - Multi-line `:has()` selectors
    - Fragment-only `url(#id)`
    - `data:image/svg+xml` backgrounds,
    - `@media` + `@keyframes`
    
    All must render their declared effect.

- **Sanitization regression**:
    - `@import` of external CSS,
    - `expression()`
    - `url(javascript:...)`
    - external `url(https://...)`
    - `-moz-binding`
    
    All must be silently dropped; safe sibling declarations on the same rule must survive (partial-survival).

### Content Styling

This tab is used to ensure that neither the regular edition nor the sanitizer has any side effects on content passed in, and to expect the user to [apply simpler styling via properties](https://html-content.com/docs/properties-content-formatting#default-body-styling).

This page has three **HTML Content** visuals along the top row (red border) and three **HTML Content (lite)** visuals along the bottom row (yellow border). 

As you apply each test via the slicer:

1. The left visuals rows are the test output with no property styling and should be identical.

2. The middle visuals are the test output with a body font of **Arial**, a color of **#118DFF**, a font size of **18px**, and an alignment of **center**. Again, output for both visual editions should match.

3. The right visuals show the DOM as sent to the appropriate visual using _Show raw HTML_. This should be as expected.

### Hyperlinks Enabled

This tab is bound to `test-uat/hyperlinks.csv` and exercises the format-pane **Behavior** > **Allow opening URLs** toggle in its ON state. The default sanitizer state (toggle OFF) strips `href` from every `<a>` so the visual emits no clickable URL surface at all; this tab is the only place where the toggle-on rendering path is verified end-to-end against a live visual.

This page has two **HTML Content** visuals along the top row (red border) and two **HTML Content (lite)** visuals along the bottom row (yellow border).

For each row, navigate via the slicer and visually confirm for the **HTML Content (lite)** visuals:

1. **Positive rows** (`hyperlinks-clean-*`) - the rendered link is visible and styled as a link (anchor tags pick up browser-default underline/cursor unless the body styling overrides them). 

    - Click the link and confirm Power BI shows its native "open URL" prompt the first time, then opens the URL in a new tab.
    - Verify both HTML `<a href>` and SVG `<a>` with `xlink:href` / `href` forms behave the same way.

2. **Negative rows** (`hyperlinks-reject-*`) — the link text is still visible (the `<a>` element survives so styling and content don't get dropped) but the click does nothing. This is intentional - the per-tag scheme allowlist rejects:

    - `javascript:` and `data:` schemes (dangerous; rejected on security grounds even when the toggle is on)
    - `mailto:` and `tel:` schemes (Power BI's `host.launchUrl` only supports http(s), so they would no-op anyway — the sanitizer drops them so the rendered DOM never advertises a link that won't work)
    - Fragment-only (`#anchor`) and relative (`/path`) hrefs (no scheme means they fall outside the allowlist; in-page navigation isn't a meaningful concept inside a Power BI visual)

The raw-output companion visual shows the post-sanitization DOM directly, which is the most reliable confirmation that the rejection cases actually have no `href` attribute (independent of how the link styling presents).

## How to report a sanitization bug

If the sanitizer drops content you think should be safe, or fails to drop something you think is dangerous, file an issue with:

1. The exact input that triggered it.

2. The output you got.

3. What you expected.

The maintainers will add a corresponding entry to the regression corpus so the same case can never silently regress.
