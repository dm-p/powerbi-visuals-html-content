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


### Microsoft certification report payloads

The exact payloads flagged by Microsoft's certification review.

#### Inline style with content:url() pointing at a non-image data URI. Browser attempts to fetch and triggers img-src CSP violation.

**Input:**

```html
<div style="content:url(data:1234***qwerty)">Hello</div>
```

**Output:**

```html
<div>Hello</div>
```

#### Image element with non-image data URI in src attribute. Browser attempts to load and triggers img-src CSP violation.

**Input:**

```html
<img src="data:1234***qwerty" alt="x">
```

**Output:**

```html
<img alt="x">
```

### CSS `url()` across CSS properties

Every CSS property that accepts a `url()` function, asserted against unsafe arguments.

#### background property with external URL.

**Input:**

```html
<div style="background: url(https://attacker.example/x.png)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### background-image with external URL.

**Input:**

```html
<div style="background-image: url(https://attacker.example/x.png)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### cursor property with external URL.

**Input:**

```html
<div style="cursor: url(https://attacker.example/x.cur), auto">x</div>
```

**Output:**

```html
<div>x</div>
```

#### list-style-image with external URL.

**Input:**

```html
<ul style="list-style-image: url(https://attacker.example/x.png)"><li>x</li></ul>
```

**Output:**

```html
<ul><li>x</li></ul>
```

#### border-image with external URL.

**Input:**

```html
<div style="border-image: url(https://attacker.example/x.png) 30">x</div>
```

**Output:**

```html
<div>x</div>
```

#### mask with external URL.

**Input:**

```html
<div style="mask: url(https://attacker.example/x.svg)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### mask-image with external URL.

**Input:**

```html
<div style="mask-image: url(https://attacker.example/x.svg)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### -webkit-mask with external URL.

**Input:**

```html
<div style="-webkit-mask: url(https://attacker.example/x.svg)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### shape-outside with external URL.

**Input:**

```html
<div style="shape-outside: url(https://attacker.example/x.png)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### clip-path with external URL.

**Input:**

```html
<div style="clip-path: url(https://attacker.example/x.svg#c)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### filter with external URL.

**Input:**

```html
<div style="filter: url(https://attacker.example/x.svg#f)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### offset-path with external URL.

**Input:**

```html
<div style="offset-path: url(https://attacker.example/x.svg#p)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### CSS custom property carrying url() that is referenced via var().

**Input:**

```html
<div style="--bg: url(https://attacker.example/x.png); background: var(--bg)">x</div>
```

**Output:**

```html
<div style="background:var(--bg)">x</div>
```

### CSS `url()` scheme variants

Every scheme or pseudo-scheme that might appear inside a `url()` argument.

#### https url() in background.

**Input:**

```html
<div style="background: url(https://attacker.example/x.png)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### http url() in background.

**Input:**

```html
<div style="background: url(http://attacker.example/x.png)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### protocol-relative url() in background.

**Input:**

```html
<div style="background: url(//attacker.example/x.png)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### relative url() in background.

**Input:**

```html
<div style="background: url(/x.png)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### data:text/html in background.

**Input:**

```html
<div style="background: url(data:text/html,<script>alert(1)</script>)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### data:text/javascript in background.

**Input:**

```html
<div style="background: url(data:text/javascript,alert(1))">x</div>
```

**Output:**

```html
<div>x</div>
```

#### data:text/css in background.

**Input:**

```html
<div style="background: url(data:text/css,body{background:red})">x</div>
```

**Output:**

```html
<div>x</div>
```

#### data:font/woff in @font-face — must be blocked because @font-face is dropped.

**Input:**

```html
<style>@font-face { font-family: x; src: url(data:font/woff,abc) }</style>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### data:image/svg+xml is blocked even though it is image/* — SVG can carry scripts.

**Input:**

```html
<img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>">
```

**Output:**

```html
<img>
```

#### blob: scheme in background.

**Input:**

```html
<div style="background: url(blob:https://attacker.example/x)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### filesystem: scheme in background.

**Input:**

