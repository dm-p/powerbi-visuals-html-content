import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import less from 'less';

/**
 * 1.6 → 2.0 rendering parity — W3.CSS compat layer.
 *
 * v1.6 bundled the whole W3.CSS framework (`import 'w3-css/w3.css'` in
 * src/visual.ts, pulled in for the old landing page). Its element-level
 * rules were therefore silently part of the content rendering
 * environment for every 1.6 report. 2.0 dropped the framework, so
 * byte-identical content DOM renders differently after migration — the
 * reported symptom being image rows growing 48px → 52px (baseline
 * alignment re-adds the text strut descender below each image) and
 * overflowing previously-fitting layouts.
 *
 * style/visual.less must therefore carry the content-relevant subset of
 * W3.CSS 4.1.0's element rules, scoped under
 * `:where(#htmlContent.hc-legacy-v1)`:
 *   - `:where()` keeps every selector at bare-element specificity, so
 *     user stylesheets (injected into <head> AFTER the bundle) beat
 *     these rules exactly as they beat W3.CSS's own in 1.6;
 *   - the #htmlContent scope keeps them off the landing page,
 *     diagnostics dialog, and raw-HTML surfaces, which are deliberately
 *     restyled in 2.0;
 *   - the additional `.hc-legacy-v1` class requirement gates the rules
 *     to legacy (v1.6) rendering mode only — src/visual.ts toggles the
 *     class on #htmlContent from the compatibility classification
 *     (legacy ON ⇒ class present), so 2.0-native content never sees
 *     these rules at all.
 *
 * JSDOM can't resolve the cascade, so these tests compile the LESS and
 * assert the emitted rule shapes — the same contract style as the
 * issue #144 assertions in body-styling.test.ts.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VISUAL_LESS_PATH = path.resolve(__dirname, '..', 'style', 'visual.less');

let css: string;

beforeAll(async () => {
    const source = fs.readFileSync(VISUAL_LESS_PATH, 'utf-8');
    const output = await less.render(source, {
        filename: VISUAL_LESS_PATH
    });
    css = output.css;
});

/**
 * Return the declaration block for the first compiled rule whose selector
 * list (whitespace-normalized) matches `selector` exactly.
 */
function ruleBody(selector: string): string | null {
    // Match "selector { ... }" with the selector list possibly spanning
    // lines. Non-greedy body match is safe: compiled CSS has no nested
    // braces outside @media/@container, and none of the compat rules
    // live inside one.
    const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
    for (const [, sel, body] of rules) {
        if (sel.replace(/\s+/g, ' ').trim() === selector) {
            return body;
        }
    }
    return null;
}

