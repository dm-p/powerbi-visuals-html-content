import { describe, it, expect } from 'vitest';
import {
    decodeSvgDataUriPayload,
    hasDangerousSvgPayload
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

        it('falls back to raw payload when decodeURIComponent throws (literal angle brackets — DAX form)', () => {
            // `decodeURIComponent` throws on stray `%` that does not begin
            // a valid escape — DAX-emitted SVG payloads with literal `<`,
            // `>`, `=`, etc. don't trip this, but a payload with a `%XY`
            // sequence that is not a valid escape will. The decoder must
            // not return null in that case; the caller's regex scan
            // operates on the raw payload.
            const out = decodeSvgDataUriPayload(
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'>%ZZ</svg>"
            );
            expect(out).not.toBeNull();
            expect(out).toContain('<svg');
            expect(out).toContain('%ZZ');
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
            expect(
                hasDangerousSvgPayload(
                    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><stop offset='0%' stop-color='red'/></svg>"
                )
            ).toBe(false);
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
