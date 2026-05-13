import { describe, it, expect } from 'vitest';
import {
    decodeSvgDataUriPayload,
    hasDangerousSvgPayload,
    isSafeImageDataUri
} from '../src/svg-payload-scan';

/**
 * Unit tests for the shared SVG-payload defense-in-depth helpers used
 * by both `getSanitizedDataUri` (sanitize-pipeline.ts) and
 * `isSafeImageDataUri` (css-sanitizer.ts). Pipeline-level integration
 * coverage lives in `test/sanitize-pipeline.test.ts` and the CSP corpus;
 * this file pins the regex / decode logic directly so a bypass found in
 * either consumer can be reproduced without going through DOMPurify or
 * postcss.
 */
describe('decodeSvgDataUriPayload', () => {
    describe('utf8 / percent-encoded form', () => {
        it('decodes percent-encoded body (canonical CSS-embedded SVG form)', () => {
            const out = decodeSvgDataUriPayload(
                "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"
            );
            expect(out).toContain('<svg');
            expect(out).toContain('</svg>');
        });

        it('decodes plain-text payload with literal angle brackets (DAX form)', () => {
            // DAX measures emit `data:image/svg+xml,<svg>...</svg>` with
            // literal `<`, `>`, `=`. `decodeURIComponent` is a no-op on
            // unencoded ASCII (it only throws on malformed `%XX`), so
            // the plain-text payload decodes cleanly without needing
            // any fallback path.
            const out = decodeSvgDataUriPayload(
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"
            );
            expect(out).not.toBeNull();
            expect(out).toContain('<svg');
        });

        it('returns null for malformed percent-encoding (fail-closed)', () => {
            // A stray `%` not followed by two hex digits makes
            // `decodeURIComponent` throw. The decoder must return null
            // (same fail-closed contract as the base64 branch) so
            // hasDangerousSvgPayload rejects. Returning the raw,
            // still-encoded payload would let `%3Cscript%3E...%GG`
            // slip past the caller's `/<script\b/i` regex while a
            // sandbox-weak surface still decoded and executed it.
            const out = decodeSvgDataUriPayload(
                'data:image/svg+xml;utf8,%3Cscript%3Ealert(1)%3C/script%3E%GG'
            );
            expect(out).toBeNull();
        });

        it('decodes bare-comma form (no charset parameter)', () => {
            const out = decodeSvgDataUriPayload(
                "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"
            );
            expect(out).toContain('<svg');
        });
    });

    describe('base64 form', () => {
        it('atob-decodes a ;base64, payload', () => {
            // base64 of '<svg xmlns="http://www.w3.org/2000/svg"/>'
            const b64 =
                'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
            const out = decodeSvgDataUriPayload(
                `data:image/svg+xml;base64,${b64}`
            );
            expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
        });

        it('returns null for malformed base64', () => {
            const out = decodeSvgDataUriPayload(
                'data:image/svg+xml;base64,!!!not-base64!!!'
            );
            expect(out).toBeNull();
        });

        it('detects ;base64 mid-header (e.g. ;base64;charset=...)', () => {
            // base64 of '<svg/>'
            const b64 = 'PHN2Zy8+';
            const out = decodeSvgDataUriPayload(
                `data:image/svg+xml;base64;charset=utf-8,${b64}`
            );
            expect(out).toBe('<svg/>');
        });

        // Multi-agent code review (adversarial): WHATWG mimesniff §4.4.3
        // strips whitespace around `base64` parameter values before
        // decoding. A strict `;base64$` regex misses
        // `data:image/svg+xml; base64,<b64>` and routes the payload
        // through decodeURIComponent — which returns the base64 string
        // verbatim, defeating the script-tag scan. The tolerant regex
        // `\s*base64\s*` matches browser parsing.
        it('detects ;base64 with leading whitespace (`; base64,...`)', () => {
            // base64 of '<svg/>'
            const b64 = 'PHN2Zy8+';
            const out = decodeSvgDataUriPayload(
                `data:image/svg+xml; base64,${b64}`
            );
            expect(out).toBe('<svg/>');
        });

        it('detects ;base64 with trailing whitespace (`;base64 ,...`)', () => {
            const b64 = 'PHN2Zy8+';
            const out = decodeSvgDataUriPayload(
                `data:image/svg+xml;base64 ,${b64}`
            );
            expect(out).toBe('<svg/>');
        });

        it('detects ;base64 with surrounding whitespace mid-header', () => {
            const b64 = 'PHN2Zy8+';
            const out = decodeSvgDataUriPayload(
                `data:image/svg+xml; base64 ;charset=utf-8,${b64}`
            );
            expect(out).toBe('<svg/>');
        });
    });

    describe('malformed input', () => {
        it('returns null when no comma is present', () => {
            expect(
                decodeSvgDataUriPayload('data:image/svg+xml;utf8')
            ).toBeNull();
        });

        it('returns empty string for empty payload after comma', () => {
            expect(decodeSvgDataUriPayload('data:image/svg+xml,')).toBe('');
        });
    });
});

