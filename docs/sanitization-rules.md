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

**Surfaces 2 and 3 are equivalent for sanitization.** A `<style>` block in your bound data and the same CSS pasted into the format pane's custom stylesheet setting both run through `sanitizeCss` in stylesheet mode and produce the same surviving CSS. The only difference is *where* the resulting `<style>` element ends up in the DOM:

- **Custom stylesheet setting** → `<style id="visualUserStylesheet">` in the page `<head>`. Created and managed by the visual itself.
- **`<style>` tag in bound data** → ends up inside the visual's content container (in the body). Browsers apply CSS from `<style>` tags wherever they appear in the document, so selectors work identically from both surfaces.

CSS custom properties (`:root { --my-var: ... }` plus `var(--my-var)` references) work in both surfaces. So do `clamp()`, `rgba()`, `:hover`, `@media`, `@keyframes`, `@supports`, `inherit`, `!important`, `aspect-ratio`, transitions, and the rest of modern CSS.

> **Tip:** if you embed a `<style>` tag in your bound data, avoid `id="visualUserStylesheet"` — that's the id the visual uses for its own host stylesheet element in `<head>`, and a duplicate id is invalid HTML even though browsers tolerate it. Any other id (or no id at all) works.

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
`svg`, `circle`, `clippath`, `defs`, `desc`, `ellipse`, `g`, `image`, `line`, `marker`, `mask`, `metadata`, `path`, `pattern`, `polygon`, `polyline`, `rect`, `stop`, `symbol`, `text`, `textpath`, `title`, `tspan`, `view`, `lineargradient`, `radialgradient`, and the SVG filter primitives (`filter`, `feblend`, `fecolormatrix`, etc.). SMIL animation elements (`animate`, `animatemotion`, `animatetransform`, `set`) are **permitted** but locked down: the element's own `href`/`xlink:href` may only point at same-document fragments, and the `attributeName="..."` value must name a safe presentation/geometry property. Animation that targets `href`, `xlink:href`, `src`, `style`, `cursor`, `clip-path`, `mask`, `filter`, `marker-*`, or the meta `attributeName` itself has its `attributeName` attribute dropped — the SMIL element survives but cannot bind to a target, so the well-known SMIL sanitizer-bypass primitive (`<animate attributeName="href" to="javascript:..."/>`) is closed.

### HTML attributes

**Global attributes** (allowed on every element above):
`class`, `id`, `title`, `lang`, `dir`, `style`, `role`, `aria-*`, `data-*`, `tabindex`

**HTML element-specific attributes** are allowed on a per-element basis. Anything not on the global or element-specific list is dropped:

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