```html
<div style="background: url(filesystem:https://attacker.example/persistent/x)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### javascript: scheme in background url().

**Input:**

```html
<div style="background: url(javascript:alert(1))">x</div>
```

**Output:**

```html
<div>x</div>
```

#### Empty url().

**Input:**

```html
<div style="background: url()">x</div>
```

**Output:**

```html
<div>x</div>
```

#### Whitespace-only url().

**Input:**

```html
<div style="background: url( )">x</div>
```

**Output:**

```html
<div>x</div>
```

### Data URI MIME smuggling

Data URIs that declare a safe MIME type but carry unsafe content.

#### image/png declared but content is HTML.

**Input:**

```html
<img src="data:image/png,<html><body>hi</body></html>">
```

**Output:**

```html
<img>
```

#### Whitespace inserted into MIME type to evade pattern match.

**Input:**

```html
<img src="data: image/png ,abc">
```

**Output:**

```html
<img>
```

#### Tab character inserted into MIME type.

**Input:**

```html
<img src="data:image/png	,abc">
```

**Output:**

```html
<img>
```

#### Control character (0x01) inserted into MIME type.

**Input:**

```html
<img src="data:image/png,abc">
```

**Output:**

```html
<img>
```

#### CSS url() with a safe image MIME type but no base64 encoding — the content is plain-text HTML smuggled behind an image/png declaration.

**Input:**

```html
<div style="background: url(data:image/png,<svg/onload=alert(1)>)">x</div>
```

**Output:**

```html
<div>x</div>
```

#### Data URI with no MIME type (data:,payload). RFC 2397 defaults to text/plain, which is not on the image allowlist.

**Input:**

```html
<img src="data:,<script>alert(1)</script>" alt="x">
```

**Output:**

```html
<img alt="x">
```

### CSS at-rules

At-rules that load external resources or bypass other rules.

#### @import with external URL.

**Input:**

```html
<style>@import url(https://attacker.example/x.css);</style>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### @font-face with external src.

**Input:**

```html
<style>@font-face { font-family: x; src: url(https://attacker.example/x.woff); }</style>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### @namespace with external URL.

**Input:**

```html
<style>@namespace url(https://attacker.example/);</style>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### @document with external URL match.

**Input:**

```html
<style>@document url(https://attacker.example/) { body { color: red; } }</style>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### @import nested inside @media.

**Input:**

```html
<style>@media screen { @import url(https://attacker.example/x.css); }</style>
```

**Output:**

```html
<style>@media screen { }</style>
```

#### Unclosed <style> tag. The preprocessStyleTags regex requires a closing </style> to match; if absent, the raw CSS body would bypass postcss sanitization without the uponSanitizeElement backstop.

**Input:**

```html
<style>@import url(https://attacker.example/evil.css)</style>
```

**Output:**

```html
(empty — entire input was dropped)
```

### Event handler attributes

HTML `on*` attributes that execute script.

#### onclick handler.

**Input:**

```html
<div onclick="alert(1)">x</div>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### onload handler on img.

**Input:**

```html
<img src="data:image/png;base64,iVBORw0KGgo=" onload="alert(1)">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### onerror handler on img with bad src.

**Input:**

```html
<img src="x" onerror="alert(1)">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### onmouseover handler.

**Input:**

```html
<div onmouseover="alert(1)">x</div>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### onfocus handler on input.

**Input:**

```html
<input onfocus="alert(1)" autofocus>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### onanimationstart handler.

**Input:**

```html
<div onanimationstart="alert(1)">x</div>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### ontransitionend handler.

**Input:**

```html
<div ontransitionend="alert(1)">x</div>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### OnClick mixed case.

**Input:**

```html
<div OnClick="alert(1)">x</div>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### onbegin on SVG animate.

**Input:**

```html
<svg><animate onbegin="alert(1)" attributeName="x" /></svg>
```

**Output:**

```html
<svg></svg>
```

### SVG-specific vectors

Payloads that only work inside SVG contexts.

#### script element inside svg.

**Input:**

```html
<svg><script>alert(1)</script></svg>
```

**Output:**

```html
<svg></svg>
```

#### foreignObject containing HTML script.

**Input:**

```html
<svg><foreignObject><script>alert(1)</script></foreignObject></svg>
```

**Output:**

```html
<svg></svg>
```

#### animate with javascript: in to attribute.

**Input:**

```html
<svg><animate attributeName="href" to="javascript:alert(1)" /></svg>
```

**Output:**

```html
<svg><animate></animate></svg>
```

#### set element with javascript: target.

**Input:**

```html
<svg><set attributeName="href" to="javascript:alert(1)" /></svg>
```

**Output:**

```html
<svg><set></set></svg>
```

#### use with javascript: xlink:href.

**Input:**

```html
<svg><use xlink:href="javascript:alert(1)" /></svg>
```

**Output:**

```html
<svg></svg>
```

#### use with data:image/svg+xml xlink:href.

**Input:**

```html
<svg><use xlink:href="data:image/svg+xml,<svg/>" /></svg>
```

**Output:**

```html
<svg></svg>
```

### Disallowed HTML elements

HTML elements blocked at the tag level.

#### iframe element.

**Input:**

```html
<iframe src="https://attacker.example"></iframe>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### object element with data attribute.

**Input:**

```html
<object data="https://attacker.example/x.swf"></object>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### embed element.

**Input:**

```html
<embed src="https://attacker.example/x.swf">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### meta http-equiv refresh.

**Input:**

```html
<meta http-equiv="refresh" content="0;url=https://attacker.example">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### base href with javascript:.

**Input:**

```html
<base href="javascript:alert(1)//">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### form with formaction.

**Input:**

```html
<form><button formaction="javascript:alert(1)">go</button></form>
```

**Output:**

```html
go
```

#### link rel=stylesheet pointing externally.

**Input:**

```html
<link rel="stylesheet" href="https://attacker.example/x.css">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### link rel=import.

**Input:**

```html
<link rel="import" href="https://attacker.example/x.html">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### input type=image with javascript: src.

**Input:**

```html
<input type="image" src="javascript:alert(1)">
```

**Output:**

```html
(empty — entire input was dropped)
```

### Disallowed HTML attributes

HTML attributes blocked at the attribute level.

#### iframe srcdoc (executes as document) — also iframe is dropped.

**Input:**

```html
<iframe srcdoc="<script>alert(1)</script>"></iframe>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### formaction attribute on a button.

**Input:**

```html
<button formaction="https://attacker.example">go</button>
```

**Output:**

```html
go
```

#### ping attribute on a tag.

**Input:**

```html
<a href="https://example.com" ping="https://attacker.example">x</a>
```

**Output:**

```html
<a href="https://example.com">x</a>
```

#### background attribute on body (legacy).

**Input:**

```html
<body background="https://attacker.example/x.png"></body>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### srcset on img — explicitly dropped per spec section 3.

**Input:**

```html
<img src="data:image/png;base64,iVBORw0KGgo=" srcset="https://attacker.example/x.png 2x">
```

**Output:**

```html
<img src="data:image/png;base64,iVBORw0KGgo=">
```

#### Image element with an external HTTPS URL. The Power BI sandbox does not allow visuals to load external resources; only data: URIs are permitted for img src.

**Input:**

```html
<img src="https://attacker.example/tracking.png" alt="x">
```

**Output:**

```html
<img alt="x">
```

### Encoding and obfuscation

Unicode and whitespace obfuscation of dangerous tokens.

#### HTML entity encoding of javascript:.

**Input:**

```html
<a href="&#x6A;avascript:alert(1)">x</a>
```

**Output:**

```html
<a>x</a>
```

#### Mixed case JaVaScRiPt:.

**Input:**

```html
<a href="JaVaScRiPt:alert(1)">x</a>
```

**Output:**

```html
<a>x</a>
```

#### Tab inserted into javascript scheme.

**Input:**

```html
<a href="java	script:alert(1)">x</a>
```

**Output:**

```html
<a>x</a>
```

#### Newline inserted into javascript scheme.

**Input:**

```html
<a href="java
script:alert(1)">x</a>
```

**Output:**

```html
<a>x</a>
```

#### Leading whitespace before scheme.

**Input:**

```html
<a href="   javascript:alert(1)">x</a>
```

**Output:**

```html
<a>x</a>
```

#### Null byte in scheme.

**Input:**

```html
<a href="java script:alert(1)">x</a>
```

**Output:**

```html
<a>x</a>
```

#### Fullwidth Unicode javascript.

**Input:**

```html
<a href="ｊavascript:alert(1)">x</a>
```

**Output:**

```html
<a>x</a>
```

### OWASP XSS Filter Evasion Cheat Sheet

Representative entries from the OWASP XSS Filter Evasion list.

#### OWASP: img with onerror.

**Input:**

```html
<IMG SRC=x onerror="alert('XSS')">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### OWASP: image with javascript: href via dynsrc.

**Input:**

```html
<IMG DYNSRC="javascript:alert('XSS')">
```

**Output:**

```html
<img>
```

#### OWASP: BGSOUND element.

**Input:**

```html
<BGSOUND SRC="javascript:alert('XSS')">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### OWASP: svg onload.

**Input:**

```html
<svg onload="alert(1)">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### OWASP: marquee with onstart.

**Input:**

```html
<marquee onstart="alert(1)">x</marquee>
```

**Output:**

```html
(empty — entire input was dropped)
```

#### OWASP: style expression() (legacy IE).

**Input:**

```html
<div style="width: expression(alert(1))">x</div>
```

**Output:**

```html
<div>x</div>
```

#### OWASP: meta charset utf-7 attack.

**Input:**

```html
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-7">
```

**Output:**

```html
(empty — entire input was dropped)
```

#### OWASP: ISINDEX action.

**Input:**

```html
<ISINDEX TYPE=IMAGE SRC="javascript:alert('XSS')">
```

**Output:**

```html
(empty — entire input was dropped)
```

### Partial-survival cases

Mixed safe and unsafe content where only the unsafe part must drop.

#### Style with safe color and unsafe background — color survives, background dropped.

**Input:**

```html
<div style="color: red; background: url(https://attacker.example/x.png)">x</div>
```

**Output:**

```html
<div style="color:red">x</div>
```

#### Multiple safe declarations and one unsafe — only the unsafe one drops.

**Input:**

```html
<div style="font-size: 14px; color: blue; cursor: url(https://attacker.example/c.cur), auto; padding: 4px">x</div>
```

**Output:**

```html
<div style="font-size:14px;color:blue;padding:4px">x</div>
```

### Clean baseline (safe content)

Legitimate content that must continue to render unchanged.

#### A simple paragraph of text wrapped in a <p> tag. The most common real-world case — must render unchanged.

**Input:**

```html
<p>Hello, world.</p>
```

**Output:**

```html
<p>Hello, world.</p>
```

#### Basic inline text formatting (bold, italic, underline). Standard rich-text output from a report author.

**Input:**

```html
<p><strong>Bold</strong> <em>italic</em> <u>under</u></p>
```

**Output:**

```html
<p><strong>Bold</strong> <em>italic</em> <u>under</u></p>
```

#### An image embedded as a base64 PNG data URI — the recommended way to include images in a sanitized visual.

**Input:**

```html
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z3I3rUAAAAASUVORK5CYII=" alt="dot">
```

**Output:**

```html
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z3I3rUAAAAASUVORK5CYII=" alt="dot">
```

#### An inline style attribute using only safe properties (color and font-weight) with no external resource references.

**Input:**

```html
<p style="color: red; font-weight: bold">red bold</p>
```

**Output:**

```html
<p style="color:red;font-weight:bold">red bold</p>
```

<!-- WORKED_EXAMPLES_END -->

---

## UAT testing with the corpus

A CSV export of the full test corpus is available for manual UAT in Power BI Desktop. The CSV includes every malicious and clean payload alongside the sanitized output produced by the current sanitizer, making it straightforward to bind the HTML Content visual to the data and verify behavior as an end user.

**Regenerating the CSV:**

```bash
npm run uat:generate
```

This writes `test-uat/corpus.csv` with the following columns:

| Column | Description |
|---|---|
| `id` | Stable unique identifier for the payload |
| `description` | Plain-language description of the attack vector or baseline case |
| `type` | `malicious` or `clean` |
| `category` | Grouping (e.g. `css-url-per-property`, `event-handler`, `clean-baseline`) |
| `cspCategory` | CSP directive most likely to fire if the sanitizer leaks (`none` for clean payloads) |
| `source` | Provenance: cert report, OWASP, code review, baseline, etc. |
| `input` | Raw HTML payload exactly as it would arrive from a data field |
| `sanitizedOutput` | The sanitizer's output for the current rule set |

**To use in Power BI Desktop:**

1. Open Power BI Desktop and use **Get Data > Text/CSV** to import `test-uat/corpus.csv`.
2. Add the HTML Content visual to a page and bind it to the `input` or `sanitizedOutput` column.
3. Use slicers on `type`, `category`, and `cspCategory` to filter to specific test groups.

Re-run `npm run uat:generate` after any change to the corpus or sanitizer to keep the CSV in sync.

---

## How to report a sanitization bug

If the sanitizer drops content you think should be safe, or fails to drop something you think is dangerous, file an issue with:

1. The exact input that triggered it.
2. The output you got.
3. What you expected.

The maintainers will add a corresponding entry to the regression corpus so the same case can never silently regress.
