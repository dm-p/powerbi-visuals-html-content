import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { select } from 'd3-selection';

import { resolveStyling } from '../src/domain-utils';
import { getSanitizedHtmlForTesting } from '../src/sanitize-pipeline';
import { VisualConstants } from '../src/visual-constants';
import { LOREM_PAYLOADS } from './fixtures/lorem';

/**
 * Issue #144 — Default body styling consistency.
 *
 * The visual's apply layer (`resolveStyling` in src/domain-utils.ts +
 * the matching rule in style/visual.less) must win the CSS cascade
 * against inline `style` declarations carried in the bound content
 * (the office-paste residue traced by ShelbiDanielle's follow-up
 * comment on issue #144). This file asserts the JS contract:
 *
 *   - Default-body mode toggles `.uses-default-body-styling` ON the
 *     body container so the matching stylesheet rule fires.
 *   - Custom-stylesheet mode toggles the class OFF so the user's own
 *     rules take over and the override does not interfere.
 *   - The existing inline-style apply behavior on the body container
 *     (font-family / font-size / color / text-align) is preserved.
 *   - The office-paste lorem fixtures sanitize to output that still
 *     carries inline styles — proving the cascade-override surface is
 *     real and the fix targets the correct case.
 *
 * The cascade-resolution itself (descendants inherit the body styling
 * via the !important rule in visual.less) is not asserted here. JSDOM's
 * CSS engine does not implement enough of the cascade for a faithful
 * `getComputedStyle` check; that verification stays manual via the U1
 * UAT page, which the user has indicated they will exercise.
 */

const CLASS = VisualConstants.dom.defaultBodyStylingClass;

function buildSettings(opts: {
    fontFamily?: string;
    fontSize?: number;
    fontColour?: string;
    align?: string;
    customStylesheet?: string;
}): any {
    return {
        contentFormatting: {
            contentFormattingCardBehavior: {
                userSelect: { value: false }
            },
            contentFormattingCardDefaultBodyStyling: {
                fontFamily: { value: opts.fontFamily ?? 'Arial' },
                fontSize: { value: opts.fontSize ?? 14 },
                fontColour: { value: { value: opts.fontColour ?? '#ff0000' } },
                align: { value: opts.align ?? 'left' }
            }
        },
        stylesheet: {
            stylesheetCardMain: {
                stylesheet: { value: opts.customStylesheet ?? '' }
            }
        },
        crossFilter: {
            crossFilterCardMain: {
                enabled: { value: false },
                useTransparency: { value: false },
                transparencyPercent: { value: 0 }
            }
        }
    };
}

function makeRoots() {
    const dom = new JSDOM(
        '<!doctype html><html><head><style id="ss"></style></head><body><div id="htmlViewer"></div></body></html>'
    );
    const styleSheetContainer = select(
        dom.window.document.getElementById('ss')! as any
    );
    const bodyContainer = select(
        dom.window.document.getElementById('htmlViewer')! as any
    );
    return { dom, styleSheetContainer, bodyContainer };
}

describe('issue #144 — default body styling apply layer', () => {
    describe('resolveStyling class toggle', () => {
        it('adds the override class when no custom stylesheet is supplied', () => {
            const { styleSheetContainer, bodyContainer } = makeRoots();
            resolveStyling(
                styleSheetContainer as any,
                bodyContainer as any,
                buildSettings({}) as any
            );
            expect(bodyContainer.node()!.classList.contains(CLASS)).toBe(true);
        });

        it('omits the override class when a custom stylesheet IS supplied', () => {
            const { styleSheetContainer, bodyContainer } = makeRoots();
            resolveStyling(
                styleSheetContainer as any,
                bodyContainer as any,
                buildSettings({ customStylesheet: 'body { color: blue; }' }) as any
            );
            expect(bodyContainer.node()!.classList.contains(CLASS)).toBe(false);
        });

        it('removes the class on a subsequent update that switches into custom-stylesheet mode', () => {
            const { styleSheetContainer, bodyContainer } = makeRoots();
            resolveStyling(
                styleSheetContainer as any,
                bodyContainer as any,
                buildSettings({}) as any
            );
            expect(bodyContainer.node()!.classList.contains(CLASS)).toBe(true);
            resolveStyling(
                styleSheetContainer as any,
                bodyContainer as any,
                buildSettings({ customStylesheet: 'p { color: green; }' }) as any
            );
            expect(bodyContainer.node()!.classList.contains(CLASS)).toBe(false);
        });
    });

    describe('resolveStyling existing inline-style contract (regression guard)', () => {
        it('writes font-family / font-size / color / text-align inline styles in default-body mode', () => {
            const { styleSheetContainer, bodyContainer } = makeRoots();
            resolveStyling(
                styleSheetContainer as any,
                bodyContainer as any,
                buildSettings({
                    fontFamily: 'Times New Roman',
                    fontSize: 18,
                    fontColour: '#abcdef',
                    align: 'center'
                }) as any
            );
            const styleAttr =
                bodyContainer.node()!.getAttribute('style') ?? '';
            // jsdom may wrap multi-word font-family values in quotes.
            expect(styleAttr).toMatch(/font-family:\s*["']?Times New Roman["']?/);
            expect(styleAttr).toContain('font-size: 18pt');
            // jsdom normalises hex colors to rgb(); accept either shape.
            expect(styleAttr).toMatch(/color:\s*(#abcdef|rgb\(171,\s*205,\s*239\))/i);
            expect(styleAttr).toContain('text-align: center');
        });

        it('clears the inline body styles in custom-stylesheet mode', () => {
            const { styleSheetContainer, bodyContainer } = makeRoots();
            // Pre-seed an inline style so we can prove resolveStyling cleared
            // it (mirrors what a previous default-body update would leave).
            bodyContainer.node()!.setAttribute(
                'style',
                'font-family: X; font-size: 9pt; color: #000; text-align: right;'
            );
            resolveStyling(
                styleSheetContainer as any,
                bodyContainer as any,
                buildSettings({ customStylesheet: 'p { color: blue; }' }) as any
            );
            const styleAttr =
                bodyContainer.node()!.getAttribute('style') ?? '';
            expect(styleAttr).not.toContain('font-family');
            expect(styleAttr).not.toContain('font-size');
            expect(styleAttr).not.toContain('color:');
            expect(styleAttr).not.toContain('text-align');
        });
    });

    describe('office-paste fixtures preserve inline-style attack surface (issue #144)', () => {
        // The fix in style/visual.less assumes the sanitizer leaves inline
        // `style` declarations intact on the bound content's descendants —
        // that is what makes them addressable by `#htmlContent [style]`.
        // These assertions document that contract: if a future sanitizer
        // change strips inline styles from prose, the override mechanism
        // would silently become unnecessary AND this test would warn us.
        const officePasteIds = [
            'lorem-office-paste-paragraph',
            'lorem-office-paste-bulleted-list',
            'lorem-office-paste-mixed-content'
        ];
        const fixtures = LOREM_PAYLOADS.filter(p => officePasteIds.includes(p.id));

        it.each(fixtures.map(f => [f.id, f]))(
            '%s sanitized output retains inline style attribute',
            (_id, fixture) => {
                const out = getSanitizedHtmlForTesting(fixture.input, 'html');
                expect(out).toMatch(/style="[^"]*(color|font-family|font-size|background-color)[^"]*"/);
            }
        );

        it('all three office-paste fixtures are present in LOREM_PAYLOADS', () => {
            // Guards against accidental fixture deletion that would leave
            // the bug undocumented in the UAT corpus.
            expect(fixtures.length).toBe(3);
        });
    });
});
