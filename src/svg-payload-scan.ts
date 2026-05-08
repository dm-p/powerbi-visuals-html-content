/**
 * Shared safety helpers for `data:` URIs that carry images.
 *
 * Three call sites consume these helpers:
 *   - `getSanitizedDataUri` in `sanitize-pipeline.ts` — top-level URL
 *     attributes (`<img src>`, `<svg image href>`, `<feImage href>`).
 *   - The funciri value-scheme check in `sanitize-pipeline.ts` — SVG
 *     presentation attributes that accept `url(...)` references
 *     (`fill`, `mask`, `clip-path`, `filter`, `marker-*`, `cursor`).
 *   - `hasUnsafeFunction` in `css-sanitizer.ts` — CSS `url()` values
 *     in declarations like `background-image`, `mask`, `filter`.
 *
 * Every call site needs to answer the same question: "is this `data:`
 * URI safe to admit?" The predicate `isSafeImageDataUri` is the single
 * source of truth. Behind it sits `hasDangerousSvgPayload`, which
 * decodes the body of an `image/svg+xml` URI and rejects it if the
 * payload carries patterns the browser image-context sandbox would
 * normally neuter (`<script>`, `<foreignObject>`, on*= event handlers,
 * external inner-element href).
 *
 * Browser sandboxing of SVG loaded via image-context is the
 * load-bearing security boundary. But the sandbox guarantee is not
 * uniform across every rendering surface a Power BI report ends up in
 * (older WebView2, mobile renderers, export-to-PDF pipelines). The
 * payload scan is the backstop: payloads that carry sandbox-defeating
 * patterns are rejected at the sanitizer so a future sandbox-weak
 * surface still drops them.
 *
 * All three helpers live in this module so the regex / decode logic
 * stays in lockstep across call sites — a bypass discovered in one
 * surface only needs fixing in one place.
 */

/**
 * MIME allowlist for `data:` URIs that may appear in image-loading
 * attributes (`src`, `href`, `xlink:href`, CSS `url()`, SVG funciri).
 * Raster types must be base64-encoded; `image/svg+xml` is text by spec
 * and is admitted in `;utf8,` / bare-comma / `;base64,` forms.
 */
export const SAFE_IMAGE_MIME_TYPES = new Set<string>([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml'
]);

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
    // Tolerant whitespace around `base64` — WHATWG mimesniff §4.4.3
    // strips parameter whitespace before decoding, so browsers treat
    // `data:image/svg+xml; base64,<b64>` as base64. A strict
    // `/;base64$/` regex would route the payload through
    // decodeURIComponent (which returns the base64 string verbatim),
    // missing any literal-encoded `<script>`/etc. inside.
    if (/;\s*base64\s*$/i.test(header) || /;\s*base64\s*;/i.test(header)) {
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
 * Maximum recursion depth for nested `data:image/svg+xml` payloads.
 * Without a cap, an attacker could base64-wrap `<svg><script>...</script></svg>`
 * inside several SVG layers; the regex check stays opaque to the
 * inner script for as many layers as the URL length allows. Four is
 * generous — each base64 wrap roughly 4/3-multiplies the parent's URL
 * length, so depth 4 already implies a single-attribute payload close
 * to 1 MB. Reaching the cap is fail-closed: we cannot finish
 * verifying the deepest layer.
 */
const MAX_PAYLOAD_SCAN_DEPTH = 4;

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
 * Recursive on nested `data:image/svg+xml` inner hrefs. A
 * Russian-doll payload that base64-wraps a `<script>` SVG inside an
 * outer SVG would otherwise be opaque to the regex checks at the
 * outer layer — the inner `<script>` only appears after decoding the
 * inner data URI. Recursion is depth-capped (see
 * MAX_PAYLOAD_SCAN_DEPTH); reaching the cap returns true.
 *
 * The `depth` parameter is internal; public callers leave it at the
 * default 0.
 *
 * Returns true when the payload is dangerous (caller should reject).
 */
export function hasDangerousSvgPayload(
    dataUri: string,
    depth: number = 0
): boolean {
    if (depth > MAX_PAYLOAD_SCAN_DEPTH) return true;
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
            //
            // Inner data:image/svg+xml is recursively scanned — a
            // base64 inner SVG could otherwise hide <script> /
            // <foreignObject> / on*= behind opaque base64 that the
            // outer regex can't see through.
            if (/^data:image\/svg\+xml/i.test(value)) {
                if (hasDangerousSvgPayload(value, depth + 1)) {
                    return true;
                }
                continue;
            }
            if (/^data:image\//i.test(value)) continue;
            return true;
        }
    }
    return false;
}

/**
 * Predicate: is this `data:` URI safe to admit at an image-loading
 * call site? Returns false for any of:
 *   - Empty / non-`data:` input
 *   - MIME type not on `SAFE_IMAGE_MIME_TYPES`
 *   - Raster MIME (png / jpeg / gif / webp / bmp) without `;base64,`
 *     (a raster URI without base64 is always smuggling text content
 *     behind an image declaration)
 *   - `image/svg+xml` whose decoded payload trips
 *     `hasDangerousSvgPayload` (script tag, foreignObject, on*=
 *     handler, external inner-element href)
 *
 * `image/svg+xml` is admitted in any of `;base64,`, `;utf8,`, or
 * bare-comma forms — SVG is text by spec and DAX measures legitimately
 * emit the non-base64 forms.
 */
export function isSafeImageDataUri(rawUrl: string): boolean {
    const url = rawUrl.trim().toLowerCase();
    if (!url) return false;
    if (!url.startsWith('data:')) return false;
    const semi = url.indexOf(';');
    const comma = url.indexOf(',');
    const end = Math.min(
        semi === -1 ? url.length : semi,
        comma === -1 ? url.length : comma
    );
    const mime = url.slice(5, end);
    if (!SAFE_IMAGE_MIME_TYPES.has(mime)) return false;
    if (mime !== 'image/svg+xml' && !/;base64,/i.test(rawUrl)) return false;
    if (mime === 'image/svg+xml' && hasDangerousSvgPayload(rawUrl)) {
        return false;
    }
    return true;
}
