import { describe, it, expect } from 'vitest';
import {
    CONTINUE,
    normalizeUrlAttr,
    hyperlinkToggle,
    tagAllowlist,
    urlScheme,
    svgFunciri,
    smilAttributeName,
    dataUriAttr,
    styleAttr,
    xlinkJavascript,
    scriptingPatterns,
    AttrContext
} from '../src/sanitize/attribute-policy';

// Helper to build an AttrContext with sensible defaults.
const ctx = (overrides: Partial<AttrContext>): AttrContext => ({
    attrName: '',
    tagName: '',
    value: '',
    isSvgTag: false,
    allowHyperlinks: false,
    ...overrides
});

describe('attribute-policy gates', () => {
    describe('CONTINUE', () => {
        it('is the shared pass verdict', () => {
            expect(CONTINUE).toEqual({ action: 'continue' });
        });
    });

    describe('normalizeUrlAttr', () => {
        it('normalizes NFKC and strips control chars on url attrs (href)', () => {
            const v = normalizeUrlAttr(
                ctx({ attrName: 'href', tagName: 'a', value: 'java\x00script:alert(1)' })
            );
            expect(v).toEqual({ action: 'continue', value: 'javascript:alert(1)' });
        });
        it('normalizes fullwidth on SMIL value attrs (to)', () => {
            const v = normalizeUrlAttr(
                ctx({
                    attrName: 'to',
                    tagName: 'animate',
                    value: 'ｊａｖａｓｃｒｉｐｔ:x'
                })
            );
            expect(v).toEqual({ action: 'continue', value: 'javascript:x' });
        });
        it('normalizes SVG funciri presentation attrs (fill)', () => {
            const v = normalizeUrlAttr(
                ctx({ attrName: 'fill', tagName: 'rect', value: 'url(\x01#a)', isSvgTag: true })
            );
            expect(v).toEqual({ action: 'continue', value: 'url(#a)' });
        });
        it('is a no-op for non-url, non-smil, non-funciri attrs', () => {
            expect(normalizeUrlAttr(ctx({ attrName: 'class', value: 'x' }))).toBe(CONTINUE);
        });
        it('does not treat to/from as SMIL values on non-SMIL tags', () => {
            expect(normalizeUrlAttr(ctx({ attrName: 'to', tagName: 'div', value: 'x' }))).toBe(
                CONTINUE
            );
        });
    });

    describe('hyperlinkToggle', () => {
        it('drops href on <a> when hyperlinks disabled', () => {
            expect(
                hyperlinkToggle(
                    ctx({ attrName: 'href', tagName: 'a', value: 'https://x', allowHyperlinks: false })
                )
            ).toEqual({ action: 'drop', rule: 'hyperlinks-disabled' });
        });
        it('drops xlink:href on <a> when hyperlinks disabled', () => {
            expect(
                hyperlinkToggle(
                    ctx({ attrName: 'xlink:href', tagName: 'a', value: '#x', allowHyperlinks: false })
                )
            ).toEqual({ action: 'drop', rule: 'hyperlinks-disabled' });
        });
        it('is a no-op when hyperlinks enabled', () => {
            expect(
                hyperlinkToggle(
                    ctx({ attrName: 'href', tagName: 'a', value: 'https://x', allowHyperlinks: true })
                ).action
            ).toBe('continue');
        });
        it('is a no-op for href on non-<a> tags', () => {
            expect(
                hyperlinkToggle(
                    ctx({ attrName: 'href', tagName: 'img', value: 'x', allowHyperlinks: false })
                ).action
            ).toBe('continue');
        });
    });

    describe('tagAllowlist', () => {
        it('keeps an allowed global attr on an HTML tag', () => {
            expect(tagAllowlist(ctx({ attrName: 'class', tagName: 'div' })).action).toBe('continue');
        });
        it('keeps a tag-specific attr (href on a)', () => {
            expect(tagAllowlist(ctx({ attrName: 'href', tagName: 'a' })).action).toBe('continue');
        });
        it('keeps wildcard data-* / aria-*', () => {
            expect(tagAllowlist(ctx({ attrName: 'data-x', tagName: 'div' })).action).toBe('continue');
            expect(tagAllowlist(ctx({ attrName: 'aria-label', tagName: 'div' })).action).toBe(
                'continue'
            );
        });
        it('drops a disallowed attr on an HTML tag', () => {
            expect(tagAllowlist(ctx({ attrName: 'onclick', tagName: 'div' }))).toEqual({
                action: 'drop',
                rule: 'attr-not-allowed'
            });
        });
        it('drops on* and denylisted attrs on SVG tags', () => {
            expect(
                tagAllowlist(ctx({ attrName: 'onload', tagName: 'rect', isSvgTag: true }))
            ).toEqual({ action: 'drop', rule: 'svg-attr-denied' });
            expect(
                tagAllowlist(ctx({ attrName: 'srcset', tagName: 'image', isSvgTag: true }))
            ).toEqual({ action: 'drop', rule: 'svg-attr-denied' });
        });
        it('keeps a presentation attr on an SVG tag', () => {
            expect(
                tagAllowlist(ctx({ attrName: 'fill', tagName: 'rect', isSvgTag: true })).action
            ).toBe('continue');
        });
    });

    describe('urlScheme', () => {
        it('drops a disallowed scheme on a scheme-restricted tag', () => {
            expect(
                urlScheme(ctx({ attrName: 'src', tagName: 'img', value: 'http://evil/x' }))
            ).toEqual({ action: 'drop', rule: 'disallowed-url-scheme' });
        });
        it('keeps an allowed scheme (data: on img)', () => {
            expect(
                urlScheme(ctx({ attrName: 'src', tagName: 'img', value: 'data:image/png;base64,AAA' }))
                    .action
            ).toBe('continue');
        });
        it('default-denies SVG tag with no scheme entry', () => {
            expect(
                urlScheme(
                    ctx({
                        attrName: 'xlink:href',
                        tagName: 'rect',
                        value: 'http://x',
                        isSvgTag: true
                    })
                )
            ).toEqual({ action: 'drop', rule: 'svg-url-scheme-default-deny' });
        });
        it('is a no-op for non-url attr names', () => {
            expect(urlScheme(ctx({ attrName: 'class', tagName: 'img', value: 'x' })).action).toBe(
                'continue'
            );
        });
    });

    describe('svgFunciri', () => {
        it('drops a non-data url() scheme in an SVG presentation attr', () => {
            expect(
                svgFunciri(
                    ctx({
                        attrName: 'fill',
                        tagName: 'rect',
                        value: 'url(https://evil/x)',
                        isSvgTag: true
                    })
                )
            ).toEqual({ action: 'drop', rule: 'svg-funciri-scheme' });
        });
        it('allows a fragment-only url()', () => {
            expect(
                svgFunciri(
                    ctx({ attrName: 'fill', tagName: 'rect', value: 'url(#a)', isSvgTag: true })
                ).action
            ).toBe('continue');
        });
        it('drops an unsafe data: url() in funciri', () => {
            expect(
                svgFunciri(
                    ctx({
                        attrName: 'fill',
                        tagName: 'rect',
                        value: 'url(data:text/html,<script>)',
                        isSvgTag: true
                    })
                )
            ).toEqual({ action: 'drop', rule: 'svg-funciri-unsafe-data' });
        });
        it('skips style attr and non-svg tags', () => {
            expect(
                svgFunciri(
                    ctx({ attrName: 'style', tagName: 'rect', value: 'url(http://x)', isSvgTag: true })
                ).action
            ).toBe('continue');
            expect(
                svgFunciri(ctx({ attrName: 'fill', tagName: 'div', value: 'url(http://x)' })).action
            ).toBe('continue');
        });
    });

    describe('smilAttributeName', () => {
        it('drops attributeName naming a denylisted target', () => {
            expect(
                smilAttributeName(
                    ctx({ attrName: 'attributename', tagName: 'animate', value: ' href ' })
                )
            ).toEqual({ action: 'drop', rule: 'smil-attributename' });
        });
        it('keeps attributeName naming a safe property', () => {
            expect(
                smilAttributeName(
                    ctx({ attrName: 'attributename', tagName: 'animate', value: 'opacity' })
                ).action
            ).toBe('continue');
        });
    });

    describe('dataUriAttr', () => {
        it('drops a data: uri that sanitizes to empty', () => {
            expect(
                dataUriAttr(ctx({ attrName: 'src', tagName: 'img', value: 'data:text/html,x' }))
            ).toEqual({ action: 'drop', rule: 'data-uri' });
        });
        it('keeps a sanitized safe data: image', () => {
            const v = dataUriAttr(
                ctx({
                    attrName: 'src',
                    tagName: 'img',
                    value: 'data:image/png;base64,iVBORw0KGgo='
                })
            );
            expect(v).toEqual({ action: 'keep', value: 'data:image/png;base64,iVBORw0KGgo=' });
        });
        it('is a no-op for non-data values', () => {
            expect(
                dataUriAttr(ctx({ attrName: 'src', tagName: 'img', value: 'https://x' })).action
            ).toBe('continue');
        });
    });

    describe('styleAttr', () => {
        it('drops style that sanitizes to empty', () => {
            expect(
                styleAttr(ctx({ attrName: 'style', tagName: 'div', value: 'behavior:url(x)' }))
            ).toEqual({ action: 'drop', rule: 'inline-style' });
        });
        it('keeps and normalizes a safe style', () => {
            const v = styleAttr(ctx({ attrName: 'style', tagName: 'div', value: 'color: red' }));
            expect(v).toEqual({ action: 'keep', value: 'color:red' });
        });
        it('is a no-op for non-style attrs', () => {
            expect(styleAttr(ctx({ attrName: 'class', value: 'x' })).action).toBe('continue');
        });
    });

    describe('xlinkJavascript', () => {
        it('drops xlink:href carrying javascript:', () => {
            expect(
                xlinkJavascript(
                    ctx({ attrName: 'xlink:href', tagName: 'a', value: 'javascript:alert(1)' })
                )
            ).toEqual({ action: 'drop', rule: 'xlink-javascript' });
        });
        it('is a no-op for safe xlink:href', () => {
            expect(
                xlinkJavascript(ctx({ attrName: 'xlink:href', tagName: 'a', value: '#x' })).action
            ).toBe('continue');
        });
    });

    describe('scriptingPatterns', () => {
        it('drops a value containing a dangerous pattern', () => {
            expect(
                scriptingPatterns(ctx({ attrName: 'to', tagName: 'animate', value: 'javascript:x' }))
            ).toEqual({ action: 'drop', rule: 'dangerous-pattern' });
        });
        it('is a no-op for a clean value', () => {
            expect(
                scriptingPatterns(ctx({ attrName: 'to', tagName: 'animate', value: 'opacity' })).action
            ).toBe('continue');
        });
    });
});