describe('W3.CSS 1.6-compat layer (scoped to #htmlContent)', () => {
    it('re-applies img { vertical-align: middle } — the 48px→52px row regression', () => {
        const body = ruleBody(':where(#htmlContent.hc-legacy-v1) img');
        expect(body).not.toBeNull();
        expect(body).toMatch(/vertical-align:\s*middle/);
    });

    it('re-applies the inherited line-height of 1.5 on the content root', () => {
        const body = ruleBody(':where(#htmlContent.hc-legacy-v1)');
        expect(body).not.toBeNull();
        expect(body).toMatch(/line-height:\s*1\.5/);
        // W3.CSS applied border-box sizing to every element (html
        // { box-sizing: border-box } + * { box-sizing: inherit }).
        expect(body).toMatch(/box-sizing:\s*border-box/);
    });

    it('re-applies border-box sizing to all content descendants', () => {
        const body = ruleBody(
            ':where(#htmlContent.hc-legacy-v1) *, :where(#htmlContent.hc-legacy-v1) *::before, :where(#htmlContent.hc-legacy-v1) *::after'
        );
        expect(body).not.toBeNull();
        expect(body).toMatch(/box-sizing:\s*border-box/);
    });

    it('re-applies the W3.CSS heading treatment (weight 400, 10px margins, fixed px sizes)', () => {
        const shared = ruleBody(
            ':where(#htmlContent.hc-legacy-v1) h1, :where(#htmlContent.hc-legacy-v1) h2, :where(#htmlContent.hc-legacy-v1) h3, :where(#htmlContent.hc-legacy-v1) h4, :where(#htmlContent.hc-legacy-v1) h5, :where(#htmlContent.hc-legacy-v1) h6'
        );
        expect(shared).not.toBeNull();
        expect(shared).toMatch(/font-weight:\s*400/);
        expect(shared).toMatch(/margin:\s*10px 0/);
        expect(shared).toMatch(
            /font-family:\s*['"]Segoe UI['"],\s*Arial,\s*sans-serif/
        );
        const sizes: [string, number][] = [
            ['h1', 36],
            ['h2', 30],
            ['h3', 24],
            ['h4', 20],
            ['h5', 18],
            ['h6', 16]
        ];
        for (const [tag, px] of sizes) {
            const body = ruleBody(`:where(#htmlContent.hc-legacy-v1) ${tag}`);
            expect(body, `${tag} size rule`).not.toBeNull();
            expect(body).toMatch(new RegExp(`font-size:\\s*${px}px`));
        }
    });

    it('re-applies a { color: inherit } so hyperlinks keep the body colour as in 1.6', () => {
        const body = ruleBody(':where(#htmlContent.hc-legacy-v1) a');
        expect(body).not.toBeNull();
        expect(body).toMatch(/color:\s*inherit/);
    });

    it('re-applies the sub/sup normalization that stops them growing line boxes', () => {
        const shared = ruleBody(
            ':where(#htmlContent.hc-legacy-v1) sub, :where(#htmlContent.hc-legacy-v1) sup'
        );
        expect(shared).not.toBeNull();
        expect(shared).toMatch(/font-size:\s*75%/);
        expect(shared).toMatch(/line-height:\s*0/);
        expect(shared).toMatch(/vertical-align:\s*baseline/);
        expect(ruleBody(':where(#htmlContent.hc-legacy-v1) sub')).toMatch(
            /bottom:\s*-0\.25em/
        );
        expect(ruleBody(':where(#htmlContent.hc-legacy-v1) sup')).toMatch(
            /top:\s*-0\.5em/
        );
    });

    it('re-applies the W3.CSS hr treatment', () => {
        const body = ruleBody(':where(#htmlContent.hc-legacy-v1) hr');
        expect(body).not.toBeNull();
        expect(body).toMatch(/border:\s*0/);
        expect(body).toMatch(/border-top:\s*1px solid #eee/);
        expect(body).toMatch(/margin:\s*20px 0/);
    });

    it('re-applies monospace normalization for code, kbd, pre, samp', () => {
        const body = ruleBody(
            ':where(#htmlContent.hc-legacy-v1) code, :where(#htmlContent.hc-legacy-v1) kbd, :where(#htmlContent.hc-legacy-v1) pre, :where(#htmlContent.hc-legacy-v1) samp'
        );
        expect(body).not.toBeNull();
        expect(body).toMatch(/font-family:\s*monospace,\s*monospace/);
        expect(body).toMatch(/font-size:\s*1em/);
    });

    it('re-applies summary { display: block } (W3.CSS suppressed the disclosure marker)', () => {
        const body = ruleBody(':where(#htmlContent.hc-legacy-v1) summary');
        expect(body).not.toBeNull();
        expect(body).toMatch(/display:\s*block/);
    });

    it('does not leak bare element selectors outside the gated #htmlContent scope', () => {
        // The compat rules must never apply to the landing page or
        // diagnostics surfaces, and must not fire at all without the
        // legacy class: no compiled rule may target a bare element
        // selector, and no :where(#htmlContent ...) scope may omit the
        // .hc-legacy-v1 gate.
        const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
        const offenders: string[] = [];
        for (const [, sel] of rules) {
            for (const part of sel.split(',')) {
                const s = part.replace(/\s+/g, ' ').trim();
                if (
                    /^(img|h[1-6]|a|hr|sub|sup|code|kbd|pre|samp|summary)$/.test(
                        s
                    )
                ) {
                    offenders.push(s);
                }
                if (
                    s.includes(':where(#htmlContent') &&
                    !s.includes('.hc-legacy-v1')
                ) {
                    offenders.push(s);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
