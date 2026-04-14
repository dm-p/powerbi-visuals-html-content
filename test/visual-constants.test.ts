import { describe, it, expect } from 'vitest';
import { VisualConstants } from '../src/visual-constants';

describe('VisualConstants', () => {
    describe('visual metadata', () => {
        it('should have visual information defined', () => {
            expect(VisualConstants.visual).toBeDefined();
        });
    });

    describe('contentFormatting defaults', () => {
        it('should have default format as html', () => {
            expect(VisualConstants.contentFormatting.format).toBe('html');
        });

        it('should have showRawHtml as false by default', () => {
            expect(VisualConstants.contentFormatting.showRawHtml).toBe(false);
        });

        it('should have font defaults defined', () => {
            expect(VisualConstants.contentFormatting.font).toBeDefined();
            expect(VisualConstants.contentFormatting.font.family).toContain(
                'Segoe UI'
            );
            expect(VisualConstants.contentFormatting.font.colour).toBe(
                '#000000'
            );
            expect(VisualConstants.contentFormatting.font.size).toBe(11);
        });

        it('should have alignment default as left', () => {
            expect(VisualConstants.contentFormatting.align).toBe('left');
        });

        it('should have hyperlinks disabled by default', () => {
            expect(VisualConstants.contentFormatting.hyperlinks).toBe(false);
        });

        it('should have userSelect disabled by default', () => {
            expect(VisualConstants.contentFormatting.userSelect).toBe(false);
        });

        it('should have a default no data message', () => {
            expect(VisualConstants.contentFormatting.noDataMessage).toBe(
                'No data available to display'
            );
        });
    });

    describe('cross filter defaults', () => {
        it('should have cross filtering disabled by default', () => {
            expect(VisualConstants.crossFilter.enabled).toBe(false);
        });

        it('should use transparency by default', () => {
            expect(VisualConstants.crossFilter.useTransparency).toBe(true);
        });

        it('should have 70% transparency percent by default', () => {
            expect(VisualConstants.crossFilter.transparencyPercent).toBe(70);
        });
    });

    describe('DOM selectors', () => {
        it('should have all required DOM selectors defined', () => {
            expect(VisualConstants.dom.viewerIdSelector).toBe('htmlViewer');
            expect(VisualConstants.dom.entryClassSelector).toBe(
                'htmlViewerEntry'
            );
            expect(VisualConstants.dom.statusIdSelector).toBe('statusMessage');
            expect(VisualConstants.dom.contentIdSelector).toBe('htmlContent');
            expect(VisualConstants.dom.landingIdSelector).toBe('landingPage');
            expect(VisualConstants.dom.stylesheetIdSelector).toBe(
                'visualUserStylesheet'
            );
            expect(VisualConstants.dom.rawOutputIdSelector).toBe(
                'rawHtmlOutput'
            );
            expect(VisualConstants.dom.hoverClassSelector).toBe('hover');
            expect(VisualConstants.dom.unselectedClassSelector).toBe(
                'unselected'
            );
        });

        it('should have tooltip-related selectors defined', () => {
            expect(VisualConstants.dom.manualTooltipSelector).toBe(
                'tooltipEnabled'
            );
            expect(VisualConstants.dom.manualTooltipDataPrefix).toBe('tooltip');
            expect(VisualConstants.dom.manualTooltipDataTitle).toBe('Title');
            expect(VisualConstants.dom.manualTooltipDataValue).toBe('Value');
        });
    });

    describe('allowedSchemes', () => {
        it('should have empty global allowedSchemes', () => {
            expect(VisualConstants.allowedSchemes).toEqual([]);
        });

        it('should allow http and https for anchor tags', () => {
            expect(VisualConstants.allowedSchemesByTag.a).toEqual([
                'http',
                'https'
            ]);
        });

        it('should only allow data URIs for images', () => {
            expect(VisualConstants.allowedSchemesByTag.img).toEqual(['data']);
        });
    });

    describe('allowedTags', () => {
        it('should include standard HTML tags', () => {
            const standardTags = [
                'p',
                'div',
                'span',
                'a',
                'img',
                'table',
                'tr',
                'td',
                'th'
            ];
            standardTags.forEach(tag => {
                expect(VisualConstants.allowedTags).toContain(tag);
            });
        });

        it('should include SVG tags', () => {
            const svgTags = [
                'svg',
                'circle',
                'rect',
                'path',
                'line',
                'polygon',
                'polyline',
                'ellipse',
                'text',
                'g'
            ];
            svgTags.forEach(tag => {
                expect(VisualConstants.allowedTags).toContain(tag);
            });
        });

        it('should NOT include SVG animation tags (SMIL can override sanitized attributes)', () => {
            const animTags = ['animate', 'animatemotion', 'animatetransform', 'set'];
            animTags.forEach(tag => {
                expect(VisualConstants.allowedTags).not.toContain(tag);
            });
        });

        it('should include SVG filter tags', () => {
            const filterTags = [
                'filter',
                'feblend',
                'fegaussianblur',
                'fecolormatrix',
                'feoffset'
            ];
            filterTags.forEach(tag => {
                expect(VisualConstants.allowedTags).toContain(tag);
            });
        });

        it('should include gradient tags', () => {
            expect(VisualConstants.allowedTags).toContain('lineargradient');
            expect(VisualConstants.allowedTags).toContain('radialgradient');
            expect(VisualConstants.allowedTags).toContain('stop');
        });

        it('should NOT include dangerous tags', () => {
            const dangerousTags = [
                'script',
                'iframe',
                'object',
                'embed',
                'form',
                'input',
                'button'
            ];
            dangerousTags.forEach(tag => {
                expect(VisualConstants.allowedTags).not.toContain(tag);
            });
        });
    });

    describe('scriptingPatterns', () => {
        it('should include javascript and variants', () => {
            expect(VisualConstants.scriptingPatterns).toContain('javascript:');
            expect(VisualConstants.scriptingPatterns).toContain('vbscript:');
            expect(VisualConstants.scriptingPatterns).toContain('livescript:');
            expect(VisualConstants.scriptingPatterns).toContain('mocha:');
        });

        it('should include data URI patterns', () => {
            expect(VisualConstants.scriptingPatterns).toContain(
                'data:text/html'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'data:text/javascript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'data:application/javascript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'data:application/x-javascript'
            );
        });

        it('should include CSS-based attack patterns', () => {
            expect(VisualConstants.scriptingPatterns).toContain('expression(');
            expect(VisualConstants.scriptingPatterns).toContain('-moz-binding');
            expect(VisualConstants.scriptingPatterns).toContain('behavior:');
        });

        it('should include URL function patterns', () => {
            expect(VisualConstants.scriptingPatterns).toContain(
                'url(javascript'
            );
            expect(VisualConstants.scriptingPatterns).toContain('url(vbscript');
            expect(VisualConstants.scriptingPatterns).toContain(
                'url(data:text/html'
            );
        });

        it('should have control character obfuscation patterns', () => {
            // Check a few control character variants
            expect(VisualConstants.scriptingPatterns).toContain(
                'javas\x00cript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'javas\x09cript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'javas\x0Acript'
            );
        });
    });

    describe('cssDangerousPatterns', () => {
        it('should have regex patterns defined', () => {
            expect(VisualConstants.cssDangerousPatterns).toBeDefined();
            expect(Array.isArray(VisualConstants.cssDangerousPatterns)).toBe(
                true
            );
            expect(VisualConstants.cssDangerousPatterns.length).toBeGreaterThan(
                0
            );
        });

        it('should have all patterns as RegExp instances', () => {
            VisualConstants.cssDangerousPatterns.forEach(pattern => {
                expect(pattern).toBeInstanceOf(RegExp);
            });
        });

        it('should have case-insensitive patterns', () => {
            VisualConstants.cssDangerousPatterns.forEach(pattern => {
                expect(pattern.flags).toContain('i');
            });
        });
    });
});