describe('hasDangerousSvgPayload', () => {
    describe('safe payloads', () => {
        it('passes a minimal SVG', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"
                )
            ).toBe(false);
        });

        it('passes an SVG with safe inner shapes', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><circle cx='5' cy='5' r='3' fill='red'/><rect width='10' height='10' fill='blue'/></svg>"
                )
            ).toBe(false);
        });

        it('passes an SVG with fragment-only href', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><use href='#icon'/></svg>"
                )
            ).toBe(false);
        });

        it('passes an SVG with fragment-only xlink:href', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><use xlink:href='#icon'/></svg>"
                )
            ).toBe(false);
        });

        it('passes an SVG with empty href', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><a href=''>x</a></svg>"
                )
            ).toBe(false);
        });

        it('passes an SVG with inner href referencing data:image/png', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='data:image/png;base64,AAA' width='10' height='10'/></svg>"
                )
            ).toBe(false);
        });
    });

    describe('script tag rejection', () => {
        it('rejects <script>', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
                )
            ).toBe(true);
        });

        it('rejects <SCRIPT> (case-insensitive)', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><SCRIPT>alert(1)</SCRIPT></svg>"
                )
            ).toBe(true);
        });

        it('rejects <script with attributes', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><script type='application/javascript'>alert(1)</script></svg>"
                )
            ).toBe(true);
        });

        it('rejects base64-encoded payload carrying <script>', () => {
            // base64 of '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
            const b64 =
                'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';
            expect(
                hasDangerousSvgPayload(`data:image/svg+xml;base64,${b64}`)
            ).toBe(true);
        });

        it('rejects `; base64,` (whitespace-padded base64 marker carrying <script>)', () => {
            // Same payload as above but with a space before `base64`.
            // The browser still decodes; the tolerant regex must too.
            const b64 =
                'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';
            expect(
                hasDangerousSvgPayload(`data:image/svg+xml; base64,${b64}`)
            ).toBe(true);
        });
    });

    describe('foreignObject rejection', () => {
        it('rejects <foreignObject>', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><foreignObject><iframe src='https://attacker.example'/></foreignObject></svg>"
                )
            ).toBe(true);
        });

        it('rejects <foreignobject> (case-insensitive)', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><foreignobject></foreignobject></svg>"
                )
            ).toBe(true);
        });
    });

    describe('event handler rejection', () => {
        it('rejects onload= on the root <svg>', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"
                )
            ).toBe(true);
        });

        it('rejects onclick= on an inner element', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><rect onclick='alert(1)' width='10' height='10'/></svg>"
                )
            ).toBe(true);
        });

        it('rejects onmouseover= (less common handler)', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onmouseover='alert(1)'/>"
                )
            ).toBe(true);
        });

        it('rejects ONLOAD= (case-insensitive)', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' ONLOAD='alert(1)'/>"
                )
            ).toBe(true);
        });

        it('does not false-positive on attribute names that merely start with "on"', () => {
            // `offset` and `opacity` start with "o" but not the `on<word>=` shape.
            // Note: literal `%` in a `;utf8,` payload must be encoded as
            // `%25` to be a well-formed URI — `decodeSvgDataUriPayload`
            // now fail-closes on malformed percent-escapes per the
            // security review (2026-05-11).
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><stop offset='0%25' stop-color='red'/></svg>"
                )
            ).toBe(false);
        });

        // HTML5 tokenizer accepts adjacent attributes when separated by a
        // closing quote (no whitespace). The regex must match this shape
        // because the sandbox-weak surfaces the scan defends use the same
        // lenient parsers and would fire the handler.
        it('rejects double-quote-adjacent onclick (no whitespace boundary)', () => {
            expect(
                hasDangerousSvgPayload(
                    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" id="x"onclick="alert(1)"/>'
                )
            ).toBe(true);
        });

        it('rejects single-quote-adjacent onload', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' id='x'onload='alert(1)'/>"
                )
            ).toBe(true);
        });
    });

    describe('external href rejection', () => {
        it('rejects https: href on an inner element', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='https://attacker.example/track.png' width='10' height='10'/></svg>"
                )
            ).toBe(true);
        });

        it('rejects http: href', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='http://attacker.example/track.png' width='10' height='10'/></svg>"
                )
            ).toBe(true);
        });

        it('rejects external xlink:href', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image xlink:href='https://attacker.example/track.png' width='10' height='10'/></svg>"
                )
            ).toBe(true);
        });

        it('rejects javascript: href (belt and braces against a missed sandbox)', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><a href='javascript:alert(1)'>x</a></svg>"
                )
            ).toBe(true);
        });

        it('rejects file: href', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='file:///etc/passwd' width='10' height='10'/></svg>"
                )
            ).toBe(true);
        });

        // Inner data: hrefs are admitted only for image/* MIME types —
        // matches the outer-attribute restriction enforced by
        // getSanitizedDataUri / isSafeImageDataUri.
        it('rejects nested data:text/html href', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='data:text/html,<script>alert(1)</script>' width='10' height='10'/></svg>"
                )
            ).toBe(true);
        });

        it('rejects nested data:text/javascript href', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='data:text/javascript,alert(1)' width='10' height='10'/></svg>"
                )
            ).toBe(true);
        });

        it('rejects nested data:application/javascript href', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='data:application/javascript,alert(1)' width='10' height='10'/></svg>"
                )
            ).toBe(true);
        });

        it('preserves nested data:image/png href (allowlisted MIME)', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='data:image/png;base64,AAA' width='10' height='10'/></svg>"
                )
            ).toBe(false);
        });

        it('preserves nested data:image/svg+xml href (allowlisted MIME) when inner is benign', () => {
            // Inner is base64 of `<svg/>` — recursion scans it and finds
            // nothing dangerous, so the outer payload also passes.
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='data:image/svg+xml;base64,PHN2Zy8+' width='10' height='10'/></svg>"
                )
            ).toBe(false);
        });

        // Recursive scan of nested data:image/svg+xml inner hrefs
        // (security review). Without recursion, a base64 inner SVG
        // could hide <script>/<foreignObject>/on*= behind opaque
        // base64 that the outer regex can't see through. The outer
        // <script> regex catches a literal <script> string in the
        // outer decoded body, but base64 wrapping is opaque until
        // the inner data URI is itself decoded.
        it('rejects inner data:image/svg+xml with embedded <script> (utf8)', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>\"/></svg>"
                )
            ).toBe(true);
        });

        it('rejects inner data:image/svg+xml;base64 carrying base64-encoded <script> (security bypass)', () => {
            // base64 of `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`
            const innerB64 =
                'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';
            expect(
                hasDangerousSvgPayload(
                    `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='data:image/svg+xml;base64,${innerB64}'/></svg>`
                )
            ).toBe(true);
        });

        it('rejects inner data:image/svg+xml with <foreignObject>', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><foreignObject/></svg>\"/></svg>"
                )
            ).toBe(true);
        });

        it('rejects inner data:image/svg+xml with on*= handler', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>\"/></svg>"
                )
            ).toBe(true);
        });

        it('rejects inner data:image/svg+xml whose innermost element has external href (transitive)', () => {
            // Outer wraps inner svg+xml; that inner svg has an <image>
            // pointing at https://attacker — caught at recursion depth 1.
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image href='https://attacker.example/x.png'/></svg>\"/></svg>"
                )
            ).toBe(true);
        });

        // For depth-cap testing the inner URI must be base64-encoded.
        // The href regex captures `[^"'\s>]+` — a `;utf8,` inner URI
        // containing literal `'` (e.g. `xmlns='...'`) gets truncated
        // at the first quote, so recursion never actually descends.
        // Real-world bypass payloads use base64 wrapping (which is
        // quote-free), so this is also closer to the threat model.
        const wrapInBase64Svg = (innerHref: string): string => {
            const inner = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${innerHref}"/></svg>`;
            const b64 = Buffer.from(inner).toString('base64');
            return `data:image/svg+xml;base64,${b64}`;
        };

        it('preserves benign nesting up to the depth cap', () => {
            // 4 base64-wrapped layers of benign svg+xml — recursion
            // should scan every layer, find nothing dangerous, and
            // admit the outer URI.
            const innermost =
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>";
            let nested = innermost;
            for (let i = 0; i < 4; i++) nested = wrapInBase64Svg(nested);
            expect(hasDangerousSvgPayload(nested)).toBe(false);
        });

        it('rejects payload nesting that exceeds the depth cap (fail-closed)', () => {
            // 6 base64-wrapped layers — exceeds MAX_PAYLOAD_SCAN_DEPTH
            // (4). Reaching the cap returns true, because we can no
            // longer verify the deepest layer's content.
            const innermost =
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>";
            let nested = innermost;
            for (let i = 0; i < 6; i++) nested = wrapInBase64Svg(nested);
            expect(hasDangerousSvgPayload(nested)).toBe(true);
        });

        it('depth-cap fires when called directly at the cap boundary', () => {
            // Direct test of the `depth > MAX_PAYLOAD_SCAN_DEPTH`
            // gate. A trivially-benign URI returns true when entered
            // at depth 5, false at depth 0.
            const benign =
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>";
            expect(hasDangerousSvgPayload(benign, 5)).toBe(true);
            expect(hasDangerousSvgPayload(benign, 0)).toBe(false);
        });

        // HTML5's lenient tokenizer accepts adjacent attributes
        // separated by a closing quote (no whitespace). The boundary
        // group on the href regex must match `"`/`'` as well as
        // whitespace and start-of-string — same shape applied to the
        // on* event-handler regex earlier.
        it('rejects double-quote-adjacent external href on inner element', () => {
            expect(
                hasDangerousSvgPayload(
                    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><image id="x"href="https://attacker.example/pixel" width="10" height="10"/></svg>'
                )
            ).toBe(true);
        });

        it('rejects single-quote-adjacent external xlink:href on inner element', () => {
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image id='x'xlink:href='https://attacker.example/pixel' width='10' height='10'/></svg>"
                )
            ).toBe(true);
        });

        it('rejects double-quote-adjacent nested data:text/html href', () => {
            expect(
                hasDangerousSvgPayload(
                    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><image id="x"href="data:text/html,<script>alert(1)</script>" width="10" height="10"/></svg>'
                )
            ).toBe(true);
        });
    });

    describe('malformed input', () => {
        it('rejects URI with no comma (decoder returns null)', () => {
            expect(hasDangerousSvgPayload('data:image/svg+xml;utf8')).toBe(
                true
            );
        });

        it('rejects URI with malformed base64 payload', () => {
            expect(
                hasDangerousSvgPayload(
                    'data:image/svg+xml;base64,!!!not-base64!!!'
                )
            ).toBe(true);
        });
    });
});

