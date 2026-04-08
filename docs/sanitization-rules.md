# HTML and CSS Sanitization Rules

> **Audience:** Power BI report authors using the HTML Content visual.
> **Purpose:** Explain what the visual strips from your HTML and CSS payloads, and why, so you can write content that renders correctly without surprises.

The HTML Content visual treats every value passed in from your data as **untrusted input** and runs it through a sanitizer before adding it to the DOM. This is required by Microsoft AppSource certification and protects your report viewers from XSS, data exfiltration, and content-spoofing attacks.

The sanitizer enforces three layers of rules: HTML elements and attributes, CSS declarations, and URL schemes. This page documents each layer in plain language.

---

## Where sanitization runs

There are three places where content enters the visual and gets sanitized:

1. **Inline `style` attributes** on any HTML element — for example `<p style="color: red">`.
2. **`<style>` tag bodies** embedded in your HTML payload.
3. **The custom stylesheet setting** in the visual's format pane.

All three go through the same CSS rule set. Inline attributes additionally pass through the HTML-layer attribute allowlist.

---

## What's allowed

### HTML elements

The visual permits the following elements (everything else is dropped):

#### Block, sectioning, and structural
`address`, `article`, `aside`, `blockquote`, `details`, `div`, `dd`, `dl`, `dt`, `figcaption`, `figure`, `footer`, `h1`–`h6`, `header`, `hgroup`, `hr`, `main`, `menu`, `nav`, `ol`, `output`, `p`, `pre`, `search`, `section`, `summary`, `ul`, `li`

#### Inline and phrasing
`a`, `abbr`, `b`, `bdi`, `bdo`, `br`, `cite`, `code`, `data`, `del`, `dfn`, `em`, `i`, `ins`, `kbd`, `mark`, `meter`, `progress`, `q`, `rb`, `rp`, `rt`, `rtc`, `ruby`, `s`, `samp`, `small`, `span`, `strong`, `sub`, `sup`, `time`, `u`, `var`, `wbr`

#### Tables
`caption`, `col`, `colgroup`, `table`, `tbody`, `td`, `tfoot`, `th`, `thead`, `tr`

#### Images and styling
`img`, `style`

#### SVG
`svg`, `circle`, `clippath`, `defs`, `desc`, `ellipse`, `g`, `image`, `line`, `marker`, `mask`, `metadata`, `path`, `pattern`, `polygon`, `polyline`, `rect`, `stop`, `symbol`, `text`, `textpath`, `title`, `tspan`, `view`, `lineargradient`, `radialgradient`, the SVG animation tags (`animate`, `animatemotion`, `animatetransform`, `set`), and the SVG filter primitives (`filter`, `feblend`, `fecolormatrix`, etc.).

### HTML attributes

**Global attributes** (allowed on every element above):
`class`, `id`, `title`, `lang`, `dir`, `style`, `role`, `aria-*`, `data-*`, `tabindex`

**Element-specific attributes** are allowed on a per-element basis. For example:

| Element | Element-specific attributes |
|---|---|
| `a` | `href`, `target`, `rel`, `download`, `hreflang`, `type` |
| `img` | `src`, `alt`, `width`, `height`, `loading`, `decoding` |
| `time` | `datetime` |
| `del`, `ins` | `cite`, `datetime` |
| `output` | `for`, `form`, `name` |
| `meter` | `value`, `min`, `max`, `low`, `high`, `optimum` |
| `progress` | `value`, `max` |
| `details` | `open` |
| `table` cells | `colspan`, `rowspan`, `headers`, `scope` |
| SVG elements | The standard SVG attribute set for each element (positions, dimensions, styling, gradients, animation timing, etc.) |

Anything not on the global or element-specific list is dropped.

### URL schemes

For attributes that carry URLs (`href`, `src`, `xlink:href`):

