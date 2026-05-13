import { describe, it, expect } from 'vitest';
import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';

/**
 * Regression suite for SVG sanitization permissibility.
 *
 * `sanitize-pipeline.test.ts` covers the wiring (inline style, <style>
 * tag, data: URIs, event handlers) and `security-*` cover attack
 * surface. This file covers the inverse: legitimate SVG output —
 * presentation attributes, filter primitives, accessibility elements,
 * gradients, and realistic chart fixtures — which the per-tag attribute
 * allowlist used to over-strip. Issue #143 plus follow-up reports of
 * "SVGs not working" all map to gaps in that allowlist.
 *
 * Each test asserts what survives through the full pipeline. The HTML
 * branch keeps the strict per-tag allowlist; the SVG branch is
 * denylist-based (on*, srcdoc, formaction, action, ping, background,
 * poster, srcset; URL-bearing attrs gated by allowedSchemesByTag).
 */
const sanitize = (s: string) => getSanitizedHtmlForTesting(s, 'html');

describe('sanitize-pipeline — SVG presentation attributes', () => {
    describe('opacity and overlay', () => {
        it('preserves fill-opacity on path', () => {
            const out = sanitize(
                '<svg><path d="M0,0 L10,10" fill="red" fill-opacity="0.3"/></svg>'
            );
            expect(out).toContain('fill-opacity');
        });

        it('preserves fill-opacity on rect', () => {
            const out = sanitize(
                '<svg><rect x="0" y="0" width="100" height="50" fill="red" fill-opacity="0.5"/></svg>'
            );
            expect(out).toContain('fill-opacity');
        });

        it('preserves stroke-opacity on rect', () => {
            const out = sanitize(
                '<svg><rect x="0" y="0" width="100" height="50" stroke="red" stroke-opacity="0.5"/></svg>'
            );
            expect(out).toContain('stroke-opacity');
        });

        it('preserves mix-blend-mode in inline style', () => {
            const out = sanitize(
                '<svg><rect x="0" y="0" width="100" height="50" fill="red" style="mix-blend-mode: multiply"/></svg>'
            );
            expect(out).toContain('mix-blend-mode');
        });
    });

    describe('display, visibility, paint, clipping', () => {
        it('preserves display on g', () => {
            const out = sanitize('<svg><g display="none"></g></svg>');
            expect(out).toContain('display');
        });

        it('preserves visibility on g', () => {
            const out = sanitize('<svg><g visibility="hidden"></g></svg>');
            expect(out).toContain('visibility');
        });

        it('preserves overflow on svg', () => {
            const out = sanitize('<svg overflow="visible"></svg>');
            expect(out).toContain('overflow');
        });

        it('preserves paint-order on path', () => {
            const out = sanitize(
                '<svg><path d="M0,0 L10,10" paint-order="stroke fill"/></svg>'
            );
            expect(out).toContain('paint-order');
        });

        it('preserves color-interpolation-filters on filter', () => {
            const out = sanitize(
                '<svg><filter id="f" color-interpolation-filters="sRGB"></filter></svg>'
            );
            expect(out).toContain('color-interpolation-filters');
        });

        it('preserves clip-rule on path', () => {
            const out = sanitize(
                '<svg><path d="M0,0 L10,10" clip-rule="evenodd"/></svg>'
            );
            expect(out).toContain('clip-rule');
        });
    });

    describe('viewBox and responsive sizing', () => {
        it('preserves viewBox on svg', () => {
            const out = sanitize('<svg viewBox="0 0 100 100"></svg>');
            expect(out).toContain('viewBox');
        });

        it('preserves preserveAspectRatio on svg', () => {
            const out = sanitize(
                '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"></svg>'
            );
            expect(out).toContain('preserveAspectRatio');
        });

        it('preserves percentage width and height on svg', () => {
            const out = sanitize(
                '<svg viewBox="0 0 100 100" width="100%" height="100%"></svg>'
            );
            expect(out).toContain('width="100%"');
            expect(out).toContain('height="100%"');
        });
    });

    describe('accessibility elements', () => {
        it('preserves <title> inside <svg>', () => {
            const out = sanitize(
                '<svg><title>Sales Map</title><rect width="10" height="10"/></svg>'
            );
            expect(out).toContain('<title>Sales Map</title>');
        });

        it('preserves <desc> inside <svg>', () => {
            const out = sanitize(
                '<svg><desc>Quarterly sales by region</desc></svg>'
            );
            expect(out).toContain('<desc>');
        });
    });

    describe('text and tspan styling', () => {
        it('preserves font-style on text', () => {
            const out = sanitize(
                '<svg><text x="10" y="20" font-style="italic" font-size="12">Axis</text></svg>'
            );
            expect(out).toContain('font-style');
            expect(out).toContain('italic');
        });

        it('preserves transform=rotate on text', () => {
            const out = sanitize(
                '<svg><text x="10" y="20" transform="rotate(-45 10 20)">Q1 2025</text></svg>'
            );
            expect(out).toContain('rotate(-45');
        });

        it('preserves text-decoration on text', () => {
            const out = sanitize(
                '<svg><text x="0" y="0" text-decoration="underline">Series A</text></svg>'
            );
            expect(out).toContain('text-decoration');
        });

        it('preserves letter-spacing on text', () => {
            const out = sanitize(
                '<svg><text x="0" y="0" letter-spacing="0.1em">SPACED</text></svg>'
            );
            expect(out).toContain('letter-spacing');
        });

        it('preserves xml:space on tspan', () => {
            const out = sanitize(
                '<svg><text><tspan xml:space="preserve">  padded  </tspan></text></svg>'
            );
            expect(out).toContain('xml:space');
        });
    });

    describe('stroke styling on shapes', () => {
        it('preserves stroke-dasharray on line', () => {
            const out = sanitize(
                '<svg><line x1="0" y1="0" x2="100" y2="0" stroke="#ccc" stroke-dasharray="2,2"/></svg>'
            );
            expect(out).toContain('stroke-dasharray');
        });

        it('preserves stroke-linecap on line', () => {
            const out = sanitize(
                '<svg><line x1="0" y1="0" x2="100" y2="0" stroke="#000" stroke-linecap="round"/></svg>'
            );
            expect(out).toContain('stroke-linecap');
        });

        it('preserves stroke-linejoin and stroke-linecap on polyline', () => {
            const out = sanitize(
                '<svg><polyline points="0,10 10,5 20,15 30,2" fill="none" stroke="#000" stroke-linejoin="round" stroke-linecap="round"/></svg>'
            );
            expect(out).toContain('stroke-linejoin');
            expect(out).toContain('stroke-linecap');
        });

        it('preserves marker-end on path', () => {
            const out = sanitize(
                '<svg><defs><marker id="a" viewBox="0 0 10 10"><path d="M0,0 L10,5 L0,10"/></marker></defs>' +
                '<path d="M0,0 L100,0" stroke="black" marker-end="url(#a)"/></svg>'
            );
            expect(out).toContain('marker-end');
        });

        it('preserves fill-rule on path', () => {
            const out = sanitize(
                '<svg><path d="M0,0 L50,0 A50,50 0 0,1 25,43 Z" fill="red" fill-rule="evenodd"/></svg>'
            );
            expect(out).toContain('fill-rule');
        });

        it('preserves vector-effect on rect', () => {
            const out = sanitize(
                '<svg><rect x="0" y="0" width="100" height="50" stroke="#000" vector-effect="non-scaling-stroke"/></svg>'
            );
            expect(out).toContain('vector-effect');
        });
    });

    describe('filter primitives', () => {
        it('preserves stdDeviation and in on feGaussianBlur', () => {
            const out = sanitize(
                '<svg><filter id="f"><feGaussianBlur in="SourceGraphic" stdDeviation="3"/></filter></svg>'
            );
            expect(out).toContain('stdDeviation');
            expect(out).toContain('SourceGraphic');
        });

        it('preserves type and values on feColorMatrix', () => {
            const out = sanitize(
                '<svg><filter id="f"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter></svg>'
            );
            expect(out).toContain('values');
            expect(out).toContain('type');
        });

        it('preserves dx/dy/in/result on feOffset', () => {
            const out = sanitize(
                '<svg><filter id="f"><feOffset in="SourceAlpha" dx="2" dy="2" result="off"/></filter></svg>'
            );
            expect(out).toContain('dx');
            expect(out).toContain('dy');
            expect(out).toContain('result');
        });

        it('preserves in on feMergeNode', () => {
            const out = sanitize(
                '<svg><filter id="f"><feMerge><feMergeNode in="off"/><feMergeNode in="SourceGraphic"/></feMerge></filter></svg>'
            );
            expect(out).toMatch(/\sin=/);
        });

        it('preserves stdDeviation and flood-color on feDropShadow', () => {
            const out = sanitize(
                '<svg><filter id="s"><feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="black" flood-opacity="0.5"/></filter></svg>'
            );
            expect(out).toContain('stdDeviation');
            expect(out).toContain('flood-color');
        });
    });

    describe('group hit-testing', () => {
        it('preserves pointer-events and cursor on g', () => {
            const out = sanitize(
                '<svg><g pointer-events="all" cursor="pointer"><rect x="0" y="0" width="10" height="10"/></g></svg>'
            );
            expect(out).toContain('pointer-events');
            expect(out).toContain('cursor');
        });
    });

    describe('gradients', () => {
        it('preserves gradientUnits and stop-color on linearGradient', () => {
            const out = sanitize(
                '<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">' +
                '<stop offset="0%" stop-color="red"/><stop offset="100%" stop-color="blue"/>' +
                '</linearGradient></defs>' +
                '<rect x="0" y="0" width="100" height="50" fill="url(#g)"/></svg>'
            );
            expect(out).toContain('gradientUnits');
            expect(out).toContain('stop-color');
        });

        it('preserves fill="url(#id)" reference on rect', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10" fill="url(#g)"/></svg>'
            );
            expect(out).toMatch(/fill="url\(#g\)"/);
        });
    });

    describe('end-to-end chart fixtures', () => {
        it('keeps structural attributes on a d3-style sparkline', () => {
            const sparkline =
                '<svg width="120" height="30" viewBox="0 0 120 30" xmlns="http://www.w3.org/2000/svg">' +
                '<g transform="translate(2,2)">' +
                '<path d="M0,20 L20,10 L40,15 L60,5 L80,12 L100,3" ' +
                'fill="none" stroke="#0078d4" stroke-width="1.5" ' +
                'stroke-linecap="round" stroke-linejoin="round"/>' +
                '<circle cx="100" cy="3" r="2" fill="#0078d4"/>' +
                '</g></svg>';
            const out = sanitize(sparkline);
            expect(out).toContain('viewBox');
            expect(out).toContain('translate(2,2)');
            expect(out).toContain('M0,20');
            expect(out).toContain('stroke-linecap');
            expect(out).toContain('stroke-linejoin');
        });

        it('keeps tick lines, rotated labels and bar rects on a bar chart', () => {
            const bar =
                '<svg width="200" height="120" viewBox="0 0 200 120">' +
                '<g class="axis" transform="translate(0,100)">' +
                '<line x1="0" y1="0" x2="200" y2="0" stroke="#333"/>' +
                '<g class="tick" transform="translate(20,0)">' +
                '<line y2="6" stroke="#333"/>' +
                '<text y="9" dy="0.71em" text-anchor="middle" font-style="italic">Jan</text>' +
                '</g></g>' +
                '<g class="bars">' +
                '<rect x="10" y="40" width="20" height="60" fill="steelblue"/>' +
                '<rect x="40" y="20" width="20" height="80" fill="steelblue"/>' +
                '</g></svg>';
            const out = sanitize(bar);
            expect(out).toContain('text-anchor');
            expect(out).toContain('font-style');
            expect(out).toContain('steelblue');
            expect(out).toContain('translate(0,100)');
        });

        it('keeps dasharray on a reference line and stdDeviation on a drop shadow', () => {
            const chart =
                '<svg width="300" height="150" viewBox="0 0 300 150">' +
                '<defs>' +
                '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">' +
                '<feGaussianBlur in="SourceAlpha" stdDeviation="2"/>' +
                '<feOffset dx="1" dy="1" result="off"/>' +
                '<feMerge><feMergeNode in="off"/><feMergeNode in="SourceGraphic"/></feMerge>' +
                '</filter>' +
                '</defs>' +
                '<line x1="0" y1="75" x2="300" y2="75" stroke="#999" stroke-dasharray="4,2"/>' +
                '<path d="M0,100 L100,40 L200,60 L300,20" fill="none" stroke="#0078d4" filter="url(#shadow)"/>' +
                '</svg>';
            const out = sanitize(chart);
            expect(out).toContain('stroke-dasharray');
            expect(out).toContain('stdDeviation');
            expect(out).toContain('feMergeNode');
            expect(out).toMatch(/filter="url\(#shadow\)"/);
        });

        it('keeps everything a dual-axis chart needs', () => {
            const chart =
                '<svg viewBox="0 0 400 200" width="100%" height="200">' +
                  '<g class="bars" transform="translate(40,10)">' +
                    '<rect x="0"  y="80" width="20" height="100" fill="steelblue" fill-opacity="0.8"/>' +
                    '<rect x="40" y="60" width="20" height="120" fill="steelblue" fill-opacity="0.8"/>' +
                  '</g>' +
                  '<g class="line" transform="translate(40,10)">' +
                    '<path d="M10,150 L50,90 L90,120" fill="none" stroke="orange" ' +
                          'stroke-width="2" stroke-linecap="round"/>' +
                  '</g>' +
                  '<g class="left-axis" transform="translate(40,10)" pointer-events="none">' +
                    '<line x1="0" y1="0" x2="0" y2="180" stroke="#333"/>' +
                    '<text x="-5" y="0" text-anchor="end" font-style="italic">100</text>' +
                  '</g>' +
                  '<g class="right-axis" transform="translate(360,10)" pointer-events="none">' +
                    '<line x1="0" y1="0" x2="0" y2="180" stroke="#333" stroke-dasharray="2,2"/>' +
                    '<text x="5" y="0" text-anchor="start" font-style="italic">$5K</text>' +
                  '</g>' +
                '</svg>';
            const out = sanitize(chart);
            expect(out).toContain('fill-opacity');
            expect(out).toContain('pointer-events');
            expect(out).toContain('stroke-dasharray');
            expect(out).toContain('font-style');
            expect(out).toContain('viewBox');
            expect(out).toContain('translate(40,10)');
        });
    });

    // Negative-test coverage for the SVG denylist branch in
    // src/sanitize-pipeline.ts. The positive tests above prove legitimate
    // attrs survive; these prove dangerous attrs are dropped, and the
    // partial-survival case proves that inline-style mutation is written
    // back (regression guard for the forceKeepAttr/setAttribute issue
    // surfaced by code review on this branch).
    describe('denylist drops', () => {
        it('drops the entire SVG element when an on* event handler is present', () => {
            const out = sanitize('<svg><rect onclick="alert(1)" width="10" height="10"/></svg>');
            expect(out).not.toContain('onclick');
            expect(out).not.toContain('alert');
        });

        it('drops mixed-case OnClick on an SVG element', () => {
            const out = sanitize('<svg><rect OnClick="alert(1)" width="10" height="10"/></svg>');
            expect(out).not.toContain('OnClick');
            expect(out).not.toContain('onclick');
            expect(out).not.toContain('alert');
        });

        it.each([
            ['srcdoc', '<svg><rect srcdoc="<script>alert(1)</script>" width="10" height="10"/></svg>'],
            ['formaction', '<svg><rect formaction="javascript:alert(1)" width="10" height="10"/></svg>'],
            ['action', '<svg><rect action="javascript:alert(1)" width="10" height="10"/></svg>'],
            ['ping', '<svg><rect ping="https://attacker.example" width="10" height="10"/></svg>'],
            ['background', '<svg><rect background="https://attacker.example/x.png" width="10" height="10"/></svg>'],
            ['poster', '<svg><rect poster="https://attacker.example/x.png" width="10" height="10"/></svg>'],
            ['srcset', '<svg><rect srcset="https://attacker.example/x.png 2x" width="10" height="10"/></svg>']
        ])('drops the %s attribute on an SVG element', (attr, input) => {
            const out = sanitize(input);
            expect(out).not.toContain(attr);
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('alert');
        });

        it('strips dangerous CSS declarations from inline style on an SVG element while keeping safe ones (partial-survival)', () => {
            // Regression guard for the forceKeepAttr/setAttribute issue.
            // background: url(http://...) is dropped by the URL property
            // sanitizer (per-property url() check, not the defense-in-depth
            // block-drop pass), so the safe `fill: red` declaration survives.
            // Pre-fix this test would fail because forceKeepAttr=true short-
            // circuited DOMPurify's setAttribute, leaving the original
            // unsanitized style on the node.
            const out = sanitize(
                '<svg><rect style="fill: red; background: url(http://attacker.example/x.png)" width="10" height="10"/></svg>'
            );
            expect(out).toContain('fill:red');
            expect(out).not.toContain('background');
            expect(out).not.toContain('attacker.example');
        });

        it('drops external https href on SVG <image>', () => {
            const out = sanitize(
                '<svg><image href="https://attacker.example/track.png" width="10" height="10"/></svg>'
            );
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('https://');
        });

        it('drops external https xlink:href on SVG <image>', () => {
            const out = sanitize(
                '<svg><image xlink:href="https://attacker.example/track.png" width="10" height="10"/></svg>'
            );
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('https://');
        });

        it.each([
            ['feImage', '<svg><filter id="f"><feImage href="https://attacker.example/x.png"/></filter></svg>'],
            ['pattern', '<svg><defs><pattern id="p" href="https://attacker.example/x.svg"><rect width="10" height="10"/></pattern></defs></svg>'],
            ['linearGradient', '<svg><defs><linearGradient id="g" href="https://attacker.example/x.svg"><stop offset="0%" stop-color="red"/></linearGradient></defs></svg>'],
            ['radialGradient', '<svg><defs><radialGradient id="g" href="https://attacker.example/x.svg"><stop offset="0%" stop-color="red"/></radialGradient></defs></svg>'],
            ['filter', '<svg><filter id="f" href="https://attacker.example/x.svg"><feGaussianBlur stdDeviation="2"/></filter></svg>']
        ])('drops external https href on SVG <%s>', (_tag, input) => {
            const out = sanitize(input);
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('https://');
        });

        it('drops external textPath href (only same-document fragments allowed)', () => {
            const out = sanitize(
                '<svg><text><textPath href="https://attacker.example/path.svg#p">label</textPath></text></svg>'
            );
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('https://');
            expect(out).toContain('label');
        });

        it('drops external https url() in SVG funciri values (mask, clip-path, filter)', () => {
            const out = sanitize(
                '<svg><rect mask="url(https://attacker.example/m.svg)" clip-path="url(https://attacker.example/c.svg)" filter="url(https://attacker.example/f.svg)" width="10" height="10"/></svg>'
            );
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('https://');
        });

        it('keeps fragment-only url() in SVG funciri values (legitimate use)', () => {
            const out = sanitize(
                '<svg><defs><filter id="shadow"><feGaussianBlur stdDeviation="2"/></filter></defs>' +
                '<rect filter="url(#shadow)" width="10" height="10"/></svg>'
            );
            expect(out).toContain('url(#shadow)');
        });
    });

    // SMIL animation elements (issue #145).
    // Allowed but locked down by:
    //   - allowedSchemesByTag fragment-only on the SMIL element itself
    //   - SMIL_ATTRIBUTE_NAME_DENYLIST on the `attributeName` value
    //   - existing on*/scriptingPatterns/funciri checks on attribute values
    describe('SMIL animation — safe targets pass through', () => {
        it('preserves <animate attributeName="opacity"> (HomeTetris fade-in shape)', () => {
            const out = sanitize(
                '<svg><g opacity="0">' +
                '<animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="1s" fill="freeze"/>' +
                '<rect width="10" height="10"/></g></svg>'
            );
            expect(out).toContain('<animate');
            expect(out).toContain('attributeName="opacity"');
            expect(out).toContain('from="0"');
            expect(out).toContain('to="1"');
            expect(out).toContain('fill="freeze"');
        });

        it('preserves <animateTransform attributeName="transform" type="translate">', () => {
            const out = sanitize(
                '<svg><g transform="translate(0,-400)">' +
                '<animateTransform attributeName="transform" type="translate" ' +
                'from="0,-400" to="0,0" dur="1.5s" begin="0s" fill="freeze" ' +
                'calcMode="spline" keySplines="0.42 0 0.58 1" keyTimes="0;1"/>' +
                '<rect width="10" height="10"/></g></svg>'
            );
            expect(out).toContain('<animateTransform');
            expect(out).toContain('attributeName="transform"');
            expect(out).toContain('type="translate"');
            expect(out).toContain('keySplines="0.42 0 0.58 1"');
        });

        it('preserves <animate attributeName="fill"> (presentation property)', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10" fill="red">' +
                '<animate attributeName="fill" from="red" to="blue" dur="2s"/>' +
                '</rect></svg>'
            );
            expect(out).toContain('<animate');
            expect(out).toContain('attributeName="fill"');
        });

        it('preserves <animate attributeName="cx"> (geometry property)', () => {
            const out = sanitize(
                '<svg><circle cx="0" cy="50" r="10">' +
                '<animate attributeName="cx" from="0" to="100" dur="1s"/>' +
                '</circle></svg>'
            );
            expect(out).toContain('attributeName="cx"');
        });

        it('preserves <set attributeName="visibility">', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10" visibility="hidden">' +
                '<set attributeName="visibility" to="visible" begin="1s"/>' +
                '</rect></svg>'
            );
            expect(out).toContain('<set');
            expect(out).toContain('attributeName="visibility"');
        });

        it('preserves fragment-only xlink:href on <animate>', () => {
            const out = sanitize(
                '<svg><circle id="c1" cx="50" cy="50" r="10"/>' +
                '<animate xlink:href="#c1" attributeName="opacity" from="0" to="1" dur="1s"/>' +
                '</svg>'
            );
            expect(out).toContain('<animate');
            expect(out).toContain('xlink:href="#c1"');
            expect(out).toContain('attributeName="opacity"');
        });
    });

    describe('SMIL animation — bypass attempts are neutered', () => {
        it('drops attributeName="href" on <animate> (sanitizer-bypass primitive)', () => {
            const out = sanitize(
                '<svg><a href="https://safe.example/x">' +
                '<animate attributeName="href" to="javascript:alert(1)" dur="1s" begin="0s" fill="freeze"/>' +
                'click</a></svg>'
            );
            expect(out).not.toContain('attributeName="href"');
            expect(out).not.toContain('javascript:');
            expect(out).not.toContain('alert(1)');
        });

        it('drops attributeName="xlink:href" on <animate>', () => {
            // The dangerous primitive is the attributeName declaration —
            // without it, SMIL cannot bind the `to=` value to any target
            // attribute, so the URL is dead string data even if it
            // survives serialization. Asserting only the neutering, not
            // the literal string presence.
            const out = sanitize(
                '<svg><image xlink:href="data:image/png;base64,AAA" width="10" height="10">' +
                '<animate attributeName="xlink:href" to="https://attacker.example/track.png" dur="1s"/>' +
                '</image></svg>'
            );
            expect(out).not.toContain('attributeName="xlink:href"');
        });

        it('drops attributeName="src" on <animate>', () => {
            const out = sanitize(
                '<svg><image><animate attributeName="src" to="javascript:alert(1)"/></image></svg>'
            );
            expect(out).not.toContain('attributeName="src"');
            expect(out).not.toContain('javascript:');
        });

        it('drops attributeName="style" on <animate> (bulk-attr bypass)', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10">' +
                '<animate attributeName="style" to="background:url(javascript:alert(1))" dur="1s"/>' +
                '</rect></svg>'
            );
            expect(out).not.toContain('attributeName="style"');
            expect(out).not.toContain('javascript:');
        });

        it('drops attributeName="attributeName" on <animate> (meta attack)', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10">' +
                '<animate attributeName="attributeName" to="href" dur="1s"/>' +
                '</rect></svg>'
            );
            expect(out).not.toContain('attributeName="attributeName"');
        });

        it('drops attributeName="clip-path" on <animate> (url(#) attribute)', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10">' +
                '<animate attributeName="clip-path" to="url(#evil)" dur="1s"/>' +
                '</rect></svg>'
            );
            expect(out).not.toContain('attributeName="clip-path"');
        });

        it('drops attributeName="mask" on <animate>', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10">' +
                '<animate attributeName="mask" to="url(#evil)" dur="1s"/>' +
                '</rect></svg>'
            );
            expect(out).not.toContain('attributeName="mask"');
        });

        it('drops attributeName="filter" on <animate>', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10">' +
                '<animate attributeName="filter" to="url(#evil)" dur="1s"/>' +
                '</rect></svg>'
            );
            expect(out).not.toContain('attributeName="filter"');
        });

        it('drops attributeName="cursor" on <animate>', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10">' +
                '<animate attributeName="cursor" to="url(https://attacker.example/x.cur),auto" dur="1s"/>' +
                '</rect></svg>'
            );
            expect(out).not.toContain('attributeName="cursor"');
        });

        it('drops attributeName="marker-end" on <animate>', () => {
            const out = sanitize(
                '<svg><line x1="0" y1="0" x2="10" y2="10">' +
                '<animate attributeName="marker-end" to="url(#evil)" dur="1s"/>' +
                '</line></svg>'
            );
            expect(out).not.toContain('attributeName="marker-end"');
        });

        it('drops external xlink:href on <animate> (per-tag scheme allowlist is fragment-only)', () => {
            const out = sanitize(
                '<svg><animate xlink:href="https://attacker.example/evil.svg" attributeName="opacity" from="0" to="1" dur="1s"/></svg>'
            );
            expect(out).not.toContain('attacker.example');
            expect(out).not.toContain('https://');
        });

        it('drops <animate> attribute value containing javascript: (existing scriptingPatterns gate)', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10">' +
                '<animate attributeName="fill" to="javascript:alert(1)" dur="1s"/>' +
                '</rect></svg>'
            );
            expect(out).not.toContain('javascript:');
            expect(out).not.toContain('alert(1)');
        });

        it('drops <animate> with on* event handler (existing on* gate removes the element)', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10">' +
                '<animate onbegin="alert(1)" attributeName="opacity" from="0" to="1" dur="1s"/>' +
                '</rect></svg>'
            );
            expect(out).not.toContain('onbegin');
            expect(out).not.toContain('alert(1)');
        });

        it('drops funciri-wrapped javascript: in <animate> to=', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10" fill="red">' +
                '<animate attributeName="fill" to="url(javascript:alert(1))" dur="1s"/>' +
                '</rect></svg>'
            );
            expect(out).not.toContain('javascript:');
            expect(out).not.toContain('alert(1)');
        });
    });

    // marker / symbol fragment-only href (security review). SVG2 allows
    // <marker href="#otherMarker"> and <symbol href="#otherSymbol"> for
    // cross-referencing within the same document. allowedSchemesByTag
    // entries with fragment-only [''] policy let those through while
    // dropping external URLs.
    describe('marker and symbol fragment href', () => {
        it('preserves <marker href="#m">', () => {
            const out = sanitize(
                '<svg><defs><marker id="base" viewBox="0 0 10 10"/>' +
                '<marker id="derived" href="#base" viewBox="0 0 10 10"/>' +
                '</defs></svg>'
            );
            expect(out).toContain('<marker');
            expect(out).toContain('href="#base"');
        });

        it('drops external href on <marker>', () => {
            const out = sanitize(
                '<svg><marker id="m" href="https://attacker.example/m.svg"/></svg>'
            );
            expect(out).not.toContain('attacker.example');
        });

        it('preserves <symbol href="#s">', () => {
            const out = sanitize(
                '<svg><symbol id="base" viewBox="0 0 10 10"/>' +
                '<symbol id="derived" href="#base" viewBox="0 0 10 10"/></svg>'
            );
            expect(out).toContain('<symbol');
            expect(out).toContain('href="#base"');
        });

        it('drops external href on <symbol>', () => {
            const out = sanitize(
                '<svg><symbol id="s" href="https://attacker.example/s.svg"/></svg>'
            );
            expect(out).not.toContain('attacker.example');
        });
    });

    // SVG funciri presentation attributes (filter, mask, clip-path,
    // marker-*, fill, stroke, cursor) accept `url(...)` references.
    // Security review: when the embedded URL is a `data:` URI, the
    // funciri gate must run the same image-data-URI safety check as
    // the top-level src/href path and the CSS url() path. Without
    // this, an attacker-controlled svg+xml data URI inside a funciri
    // could carry <foreignObject> or external href that the
    // image-context sandbox neuters in modern browsers but a
    // sandbox-weak surface (older WebView2, mobile, export) would not.
    describe('funciri data: payload validation', () => {
        it('preserves filter: url(#fragment) (no scheme)', () => {
            const out = sanitize(
                '<svg><defs><filter id="shadow"><feGaussianBlur stdDeviation="2"/></filter></defs>' +
                    '<rect filter="url(#shadow)" width="10" height="10"/></svg>'
            );
            expect(out).toContain('url(#shadow)');
        });

        it('preserves mask: url(data:image/png;base64,...)', () => {
            const png =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z3I3rUAAAAASUVORK5CYII=';
            const out = sanitize(
                `<svg><rect mask="url(${png})" width="10" height="10"/></svg>`
            );
            expect(out).toContain('data:image/png');
        });

        it('preserves filter: url(data:image/svg+xml;utf8,<safe-svg/>)', () => {
            const out = sanitize(
                "<svg><rect filter=\"url(data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>)\" width='10' height='10'/></svg>"
            );
            expect(out).toContain('data:image/svg+xml');
        });

        it('drops filter: url(https://attacker.example) — non-data scheme', () => {
            const out = sanitize(
                '<svg><rect filter="url(https://attacker.example/evil.svg)" width="10" height="10"/></svg>'
            );
            expect(out).not.toContain('attacker.example');
        });

        it('drops filter: url(data:image/svg+xml;utf8,<svg with embedded <script>)', () => {
            const out = sanitize(
                "<svg><rect filter=\"url(data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>)\" width='10' height='10'/></svg>"
            );
            expect(out).not.toContain('alert');
            expect(out).not.toContain('script');
        });

        it('drops filter: url(data:image/svg+xml;utf8,<svg with <foreignObject>)', () => {
            const out = sanitize(
                "<svg><rect filter=\"url(data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><foreignObject><iframe src='https://attacker.example'/></foreignObject></svg>)\" width='10' height='10'/></svg>"
            );
            expect(out).not.toContain('foreignObject');
            expect(out).not.toContain('attacker.example');
        });

        it('drops mask: url(data:image/svg+xml;utf8,<svg with onload=>)', () => {
            const out = sanitize(
                "<svg><rect mask=\"url(data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>)\" width='10' height='10'/></svg>"
            );
            expect(out).not.toContain('onload');
            expect(out).not.toContain('alert');
        });

        it('drops clip-path: url(data:image/svg+xml;utf8,<svg with external inner href>)', () => {
            const out = sanitize(
                "<svg><rect clip-path=\"url(data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><image xlink:href='https://attacker.example/track.png'/></svg>)\" width='10' height='10'/></svg>"
            );
            expect(out).not.toContain('attacker.example');
        });

        it('drops mask: url(data:text/html,...) — disallowed MIME', () => {
            const out = sanitize(
                '<svg><rect mask="url(data:text/html,<script>alert(1)</script>)" width="10" height="10"/></svg>'
            );
            expect(out).not.toContain('data:text/html');
            expect(out).not.toContain('script');
        });

        it('drops filter: url(data:image/png,...) without base64 (smuggled non-binary)', () => {
            const out = sanitize(
                '<svg><rect filter="url(data:image/png,<svg/onload=alert(1)>)" width="10" height="10"/></svg>'
            );
            expect(out).not.toContain('data:image/png');
            expect(out).not.toContain('alert');
        });

        it('drops base64-encoded svg+xml carrying <script> in funciri', () => {
            // base64 of "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
            const b64 =
                'PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';
            const out = sanitize(
                `<svg><rect filter="url(data:image/svg+xml;base64,${b64})" width="10" height="10"/></svg>`
            );
            expect(out).not.toContain('PHN2Zy');
            expect(out).not.toContain('script');
        });

        // Multi-url() smuggling (security review). SMIL animation
        // values and a few CSS-shaped SVG attributes can carry
        // multiple url() tokens — the funciri gate must validate
        // EVERY token, not just the first. Otherwise a smuggled
        // external url() in any non-first position slips through
        // the previous single-match check.
        it('drops SMIL <animate values="url(safe);url(evil)"> — second url is external https', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10" fill="red">' +
                    '<animate attributeName="fill" ' +
                    'values="url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z3I3rUAAAAASUVORK5CYII=);url(https://attacker.example/track)" ' +
                    'dur="1s"/>' +
                    '</rect></svg>'
            );
            expect(out).not.toContain('attacker.example');
        });

        it('drops SMIL <animate values="url(safe);url(javascript:...)">', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10" fill="red">' +
                    '<animate attributeName="fill" ' +
                    'values="url(#g1);url(javascript:alert(1))" ' +
                    'dur="1s"/>' +
                    '</rect></svg>'
            );
            expect(out).not.toContain('javascript');
            expect(out).not.toContain('alert');
        });

        it('drops fill with two url() tokens where the second is external', () => {
            // `fill` accepts a fallback url() chain in some SVG shapes;
            // both must clear the gate.
            const out = sanitize(
                '<svg><defs><linearGradient id="g1"/></defs>' +
                    '<rect width="10" height="10" fill="url(#g1) url(https://attacker.example/paint)"/>' +
                    '</svg>'
            );
            expect(out).not.toContain('attacker.example');
        });

        it('preserves SMIL <animate values="url(#a);url(#b)"> — both fragment refs', () => {
            // Both url() tokens are fragment-only — every iteration
            // hits the no-scheme branch and continues.
            const out = sanitize(
                '<svg><defs><linearGradient id="a"/><linearGradient id="b"/></defs>' +
                    '<rect width="10" height="10" fill="red">' +
                    '<animate attributeName="fill" values="url(#a);url(#b)" dur="1s"/>' +
                    '</rect></svg>'
            );
            expect(out).toContain('url(#a)');
            expect(out).toContain('url(#b)');
        });

        it('preserves fill with two safe data:image/png url() tokens', () => {
            const png =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z3I3rUAAAAASUVORK5CYII=';
            const out = sanitize(
                `<svg><rect width="10" height="10" fill="red">` +
                    `<animate attributeName="fill" values="url(${png});url(${png})" dur="1s"/>` +
                    `</rect></svg>`
            );
            expect(out).toContain('data:image/png');
        });

        // Multi-agent code review (correctness + security cross-confirmed):
        // SMIL_ATTRIBUTE_NAME_DENYLIST is exact-match on `Set.has`, but
        // browsers (and the SMIL animator) trim and lowercase
        // `attributeName` values before resolving them. A padded value
        // like `attributeName=" href "` would otherwise survive the gate
        // while still binding the animation to `href` at runtime.
        it('drops attributeName=" href " (whitespace-padded denylist bypass)', () => {
            const out = sanitize(
                '<svg><a href="https://safe.example/x">' +
                    '<animate attributeName=" href " to="javascript:alert(1)" dur="1s"/>' +
                    'click</a></svg>'
            );
            expect(out).not.toContain('attributeName=" href "');
            expect(out).not.toContain('javascript:');
        });

        // NFKC + control-strip extended to SMIL value attrs and funciri
        // presentation values (security + adversarial review). Without
        // this, fullwidth-Unicode and control-char obfuscation would
        // bypass the scriptingPatterns substring scan on `to`/`from`/
        // `values`/`by` (SMIL) and `cursor`/`fill`/`stroke`/etc. (SVG
        // funciri presentation attrs).
        it('drops <animate to="java\\x00script:..."> (control-char obfuscation in SMIL value)', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10" fill="red">' +
                    '<animate attributeName="fill" to="java script:alert(1)" dur="1s"/>' +
                    '</rect></svg>'
            );
            expect(out).not.toContain('javascript:');
            expect(out).not.toContain('alert');
        });

        it('drops <rect cursor="url(\\xFFjavascript:...)"> (control-char obfuscation in funciri presentation attr)', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10" cursor="url(java script:alert(1))"/></svg>'
            );
            expect(out).not.toContain('javascript:');
            expect(out).not.toContain('alert');
        });

        it('drops attributeName="\\thref" (tab-padded denylist bypass)', () => {
            const out = sanitize(
                '<svg><rect width="10" height="10">' +
                    '<animate attributeName="\thref\t" to="javascript:alert(1)" dur="1s"/>' +
                    '</rect></svg>'
            );
            expect(out).not.toContain('attributeName=');
            expect(out).not.toContain('javascript:');
        });

        it('drops three-url chain when the third token is external', () => {
            const png =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z3I3rUAAAAASUVORK5CYII=';
            const out = sanitize(
                `<svg><rect width="10" height="10" fill="red">` +
                    `<animate attributeName="fill" ` +
                    `values="url(#frag);url(${png});url(https://attacker.example/last)" ` +
                    `dur="1s"/>` +
                    `</rect></svg>`
            );
            expect(out).not.toContain('attacker.example');
        });
    });
});
