# Scripting in the unsanitized editions

> **Applies only to the unsanitized editions** of the HTML Content visual — the
> builds where `config.sanitize === false` (currently the **standard** and
> **standalone** editions). The **certified** edition deliberately strips scripts;
> nothing in this document applies to it.

The unsanitized editions render author-supplied content *as written*. That
includes embedded `<script>` elements and inline event handlers (`onclick`,
`onerror`, …), which **execute**. This is not a formally supported feature, but it
works reliably, and this page documents how and why so authors can build
interactive content (in-DOM filtering, modals, progressive disclosure) on top of a
measure-driven UI.

## Edition behaviour

| Edition (`config.sanitize`) | `<script>` | inline `on*` | `<style>` / custom CSS |
|---|---|---|---|
| Certified (`true`) | removed by DOMPurify | element dropped | sanitized |
| **Unsanitized — standard & standalone (`false`)** | **runs** | **fires** | **rendered as-is** |

In the unsanitized editions DOMPurify is never invoked — not for the DOM and not
for the custom stylesheet. Content is the author's responsibility.

## Why scripts execute

The visual turns an HTML string into DOM with `Range.createContextualFragment()`.
Unlike `innerHTML` or `DOMParser`, fragments produced this way contain
**executable** `<script>` nodes: the script runs the moment the fragment is
connected to the live document. This is precisely why `createContextualFragment`
is a well-known XSS sink — and precisely why the certified edition runs DOMPurify
to neutralise it. The unsanitized editions skip DOMPurify, so the scripts survive
and run.

## Execution model — the parts that bite

- **A `<script>` runs once**, when its node is first inserted into the live DOM.
- **Order:** the **Body template** is inserted first, then each **row**. Define
  shared functions in the Body template; per-row scripts can then call them.
- **Render mode** (Content formatting → *On data update*):
  - **Rebuild content** — everything is re-parsed and re-inserted on each update,
    so every script re-runs.
  - **Preserve unchanged content** (reconcile) — only changed rows are
    re-inserted, so only their scripts re-run. The Body/global script persists and
    does **not** re-run; unchanged rows keep their DOM and any in-page state.
- **Inline `on*` handlers** fire on the event, every time — no execution-timing
  caveat.
- Everything runs inside the visual's **sandboxed iframe**; scripts cannot reach
  the Power BI host page.

## Recommended pattern

Pair the templating feature with scripting like this:

1. **Body template** — emit one `<script>` that *defines* your shared functions
   once (and assigns them to `window` if rows reference them by name).
2. **Content measure (per row)** — emit a tiny `<script>` that only *calls* a
   shared function to initialise that row. Do **not** redefine shared functions
   per row.
3. **Row template** — `{{row}}` so the content's own root element is the row.

### Pattern in practice

A generic shape — a shared namespace defined once, called per row:

```text
Body template  ── toolbar/header with onclick="app.filterBy('groupA')" …
               ── <div class="rows">{{content}}</div>
               ── <script>
                    window.app = {
                      filterBy(key) { /* in-DOM show/hide of rows */ },
                      initRow(el)   { /* collapse detail, wire local handlers */ }
                    };
                  </script>

Content (one   ── <div class="row" id="row_{key}" data-group="…">
row)                 … row markup, detail, modal …
                     <script>app.initRow(document.getElementById('row_{key}'))</script>
                  </div>
```

The toolbar's `onclick` calls a shared function to filter rows in the DOM; each
row's init script wires up just that row. Because each row's root element is also
the visual's selectable node, native cross-filtering works alongside the
JavaScript.

## Debugging

Power BI Desktop has no browser dev tools, so use the visual's own **Diagnostics**
surface (covered in `HTML-Content-v2-Guide.md`):

- Enable **Content formatting → Enable diagnostics**, then open the dialog from the
  icon (edit mode, Desktop/Service) or with **Ctrl/Cmd + D**.
- The **Console** tab captures your scripts' `console.log`/`warn`/`error` output
  while diagnostics is active (with a level filter — **all** or one level — and a
  Clear button).
- The **Raw HTML** tab shows the exact processed markup the visual rendered, so you
  can confirm your measure produced the HTML you expected.
- The **Events** tab logs host activity while diagnostics is active — each visual
  **update** (with the update type and view mode), plus **cross-filter**,
  **tooltip**, and **drill** actions — so you can see when and why the visual
  re-rendered and how interactions fired. Filter by type or **Clear** to reset.
- The **Sanitizer** tab does **not** appear in the unsanitized editions — nothing
  is stripped, so there is nothing to report.

## Gotchas

- **Single-root rows.** With `{{row}}` passthrough, the content must have exactly
  **one** root element — that element becomes the row's keyed node (and its
  selectable node for cross-filter). Nest any modals/scripts **inside** that root,
  not as siblings.
- **Cross-filter vs. inner clicks.** The row's root is the selectable node. If an
  inner control (link, button) must *not* trigger cross-filter, call
  `event.stopPropagation()` in its handler — or, more simply, mark the element
  `data-hc-suppress="filter"` (use `"all"` for an overlay like a modal). The
  declarative form needs no script, also covers the context menu and tooltip when
  you list those tokens, and works in the **certified** edition too. See
  *Suppressing interactivity on specific elements* in the feature guide.
- **Reconcile + reorder.** A row that *moves* during reconcile is detached and
  reattached, so its scripts/iframes re-run. Updates that don't reorder rows
  preserve them.
- **Trust.** These editions run whatever the content contains. Treat the measures
  that build your HTML/JS as code you own. Never point an unsanitized edition at
  untrusted or user-supplied HTML.

## Security summary

Scripting is available **only** because the unsanitized editions disable
sanitization. The certified edition strips scripts on purpose. Use an unsanitized
edition exclusively with content you fully control.
