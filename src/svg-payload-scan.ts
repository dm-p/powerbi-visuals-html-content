/**
 * Defense-in-depth content scan for `data:image/svg+xml` URIs.
 *
 * Used by both:
 *   - `getSanitizedDataUri` in `sanitize-pipeline.ts` (for `<img src>`,
 *     `<svg image href>`, `<feImage href>` and similar URL-bearing
 *     attributes)
 *   - `isSafeImageDataUri` in `css-sanitizer.ts` (for CSS `url()` values
 *     in declarations like `background-image`, `mask`, `filter`)
 *
 * Browser sandboxing of SVG loaded via image-context is the
 * load-bearing security boundary — embedded `<script>`, event handlers,
 * and external resource references inside the SVG do not execute. But
 * the sandbox guarantee is not uniform across every rendering surface a
 * Power BI report ends up in (older WebView2, mobile renderers,
 * export-to-PDF pipelines). This scan is the backstop: payloads that
 * carry patterns the sandbox would normally neuter are rejected at the
 * sanitizer so a future sandbox-weak surface still drops them.
 *
 * The two helpers are colocated here so the regex / decode logic stays
 * in lockstep across the two call sites — a bypass discovered in one
 * surface only needs fixing in one place.
 */

/**
 * Decode the body of a `data:image/svg+xml` URI for content inspection.
 * Returns null when the URI is malformed or base64 decoding fails — the
 * caller treats that as "dangerous" and rejects.
 *
 * Detects encoding from the header before the first comma:
 *   - `;base64,` → atob
 *   - anything else (`;utf8,`, bare comma, percent-encoded) →
 *     decodeURIComponent, falling back to the raw payload when the
 *     payload is already plain text with literal angle brackets (the
 *     form DAX measures emit).
 */
export function decodeSvgDataUriPayload(dataUri: string): string | null {
    const commaIdx = dataUri.indexOf(',');
    if (commaIdx === -1) return null;
    const header = dataUri.slice(0, commaIdx);
    const payload = dataUri.slice(commaIdx + 1);
    if (/;base64$/i.test(header) || /;base64;/i.test(header)) {
        try {
            return atob(payload);
        } catch {
            return null;
        }
    }
    try {
        return decodeURIComponent(payload);
    } catch {
        return payload;
    }
}

/**
 * Defense-in-depth scan of an `image/svg+xml` data URI for content the
 * browser sandbox would normally neuter. Rejects on:
 *   - `<script>` tags
 *   - `<foreignObject>` (carries arbitrary HTML)
 *   - `on*=` event handler attributes
 *   - inner-element `href` / `xlink:href` referencing a non-fragment,
 *     non-data scheme (sandbox blocks fetches in image context, but a
 *     sandbox-weak surface would let them through)
 *
 * Returns true when the payload is dangerous (caller should reject).
 */
export function hasDangerousSvgPayload(dataUri: string): boolean {
    const decoded = decodeSvgDataUriPayload(dataUri);
    if (decoded == null) return true;
    if (/<script\b/i.test(decoded)) return true;
    if (/<foreignObject\b/i.test(decoded)) return true;
    // The boundary char before `on...` must include `"` and `'`, not
    // just whitespace — HTML5's lenient tokenizer accepts adjacent
    // attributes when separated by a closing quote, e.g.
    // `<svg id="x"onclick="alert(1)">`. The same lenient parsers run
    // on the sandbox-weak surfaces this scan defends, so a
    // whitespace-only boundary would let the handler through here
    // while a downstream parser still fires it.
    if (/[\s"']on[a-z]+\s*=/i.test(decoded)) return true;
    // The boundary char before `href` / `xlink:href` must include `"`
    // and `'`, not just whitespace and start-of-string — HTML5's lenient
    // tokenizer accepts adjacent attributes when separated by a closing
    // quote, e.g. `<image id="x"href="https://attacker.example/pixel">`.
    // The same lenient parsers run on the sandbox-weak surfaces this
    // scan defends, so a whitespace-only boundary would let an external
    // fetch through here while a downstream parser still initiated it.
    // Mirrors the boundary used by the on* event-handler regex above.
    const hrefMatches = decoded.match(
        /(?:^|[\s"'])(?:xlink:)?href\s*=\s*["']?\s*([^"'\s>]+)/gi
    );
    if (hrefMatches) {
        for (const raw of hrefMatches) {
            const valueMatch = raw.match(/=\s*["']?\s*([^"'\s>]+)/);
            if (!valueMatch) continue;
            const value = valueMatch[1].trim();
            // Empty href and fragment-only refs (#id) resolve in-document
            // and never fetch — safe.
            if (value === '' || value.startsWith('#')) continue;
            // data: URIs are admitted only for image MIME types. The
            // outer attribute pipeline (getSanitizedDataUri,
            // isSafeImageDataUri) restricts data: to image/* across all
            // URL-bearing attributes; this scan applies the same rule
            // to inner-element href / xlink:href so a payload like
            // <image href="data:text/html,<script>..."> is flagged
            // even when wrapped inside an outer image-context SVG.
            if (/^data:image\//i.test(value)) continue;
            return true;
        }
    }
    return false;
}