- **`https:`** is allowed for `<a href>` (and processed by Power BI's `launchUrl()` API).
- **`http:`** is allowed for `<a href>` for backwards compatibility.
- **`data:` URIs** are allowed for `<img src>` and similar image attributes, but **only** if:
  - The MIME type is one of: `image/png`, `image/jpeg`, `image/jpg`, `image/gif`, `image/webp`, `image/bmp`. **`image/svg+xml` is rejected** because SVG can carry scripts.
  - The URI is **base64-encoded** (`data:image/png;base64,...`). A `data:image/png,...` URI without `;base64,` is always rejected because real binary image data cannot be plain-text — such a URI is always smuggling HTML or text behind an image declaration.

All other schemes (`javascript:`, `vbscript:`, `blob:`, `file:`, `ftp:`, `mailto:`, `tel:`, etc.) are rejected.

### CSS

Inline `style` attributes, `<style>` tag bodies, and the custom stylesheet setting all support standard CSS for declarations whose values do **not** reference external resources. See ["What's blocked and why"](#whats-blocked-and-why) below for the specific rules.

---

## What's blocked and why

### External URLs in CSS (`url(https://...)`, `url(http://...)`, etc.)

**Blocked.** Power BI's certified-visual sandbox does not allow visuals to fetch resources from arbitrary external origins. A `background: url(https://example.com/bg.png)` declaration triggers a Content Security Policy violation, produces console errors, and fails certification.

**Workaround:** embed images as base64 `data:image/...;base64,` URIs.

### Non-image data URIs

**Blocked.** A `data:` URI is only allowed inside CSS `url()` (or in `src`/`href` attributes) if its MIME type is on the image allowlist AND it is base64-encoded. This catches three categories of attack:

1. `data:text/html,<script>...</script>` smuggling executable HTML
2. `data:image/png,<html>...</html>` declaring an image MIME but carrying plain text
3. `data:image/svg+xml,...` declaring an image MIME but carrying SVG (which can contain `<script>`)

### `@import` and `@font-face`

**Blocked.** Both load external resources by design — `@import` pulls in remote CSS, `@font-face` pulls in remote font files. Both bypass the image-only restriction and are used in CSS exfiltration attacks.

**Workaround:** copy the CSS rules you need into your stylesheet directly, and use the system font stack (`'Segoe UI', sans-serif`, etc.) instead of custom web fonts.

### Other at-rules

The only at-rules permitted are: `@media`, `@supports`, `@keyframes`, `@-webkit-keyframes`, `@font-feature-values`, `@page`. Everything else (`@namespace`, `@charset`, `@document`, and any unknown at-rule) is dropped.

### Legacy IE / Mozilla CSS extensions

**Blocked.** The `expression()` function, `-moz-binding` property, `behavior` property, and `filter: progid:DXImageTransform.*` syntax all enable script execution in legacy browsers and are blocked regardless of the current rendering target.

### The CSS `attr()` function

**Blocked.** Although `attr()` is a standard CSS function, it is not used by typical report content and has historically been a vector for reading element attribute values during CSS rendering — for example to exfiltrate `data-*` attributes via a generated-content side-channel. Any declaration whose value contains `attr(...)` is dropped.

### Event handler attributes

**Blocked.** Any attribute matching `on*` (`onclick`, `onload`, `onerror`, `onmouseover`, etc.) causes the **entire element** to be dropped — not just the attribute. This is stricter than stripping the attribute alone, because a tag with a stripped event handler can still produce errors if it loads a now-orphaned `src`/`href`.

### Disabled HTML attributes

The following attributes are dropped from any element regardless of context:

- **`srcdoc`** — embeds an HTML document inside an attribute, which then executes as a real document.
- **`formaction`**, **`action`** — form submission targets, used to redirect submitted data to attacker-controlled URLs.
- **`ping`** — `<a ping="...">` fires network requests to arbitrary URLs when clicked.
- **`background`** — legacy HTML URL-loading attribute.
- **`poster`** — `<video poster="...">` loads an external image before playback.
- **`srcset`** — comma-delimited list of URLs, too complex to safely sanitize for the visual's needs. Use plain `src` instead.

### Disallowed HTML elements

`<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>`, and any element not on the allowed-tag list above are dropped entirely (along with all their content).

### Unicode obfuscation of dangerous schemes

URL attributes are NFKC-normalized before scheme matching. This means `<a href="ｊavascript:alert(1)">` (with a fullwidth `ｊ`) gets normalized to `javascript:` and rejected — the visual mirrors what browsers do internally when parsing URLs.

---

## Workarounds

**I want to use a background image.** Convert your image to a base64 `data:image/png;base64,...` (or `image/jpeg`, etc.) URI and embed it directly in the CSS. This is the only image source the sandbox permits.

**I want a custom font.** Use the system font stack instead — `font-family: 'Segoe UI', Tahoma, Arial, sans-serif`. Custom web fonts via `@font-face` are blocked.

**I want to import a shared stylesheet.** Copy the rules you need into your custom stylesheet directly. `@import` is blocked.

**I want to attach click handlers.** Use Power BI's built-in cross-filtering and tooltip features instead of inline event handlers. Inline event handlers cause the entire element to be dropped.

**My styling disappeared after I upgraded.** See ["Troubleshooting"](#troubleshooting).

---

## Troubleshooting

### "My inline `style="..."` is gone"

Most likely one of:

- The value contained a `url(...)` referencing an external host or non-image data URI (whole declaration dropped).
- The value contained `expression()`, `attr()`, `-moz-binding`, `behavior:`, or `filter: progid:` (whole declaration dropped).
- The value contained a bare scheme like `javascript:` somewhere (whole declaration dropped).

Check the browser console — the visual emits `console.warn` messages explaining what was dropped and why.

### "My `<style>` tag is empty"

The block contained content matched by the [defense-in-depth final pass](#defense-in-depth). This fires when the postcss-based sanitizer leaves something dangerous in the output (typically inside a CSS comment). The whole `<style>` body is replaced with empty.

### "My image isn't loading"

Check the `src` value:

- External URLs (`http://`, `https://`) are blocked. Convert to a base64 data URI.
- `data:image/svg+xml,...` is blocked. Use PNG/JPEG instead.
- `data:image/png,...` without `;base64,` is blocked. Re-encode as base64.

### "An entire `<element>` is missing"

Most common causes:
- The element was on an event handler (`onclick`, `onload`, etc.) — the entire element is dropped, not just the attribute.
- The element is not on the allowed-tag list (`<script>`, `<iframe>`, `<object>`, etc.).

---

## Defense in depth

After the postcss-based CSS sanitizer parses, walks, and re-serializes a stylesheet, a final regex scan runs over the output looking for known-dangerous tokens (`@import`, `expression(`, `javascript:`, `-moz-binding`, `behavior:`, `progid:`, etc.). If any match, the entire block is dropped and a `console.warn` is emitted.

This is a safety net, not the primary mechanism — the parser-based rules are the source of truth. The final pass exists to catch parser escapes we didn't anticipate, especially content smuggled through CSS comments (which the parser preserves verbatim by design).

---

## Worked examples

The examples below show specific input/output pairs taken from the sanitizer's regression test corpus. They're auto-generated from the test fixtures, so they always reflect the current rule set.

<!-- WORKED_EXAMPLES_START — Task 21's generate-sanitization-docs.ts script populates this section. Do not edit by hand. -->
<!-- WORKED_EXAMPLES_END -->

---

## How to report a sanitization bug

If the sanitizer drops content you think should be safe, or fails to drop something you think is dangerous, file an issue with:

1. The exact input that triggered it.
2. The output you got.
3. What you expected.

The maintainers will add a corresponding entry to the regression corpus so the same case can never silently regress.
