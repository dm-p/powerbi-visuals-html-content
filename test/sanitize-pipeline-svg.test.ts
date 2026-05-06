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
});