**SVG attributes** follow a different model. Because the SVG spec defines a sprawling set of presentation, filter, gradient, and accessibility attributes that vary by element, the visual uses a denylist for SVG-namespaced tags: any attribute is allowed *except* event handlers (`on*`) and the dangerous attributes listed under [Disabled HTML attributes](#disabled-html-attributes) below. URL-bearing SVG attributes (`href`, `xlink:href`) are additionally subject to per-tag scheme rules — see [URL schemes](#url-schemes).

### URL schemes

For attributes that carry URLs (`href`, `src`, `xlink:href`), the allowed scheme depends on the element:

| Element | Allowed schemes |
|---|---|
| `<a href>` | `https:` (processed by Power BI's `launchUrl()` API), `http:` (backwards compatibility) |
| `<img src>` | `data:` only — no external resource loading |
| `<image href>` / `<image xlink:href>` (SVG) | `data:` only — same restriction as `<img>` |
| `<feImage href>` / `<feImage xlink:href>` (SVG) | `data:` only — same restriction as `<image>` |
| `<textPath href>` / `<textPath xlink:href>` (SVG) | Same-document fragment references only (e.g. `#myPath`) — no external URLs |
| `<pattern href>`, `<linearGradient href>`, `<radialGradient href>`, `<filter href>` (SVG) | Same-document fragment references only — no external URLs |
| `<animate>` / `<animateMotion>` / `<animateTransform>` / `<set>` (SVG SMIL) | Same-document fragment references only — the element's own `href`/`xlink:href` names which element to animate, never an external resource |
| Any other SVG tag with `href` / `xlink:href` | **Default-deny** — must have an explicit entry in `allowedSchemesByTag`; missing entries cause the URL attribute to be dropped |

In addition, SVG presentation attributes that accept functional IRI values (`mask`, `clip-path`, `filter`, `marker-*`, `fill`, `stroke`, `cursor`) are scanned for embedded `url(<scheme>:...)` references. The same rules apply to the embedded scheme: empty (fragment-only `url(#id)`) and `data:` are allowed; `http:`, `https:`, `blob:`, etc. are rejected.

`data:` URIs (where allowed) must additionally satisfy:

- The MIME type is one of: `image/png`, `image/jpeg`, `image/jpg`, `image/gif`, `image/webp`, `image/bmp`, `image/svg+xml`.
- For raster MIME types (`image/png`, `image/jpeg`, `image/jpg`, `image/gif`, `image/webp`, `image/bmp`), the URI must be **base64-encoded** (`data:image/png;base64,...`). A `data:image/png,...` URI without `;base64,` is always rejected because real binary image data cannot be plain-text — such a URI is always smuggling HTML or text behind an image declaration.
- `image/svg+xml` is allowed in any of three forms: `data:image/svg+xml;base64,...`, `data:image/svg+xml;utf8,<svg ...>`, or `data:image/svg+xml,<svg ...>`. SVG is text by spec, and DAX measures and similar tooling legitimately emit the `;utf8,` and bare-comma forms. SVG loaded via `<img>` / `<svg image>` / `<feImage>` / CSS `url()` runs in browser image-loading context, so embedded `<script>`, event handlers, and external resource references inside the SVG **do not execute** — the browser sandbox is the load-bearing security boundary, not the sanitizer. Inline `<svg>...</svg>` parsed into the DOM is a different surface and is still subject to the full DOMPurify SVG profile (script tags and event handlers are stripped; SMIL animation tags are permitted but constrained by the `attributeName` denylist; `<use>` is blocked at the tag allowlist).

All other schemes (`javascript:`, `vbscript:`, `blob:`, `file:`, `ftp:`, `mailto:`, `tel:`, etc.) are rejected.

### CSS

Inline `style` attributes, `<style>` tag bodies, and the custom stylesheet setting all support standard CSS for declarations whose values do **not** reference external resources. See ["What's blocked and why"](#whats-blocked-and-why) below for the specific rules.

---

## What's blocked and why

### External URLs in CSS (`url(https://...)`, `url(http://...)`, etc.)

**Blocked.** Power BI's certified-visual sandbox does not allow visuals to fetch resources from arbitrary external origins. A `background: url(https://example.com/bg.png)` declaration triggers a Content Security Policy violation, produces console errors, and fails certification.

**Workaround:** embed images as base64 `data:image/...;base64,` URIs.

### Non-image data URIs

**Blocked.** A `data:` URI is only allowed inside CSS `url()` (or in `src`/`href` attributes) if its MIME type is on the image allowlist (`image/png`, `image/jpeg`, `image/jpg`, `image/gif`, `image/webp`, `image/bmp`, `image/svg+xml`) AND, for raster MIME types, it is base64-encoded. `image/svg+xml` is exempt from the base64 requirement because SVG is text by spec — the `;utf8,` and bare-comma forms are normal output for tools and DAX measures. This catches two categories of attack:

1. `data:text/html,<script>...</script>` smuggling executable HTML
2. `data:image/png,<html>...</html>` declaring a raster image MIME but carrying plain text

`image/svg+xml` is treated separately rather than blocked: SVG loaded through an image-loading context (`<img src>`, `<svg image href>`, `<feImage href>`, CSS `url()`) is sandboxed by the browser — embedded scripts, event handlers, and external resource references do not execute. Inline `<svg>` in the DOM is a different surface and is still scrubbed by the full DOMPurify pass.

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
- `data:image/svg+xml,...` (and the `;utf8,` / `;base64,` variants) is allowed. SVG loaded via `<img>` / CSS `url()` is browser-sandboxed.
- `data:image/png,...` (and the other raster types) without `;base64,` is blocked. Re-encode as base64.

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

#### SVG data URI payload contains <script>. Browsers sandbox SVG in image-loading context but the sanitizer scans the decoded payload as defense-in-depth for sandbox-weak rendering surfaces (older WebView2, mobile, export pipelines).

**Input:**

```html
<img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>">
```

**Output:**

```html
<img>
```

#### SVG data URI payload contains an on* event handler. Same defense-in-depth scan rejects the URI before it reaches the DOM.

**Input:**

```html
<img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>">
```

**Output:**

```html
<img>
```

#### SVG data URI payload contains a <foreignObject>. Even though image-context loading neuters foreignObject HTML in the browser, the sanitizer rejects it as defense-in-depth.

**Input:**

```html
<img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><foreignObject><iframe src='https://attacker.example'/></foreignObject></svg>">
```

**Output:**

```html
<img>
```

#### SVG data URI payload contains an inner element with external xlink:href. Image-context sandbox blocks fetches but the sanitizer rejects the URI to keep external references out of sandbox-weak surfaces.

**Input:**

```html
<img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image xlink:href='https://attacker.example/track.png' width='10' height='10'/></svg>">
```

**Output:**

```html
<img>
```

#### Base64-encoded SVG data URI carrying a <script> tag. Verifies the payload scanner decodes base64 before pattern-matching, not just the ;utf8, form.

**Input:**

```html
<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=">
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

#### set element with javascript: target via attributeName="href". The SMIL_ATTRIBUTE_NAME_DENYLIST drops the attributeName attribute, neutering the animation; the javascript: value is also rejected by the scriptingPatterns gate.

**Input:**

```html
<svg><set attributeName="href" to="javascript:alert(1)" /></svg>
```

**Output:**

```html
<svg><set></set></svg>
```

#### SMIL animate attempting to override <image> href to an external URL at runtime. SMIL animation elements are allowed (issue #145) but attributeName="href" is on SMIL_ATTRIBUTE_NAME_DENYLIST, so the attributeName attribute is dropped — the animate element survives but has nothing to bind to and cannot rewrite the sanitized href.

**Input:**

```html
<svg><image href="data:image/png;base64,iVBORw0KGgo="><animate attributeName="href" to="https://attacker.example/track.png" begin="0s" dur="1ms" fill="freeze"/></image></svg>
```

**Output:**

```html
<svg><image href="data:image/png;base64,iVBORw0KGgo="><animate to="https://attacker.example/track.png" begin="0s" dur="1ms" fill="freeze"></animate></image></svg>
```

#### SMIL animate attempting to overwrite the entire inline style attribute at runtime. attributeName="style" is on the denylist because animating style replaces the whole declaration string, re-introducing url() declarations the static sanitizer never saw.

**Input:**

```html
<svg><rect width="10" height="10" style="fill: red"><animate attributeName="style" to="background:url(javascript:alert(1))" dur="1s"/></rect></svg>
```

**Output:**

```html
<svg><rect width="10" height="10" style="fill:red"><animate dur="1s"></animate></rect></svg>
```

#### SMIL animate with an external xlink:href (referencing the element to animate). Per-tag scheme allowlist for SMIL tags is fragment-only, so external URLs are dropped at the URL gate.

**Input:**

```html
<svg><animate xlink:href="https://attacker.example/evil.svg" attributeName="opacity" from="0" to="1" dur="1s"/></svg>
```

**Output:**

```html
<svg><animate attributeName="opacity" from="0" to="1" dur="1s"></animate></svg>
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

#### SVG image element with external href. Same restriction as HTML img: only data: URIs permitted, no external resource loading.

**Input:**

```html
<svg><image href="https://attacker.example/track.png" /></svg>
```

**Output:**

```html
<svg><image></image></svg>
```

#### SVG image element with external xlink:href (legacy syntax). Must be blocked just like href.

**Input:**

```html
<svg><image xlink:href="https://attacker.example/track.png" /></svg>
```

**Output:**

```html
<svg><image></image></svg>
```

#### SVG textPath with external href. textPath should only reference same-document fragment IDs (#path), not external URLs.

**Input:**

```html
<svg><text><textPath href="https://attacker.example/path.svg#p">label</textPath></text></svg>
```

**Output:**

```html
<svg><text><textPath>label</textPath></text></svg>
```

#### SVG2 <marker href> can reference another marker by fragment ID; external URLs must be dropped. Per-tag URL gate enforces fragment-only via allowedSchemesByTag.

**Input:**

```html
<svg><marker id="m" href="https://attacker.example/m.svg" viewBox="0 0 10 10"/></svg>
```

**Output:**

```html
<svg><marker id="m" viewBox="0 0 10 10"></marker></svg>
```

#### SVG2 <symbol href> can reference another symbol by fragment ID; external URLs must be dropped. Per-tag URL gate enforces fragment-only via allowedSchemesByTag.

**Input:**

```html
<svg><symbol id="s" href="https://attacker.example/s.svg" viewBox="0 0 10 10"/></svg>
```

**Output:**

```html
<svg><symbol id="s" viewBox="0 0 10 10"></symbol></svg>
```

#### SVG feImage filter primitive with external href. Same restriction as <image>: only data: URIs are permitted, no external resource loading.

**Input:**

```html
<svg><filter id="f"><feImage href="https://attacker.example/x.png"/></filter></svg>
```

**Output:**

```html
<svg><filter id="f"><feImage></feImage></filter></svg>
```

#### SVG pattern element with external href. Patterns should only reference same-document fragment IDs, not external URLs.

**Input:**

```html
<svg><defs><pattern id="p" href="https://attacker.example/x.svg"><rect width="10" height="10"/></pattern></defs></svg>
```

**Output:**

```html
<svg><defs><pattern id="p"><rect width="10" height="10"></rect></pattern></defs></svg>
```

#### SVG linearGradient with external href. Gradients should only reference same-document fragment IDs, not external URLs.

**Input:**

```html
<svg><defs><linearGradient id="g" href="https://attacker.example/x.svg"><stop offset="0%" stop-color="red"/></linearGradient></defs></svg>
```

**Output:**

```html
<svg><defs><linearGradient id="g"><stop offset="0%" stop-color="red"></stop></linearGradient></defs></svg>
```

#### SVG radialGradient with external href. Gradients should only reference same-document fragment IDs, not external URLs.

**Input:**

```html
<svg><defs><radialGradient id="g" href="https://attacker.example/x.svg"><stop offset="0%" stop-color="red"/></radialGradient></defs></svg>
```

**Output:**

```html
<svg><defs><radialGradient id="g"><stop offset="0%" stop-color="red"></stop></radialGradient></defs></svg>
```

#### SVG filter element with external href. Filters should only reference same-document fragment IDs, not external URLs.

**Input:**

```html
<svg><filter id="f" href="https://attacker.example/x.svg"><feGaussianBlur stdDeviation="2"/></filter></svg>
```

**Output:**

```html
<svg><filter id="f"><feGaussianBlur stdDeviation="2"></feGaussianBlur></filter></svg>
```

#### SVG mask attribute carrying url(https://...). Funciri values on SVG presentation attributes must be scheme-checked, not just the src/href/xlink:href attribute names.

**Input:**

```html
<svg><rect mask="url(https://attacker.example/m.svg)" width="10" height="10"/></svg>
```

**Output:**

```html
<svg><rect width="10" height="10"></rect></svg>
```

#### SVG clip-path attribute carrying url(https://...). Same funciri concern as mask.

**Input:**

```html
<svg><rect clip-path="url(https://attacker.example/c.svg)" width="10" height="10"/></svg>
```

**Output:**

```html
<svg><rect width="10" height="10"></rect></svg>
```

#### SVG filter attribute carrying url(https://...). Same funciri concern as mask and clip-path.

**Input:**

```html
<svg><rect filter="url(https://attacker.example/f.svg)" width="10" height="10"/></svg>
```

**Output:**

```html
<svg><rect width="10" height="10"></rect></svg>
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

#### A small inline SVG with the most common primitive shapes — circle, rect, and line — using basic fill and stroke. Should render as three side-by-side shapes.

**Input:**

```html
<svg width="180" height="40" viewBox="0 0 180 40"><circle cx="20" cy="20" r="15" fill="steelblue"/><rect x="60" y="5" width="30" height="30" fill="orange"/><line x1="120" y1="20" x2="170" y2="20" stroke="#333" stroke-width="3"/></svg>
```

**Output:**

```html
<svg width="180" height="40" viewBox="0 0 180 40"><circle cx="20" cy="20" r="15" fill="steelblue"></circle><rect x="60" y="5" width="30" height="30" fill="orange"></rect><line x1="120" y1="20" x2="170" y2="20" stroke="#333" stroke-width="3"></line></svg>
```

#### An SVG that scales to fill its container using viewBox plus 100% width and height with preserveAspectRatio. The standard pattern for responsive maps and dashboards.

**Input:**

```html
<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><rect x="10" y="10" width="80" height="80" fill="#0078d4"/></svg>
```

**Output:**

```html
<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><rect x="10" y="10" width="80" height="80" fill="#0078d4"></rect></svg>
```

#### A semi-transparent rectangle overlay on top of a solid shape, using fill-opacity. Common pattern for highlighting a region of a chart.

**Input:**

```html
<svg width="120" height="40" viewBox="0 0 120 40"><rect x="0" y="0" width="120" height="40" fill="steelblue"/><rect x="40" y="0" width="40" height="40" fill="red" fill-opacity="0.4"/></svg>
```

**Output:**

```html
<svg width="120" height="40" viewBox="0 0 120 40"><rect x="0" y="0" width="120" height="40" fill="steelblue"></rect><rect x="40" y="0" width="40" height="40" fill="red" fill-opacity="0.4"></rect></svg>
```

#### SVG text with the styling a chart axis or legend typically uses — italic font-style, text-anchor, and rotated tick label via transform.

**Input:**

```html
<svg width="160" height="60" viewBox="0 0 160 60"><text x="10" y="20" text-anchor="start" font-style="italic" font-size="14">Axis label</text><text x="80" y="50" text-anchor="middle" transform="rotate(-45 80 50)">Q1 2025</text></svg>
```

**Output:**

```html
<svg width="160" height="60" viewBox="0 0 160 60"><text x="10" y="20" text-anchor="start" font-style="italic" font-size="14">Axis label</text><text x="80" y="50" text-anchor="middle" transform="rotate(-45 80 50)">Q1 2025</text></svg>
```

#### A dashed grid line, a rounded line cap, and a polyline sparkline with rounded joins. Exercises stroke-dasharray, stroke-linecap, and stroke-linejoin on the shapes that use them most often.

**Input:**

```html
<svg width="160" height="40" viewBox="0 0 160 40"><line x1="0" y1="20" x2="160" y2="20" stroke="#ccc" stroke-dasharray="4,2"/><line x1="10" y1="30" x2="150" y2="30" stroke="#000" stroke-width="3" stroke-linecap="round"/><polyline points="0,35 30,15 60,25 90,8 120,18 150,4" fill="none" stroke="#0078d4" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>
```

**Output:**

```html
<svg width="160" height="40" viewBox="0 0 160 40"><line x1="0" y1="20" x2="160" y2="20" stroke="#ccc" stroke-dasharray="4,2"></line><line x1="10" y1="30" x2="150" y2="30" stroke="#000" stroke-width="3" stroke-linecap="round"></line><polyline points="0,35 30,15 60,25 90,8 120,18 150,4" fill="none" stroke="#0078d4" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline></svg>
```

#### A drop shadow applied to a path via the canonical SVG filter chain — feGaussianBlur, feOffset, and feMerge. Exercises filter primitives with their distinctive camelCase attributes.

**Input:**

```html
<svg width="160" height="60" viewBox="0 0 160 60"><defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="2"/><feOffset dx="1" dy="1" result="off"/><feMerge><feMergeNode in="off"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect x="20" y="15" width="120" height="30" fill="#0078d4" filter="url(#shadow)"/></svg>
```

**Output:**

```html
<svg width="160" height="60" viewBox="0 0 160 60"><defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="2"></feGaussianBlur><feOffset dx="1" dy="1" result="off"></feOffset><feMerge><feMergeNode in="off"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter></defs><rect x="20" y="15" width="120" height="30" fill="#0078d4" filter="url(#shadow)"></rect></svg>
```

#### A rectangle filled with a horizontal linear gradient defined in <defs> and referenced via fill="url(#id)". Tests gradient definitions, gradientUnits, and stop-color.

**Input:**

```html
<svg width="160" height="40" viewBox="0 0 160 40"><defs><linearGradient id="g1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="160" y2="0"><stop offset="0%" stop-color="#0078d4"/><stop offset="100%" stop-color="#50e6ff"/></linearGradient></defs><rect x="0" y="0" width="160" height="40" fill="url(#g1)"/></svg>
```

**Output:**

```html
<svg width="160" height="40" viewBox="0 0 160 40"><defs><linearGradient id="g1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="160" y2="0"><stop offset="0%" stop-color="#0078d4"></stop><stop offset="100%" stop-color="#50e6ff"></stop></linearGradient></defs><rect x="0" y="0" width="160" height="40" fill="url(#g1)"></rect></svg>
```

#### A small inline sparkline showing a trend line with an end-point marker — the kind of chart a report author would embed next to a KPI value.

**Input:**

```html
<svg width="120" height="30" viewBox="0 0 120 30" xmlns="http://www.w3.org/2000/svg"><g transform="translate(2,2)"><path d="M0,20 L20,10 L40,15 L60,5 L80,12 L100,3" fill="none" stroke="#0078d4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="100" cy="3" r="2" fill="#0078d4"/></g></svg>
```

**Output:**

```html
<svg width="120" height="30" viewBox="0 0 120 30" xmlns="http://www.w3.org/2000/svg"><g transform="translate(2,2)"><path d="M0,20 L20,10 L40,15 L60,5 L80,12 L100,3" fill="none" stroke="#0078d4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="100" cy="3" r="2" fill="#0078d4"></circle></g></svg>
```

#### A small bar chart with two bars, an x-axis baseline, a tick line, and a rotated italic tick label. Exercises text-anchor, font-style, transform, and group nesting in a recognizable chart shape.

**Input:**

```html
<svg width="200" height="120" viewBox="0 0 200 120"><g class="axis" transform="translate(0,100)"><line x1="0" y1="0" x2="200" y2="0" stroke="#333"/><g class="tick" transform="translate(20,0)"><line y2="6" stroke="#333"/><text y="9" dy="0.71em" text-anchor="middle" font-style="italic">Jan</text></g></g><g class="bars"><rect x="10" y="40" width="20" height="60" fill="steelblue"/><rect x="40" y="20" width="20" height="80" fill="steelblue"/></g></svg>
```

**Output:**

```html
<svg width="200" height="120" viewBox="0 0 200 120"><g class="axis" transform="translate(0,100)"><line x1="0" y1="0" x2="200" y2="0" stroke="#333"></line><g class="tick" transform="translate(20,0)"><line y2="6" stroke="#333"></line><text y="9" dy="0.71em" text-anchor="middle" font-style="italic">Jan</text></g></g><g class="bars"><rect x="10" y="40" width="20" height="60" fill="steelblue"></rect><rect x="40" y="20" width="20" height="80" fill="steelblue"></rect></g></svg>
```

#### A small inline SVG embedded as data:image/svg+xml;utf8 in <img src>. This is the shape DAX measures emit when a report author builds an SVG string and feeds it to HTML Content as an image. Browsers sandbox SVG loaded via <img>, so embedded scripts and external resource references would not execute even if present (issue #143 follow-up).

**Input:**

```html
<img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><circle cx='4' cy='4' r='3' fill='red'/></svg>">
```

**Output:**

```html
<img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><circle cx='4' cy='4' r='3' fill='red'/></svg>">
```

#### SMIL animation targeting opacity (a safe presentation attribute). attributeName="opacity" is not on the denylist, so the animation survives intact and renders the fade-in effect at runtime (issue #145 HomeTetris pattern).

**Input:**

```html
<svg><g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="0s" fill="freeze"/><rect width="10" height="10" fill="red"/></g></svg>
```

**Output:**

```html
<svg><g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="0s" fill="freeze"></animate><rect width="10" height="10" fill="red"></rect></g></svg>
```

#### CSS rule using url(#fragment) to reference an in-document SVG gradient. Same-document fragment refs resolve in-place and never fetch, so the CSS sanitizer admits them as a fast-path before the url() data:image safety check runs (Greptile review).

**Input:**

```html
<style>.shape { fill: url(#gradient1); }</style><svg><defs><linearGradient id="gradient1"><stop offset="0%" stop-color="red"/><stop offset="100%" stop-color="blue"/></linearGradient></defs><rect class="shape" width="100" height="50"/></svg>
```

**Output:**

```html
<style>.shape { fill: url(#gradient1); }</style><svg><defs><linearGradient id="gradient1"><stop offset="0%" stop-color="red"></stop><stop offset="100%" stop-color="blue"></stop></linearGradient></defs><rect class="shape" width="100" height="50"></rect></svg>
```

#### Inline style filter property pointing at an in-document SVG filter definition via url(#filterId). Common SVG drop-shadow / blur pattern; the fragment-only url() must survive the CSS sanitizer.

**Input:**

```html
<svg><defs><filter id="dropShadow"><feGaussianBlur stdDeviation="2"/></filter></defs><rect width="50" height="50" fill="red" style="filter: url(#dropShadow)"/></svg>
```

**Output:**

```html
<svg><defs><filter id="dropShadow"><feGaussianBlur stdDeviation="2"></feGaussianBlur></filter></defs><rect width="50" height="50" fill="red" style="filter:url(#dropShadow)"></rect></svg>
```

#### SVG2 <marker> cross-referencing another marker definition via href="#otherMarker". Fragment-only allowedSchemesByTag entry lets it through (Greptile review).

**Input:**

```html
<svg><defs><marker id="base" viewBox="0 0 10 10"><path d="M0,0 L10,5 L0,10"/></marker><marker id="derived" href="#base" viewBox="0 0 10 10"/></defs><line x1="0" y1="0" x2="100" y2="0" stroke="black" marker-end="url(#derived)"/></svg>
```

**Output:**

```html
<svg><defs><marker id="base" viewBox="0 0 10 10"><path d="M0,0 L10,5 L0,10"></path></marker><marker id="derived" href="#base" viewBox="0 0 10 10"></marker></defs><line x1="0" y1="0" x2="100" y2="0" stroke="black" marker-end="url(#derived)"></line></svg>
```

#### SVG2 <symbol> cross-referencing another symbol definition via href="#otherSymbol". Fragment-only allowedSchemesByTag entry lets it through (Greptile review).

**Input:**

```html
<svg><defs><symbol id="base" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol><symbol id="derived" href="#base" viewBox="0 0 10 10"/></defs></svg>
```

**Output:**

```html
<svg><defs><symbol id="base" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></symbol><symbol id="derived" href="#base" viewBox="0 0 10 10"></symbol></defs></svg>
```

<!-- WORKED_EXAMPLES_END -->