describe('isSafeImageDataUri', () => {
    describe('safe inputs', () => {
        it('admits data:image/png;base64', () => {
            expect(
                isSafeImageDataUri(
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z3I3rUAAAAASUVORK5CYII='
                )
            ).toBe(true);
        });

        it('admits data:image/jpeg;base64', () => {
            expect(isSafeImageDataUri('data:image/jpeg;base64,AAA')).toBe(true);
        });

        it('admits data:image/svg+xml;utf8 with safe SVG', () => {
            expect(
                isSafeImageDataUri(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"
                )
            ).toBe(true);
        });

        it('admits data:image/svg+xml;base64 with safe SVG', () => {
            // base64 of '<svg xmlns="http://www.w3.org/2000/svg"/>'
            const b64 = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
            expect(isSafeImageDataUri(`data:image/svg+xml;base64,${b64}`)).toBe(
                true
            );
        });

        it('admits data:image/svg+xml,<svg/> bare-comma form', () => {
            expect(
                isSafeImageDataUri(
                    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"
                )
            ).toBe(true);
        });
    });

    describe('rejects MIME types not on the allowlist', () => {
        it('rejects data:text/html', () => {
            expect(
                isSafeImageDataUri(
                    'data:text/html,<script>alert(1)</script>'
                )
            ).toBe(false);
        });

        it('rejects data:text/javascript', () => {
            expect(isSafeImageDataUri('data:text/javascript,alert(1)')).toBe(
                false
            );
        });

        it('rejects data:application/javascript', () => {
            expect(
                isSafeImageDataUri('data:application/javascript,alert(1)')
            ).toBe(false);
        });

        it('rejects data: with no MIME', () => {
            expect(isSafeImageDataUri('data:,whatever')).toBe(false);
        });
    });

    describe('rejects raster MIME without base64', () => {
        it('rejects data:image/png without ;base64,', () => {
            expect(
                isSafeImageDataUri(
                    'data:image/png,<svg/onload=alert(1)>'
                )
            ).toBe(false);
        });

        it('rejects data:image/jpeg without ;base64,', () => {
            expect(
                isSafeImageDataUri('data:image/jpeg,smuggled-html')
            ).toBe(false);
        });
    });

    describe('rejects svg+xml with dangerous payload', () => {
        it('rejects svg+xml with embedded <script>', () => {
            expect(
                isSafeImageDataUri(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
                )
            ).toBe(false);
        });

        it('rejects svg+xml with onload= handler', () => {
            expect(
                isSafeImageDataUri(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"
                )
            ).toBe(false);
        });

        it('rejects svg+xml with external xlink:href on inner element', () => {
            expect(
                isSafeImageDataUri(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image xlink:href='https://attacker.example/track.png'/></svg>"
                )
            ).toBe(false);
        });
    });

    describe('non-data inputs', () => {
        it('rejects empty input', () => {
            expect(isSafeImageDataUri('')).toBe(false);
        });

        it('rejects http:// URL', () => {
            expect(
                isSafeImageDataUri('https://attacker.example/x.png')
            ).toBe(false);
        });

        it('rejects fragment ref (caller handles separately)', () => {
            expect(isSafeImageDataUri('#fragment')).toBe(false);
        });
    });
});
