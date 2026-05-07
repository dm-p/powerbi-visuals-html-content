# UAT testing with the corpora

Two CSV exports are available for manual UAT in Power BI Desktop. Both share the same column shape so a single binding pattern handles both.

| File | Purpose |
|---|---|
| `test-uat/corpus.csv` | **Sanitization regression.** Every malicious and clean payload from the security corpus alongside the sanitized output produced by the current sanitizer. Use this to verify attack-vector handling. |
| `test-uat/lorem.csv` | **Rich-text rendering fidelity.** Body-styling-shaped fixtures — paragraphs, headings, ordered/unordered/nested lists, blockquotes, tables, article structure — that the visual must render unchanged. Use this to exercise default body styling and rich-text content. |

## Regenerating both CSVs

Re-run `npm run uat:generate` after any change to the source corpora or the sanitizer. The vitest suite (`test/lorem-rendering.test.ts`) asserts that `lorem.csv` and `LOREM_PAYLOADS` cannot drift apart — a stale CSV fails CI.

```bash
npm run uat:generate
```

Both files share these columns:

| Column | Description |
|---|---|
| `id` | Stable unique identifier for the row |
| `description` | Plain-language description of the case |
| `type` | `malicious`, `clean`, or `lorem` |
| `category` | Grouping (e.g. `css-url-per-property`, `event-handler`, `clean-baseline`, `lorem`) |
| `cspCategory` | CSP directive most likely to fire if the sanitizer leaks (`none` for clean and lorem rows) |
| `source` | Provenance: cert report, OWASP, code review, baseline, etc. |
| `input` | Raw HTML payload exactly as it would arrive from a data field |
| `sanitizedOutput` | The sanitizer's output for the current rule set |

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

### Sanitizer Testing

This tab is used to manually verify that all potential vulnerabilities are handled and that common render cases are not sanitized out.

This page has the **HTML Content (lite)** visual already set up with a live render and a raw output version, which (if you're using the AppSource GUID and have reloaded) will require no further setup.

When ready, use the slicer to navigate each test and visually confirm:

1. Any test under `clean` renders without any sanitization (valid)

2. Any test under `malicious` generates empty output (sanitized).

### Content Styling

This tab is used to ensure that neither the regular edition nor the sanitizer has any side effects on content passed in, and to expect the user to [apply simpler styling via properties](https://html-content.com/docs/properties-content-formatting#default-body-styling).

This page has two **HTML Content** visuals on the left (red border) and two **HTML Content (lite)** visuals on the right (yellow border). 

As you apply each test via the slicer:

1. The top rows are the test output with no property styling and should be identical.

2. The bottom rows are the test output with a body font of **Arial**, a color of **#118DFF**, a font size of **18px**, and an alignment of **center**. Again, output for both visual editions should match.


## How to report a sanitization bug

If the sanitizer drops content you think should be safe, or fails to drop something you think is dangerous, file an issue with:

1. The exact input that triggered it.

2. The output you got.

3. What you expected.

The maintainers will add a corresponding entry to the regression corpus so the same case can never silently regress.
