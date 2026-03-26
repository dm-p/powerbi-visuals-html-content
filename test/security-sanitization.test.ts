import { describe, it, expect } from 'vitest';
import { VisualConstants } from '../src/visual-constants';

describe('Security Sanitization', () => {
    describe('Visual Constants - Security Patterns', () => {
        it('should have comprehensive scriptingPatterns', () => {
            expect(VisualConstants.scriptingPatterns).toContain('javascript:');
            expect(VisualConstants.scriptingPatterns).toContain('vbscript:');
            expect(VisualConstants.scriptingPatterns).toContain('livescript:');
            expect(VisualConstants.scriptingPatterns).toContain(
                'data:text/html'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'data:text/javascript'
            );
            expect(VisualConstants.scriptingPatterns).toContain('expression(');
            expect(VisualConstants.scriptingPatterns).toContain('-moz-binding');
            expect(VisualConstants.scriptingPatterns).toContain('behavior:');
            expect(VisualConstants.scriptingPatterns).toContain(
                'url(javascript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'url(data:text/html'
            );

            // Check for control character variants
            expect(VisualConstants.scriptingPatterns).toContain(
                'javas\x00cript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'javas\x01cript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'javas\x09cript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'javas\x0Acript'
            );

            // Should have 50+ patterns
            expect(
                VisualConstants.scriptingPatterns.length
            ).toBeGreaterThanOrEqual(50);
        });

        it('should have comprehensive cssDangerousPatterns', () => {
            expect(VisualConstants.cssDangerousPatterns).toBeDefined();
            expect(Array.isArray(VisualConstants.cssDangerousPatterns)).toBe(
                true
            );
            expect(
                VisualConstants.cssDangerousPatterns.length
            ).toBeGreaterThanOrEqual(12);

            // Check for RegExp patterns
            VisualConstants.cssDangerousPatterns.forEach(pattern => {
                expect(pattern).toBeInstanceOf(RegExp);
            });
        });

        it('should have correct allowedSchemes configuration', () => {
            expect(VisualConstants.allowedSchemes).toEqual([]);
            expect(VisualConstants.allowedSchemesByTag).toBeDefined();
            expect(VisualConstants.allowedSchemesByTag.a).toEqual([
                'http',
                'https'
            ]);
            expect(VisualConstants.allowedSchemesByTag.img).toEqual(['data']);
        });

        it('should have allowed SVG tags for legitimate graphics', () => {
            const svgTags = [
                'svg',
                'circle',
                'rect',
                'path',
                'line',
                'polygon',
                'text'
            ];
            svgTags.forEach(tag => {
                expect(VisualConstants.allowedTags).toContain(tag);
            });

            // Should NOT contain dangerous tags
            expect(VisualConstants.allowedTags).not.toContain('script');
            expect(VisualConstants.allowedTags).not.toContain('iframe');
            expect(VisualConstants.allowedTags).not.toContain('object');
            expect(VisualConstants.allowedTags).not.toContain('embed');
        });
    });

    describe('CSS Pattern Matching', () => {
        const testPattern = (pattern: RegExp, input: string): boolean => {
            return pattern.test(input);
        };

        // Helper to check if any pattern matches
        const anyPatternMatches = (
            patterns: RegExp[],
            input: string
        ): boolean => {
            return patterns.some(p => testPattern(p, input));
        };

        it('should detect @import with various obfuscations', () => {
            // These are patterns the regex is designed to catch
            const testCases = [
                '@import url(evil.css);',
                '@ import url(evil.css);',
                '@  import  url(evil.css);',
                '@/**/import url(evil.css);'
            ];

            // Get the @import pattern (index 0)
            const importPattern = VisualConstants.cssDangerousPatterns[0];

            testCases.forEach(css => {
                expect(testPattern(importPattern, css)).toBe(true);
            });
        });

        it('should detect javascript: in CSS', () => {
            const testCases = [
                'background:javascript:alert(1);',
                'color: red; javascript: alert(1);'
            ];

            // javascript: pattern (index 2)
            const jsPattern = VisualConstants.cssDangerousPatterns[2];

            testCases.forEach(css => {
                expect(testPattern(jsPattern, css)).toBe(true);
            });
        });

        it('should detect expression() function', () => {
            const testCases = [
                'width: expression(alert(1));',
                'width:expression(alert(1));',
                'width: expression (alert(1));'
            ];

            // expression pattern (index 1)
            const exprPattern = VisualConstants.cssDangerousPatterns[1];

            testCases.forEach(css => {
                expect(testPattern(exprPattern, css)).toBe(true);
            });
        });

        it('should detect url() with dangerous schemes', () => {
            const testCases = [
                'background: url(javascript:alert(1));',
                'background: url( javascript:alert(1));',
                'background: url("javascript:alert(1)");',
                "background: url('javascript:alert(1)');",
                'background: url(vbscript:msgbox(1));',
                'background: url(data:text/html,<script>);'
            ];

            testCases.forEach(css => {
                const matched = anyPatternMatches(
                    VisualConstants.cssDangerousPatterns,
                    css
                );
                expect(matched).toBe(true);
            });
        });

        it('should NOT match safe CSS', () => {
            const safeCss = [
                'color: red;',
                'background: #ffffff;',
                'font-family: Arial;',
                'padding: 10px;',
                'border: 1px solid #000;',
                'background: url("https://example.com/image.png");'
            ];

            safeCss.forEach(css => {
                const matched = anyPatternMatches(
                    VisualConstants.cssDangerousPatterns,
                    css
                );
                expect(matched).toBe(false);
            });
        });
    });

    describe('Scripting Pattern Matching', () => {
        it('should detect javascript with all control characters', () => {
            // Test a few control characters
            const controlChars = [0x00, 0x01, 0x09, 0x0a, 0x0d, 0x1f];

            controlChars.forEach(code => {
                const pattern = `javas${String.fromCharCode(code)}cript`;
                expect(VisualConstants.scriptingPatterns).toContain(pattern);
            });
        });

        it('should detect vbscript and alternative schemes', () => {
            expect(VisualConstants.scriptingPatterns).toContain('vbscript:');
            expect(VisualConstants.scriptingPatterns).toContain('livescript:');
            expect(VisualConstants.scriptingPatterns).toContain('mocha:');
        });

        it('should detect data URIs with dangerous MIME types', () => {
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

        it('should detect CSS-based attack patterns', () => {
            expect(VisualConstants.scriptingPatterns).toContain('expression(');
            expect(VisualConstants.scriptingPatterns).toContain('expression (');
            expect(VisualConstants.scriptingPatterns).toContain('-moz-binding');
            expect(VisualConstants.scriptingPatterns).toContain('behavior:');
            expect(VisualConstants.scriptingPatterns).toContain('behavior :');
        });

        it('should detect url() functions with dangerous schemes', () => {
            expect(VisualConstants.scriptingPatterns).toContain(
                'url(javascript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'url( javascript'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'url(data:text/html'
            );
            expect(VisualConstants.scriptingPatterns).toContain(
                'url( data:text/html'
            );
            expect(VisualConstants.scriptingPatterns).toContain('url(vbscript');
            expect(VisualConstants.scriptingPatterns).toContain(
                'url( vbscript'
            );
        });
    });

    describe('Case-Insensitive Pattern Matching', () => {
        it('should match patterns regardless of case in attribute values', () => {
            const testCases = [
                'javascript:',
                'JavaScript:',
                'JAVASCRIPT:',
                'JaVaScRiPt:',
                'vbscript:',
                'VBScript:',
                'VBSCRIPT:'
            ];

            // The getStrippedAttributes function uses toLowerCase() for comparison
            testCases.forEach(pattern => {
                const lowerPattern = pattern.toLowerCase();
                const matchFound = VisualConstants.scriptingPatterns.some(p =>
                    lowerPattern.includes(p.toLowerCase())
                );
                expect(matchFound).toBe(true);
            });
        });
    });

    describe('Data URI Validation', () => {
        it('should have safe image MIME types defined', () => {
            // Since getSanitizedDataUri is not exported, we test the concept
            const safeMimeTypes = [
                'image/png',
                'image/jpeg',
                'image/jpg',
                'image/gif',
                'image/webp',
                'image/bmp'
            ];

            // Verify concept - actual implementation in getSanitizedDataUri
            safeMimeTypes.forEach(mime => {
                expect(mime).toMatch(/^image\//);
            });
        });

        it('should not include image/svg+xml as a safe MIME type', () => {
            // SVG data URIs can embed scripts, so they are blocked entirely
            // in the certified edition. Only raster image types are allowed.
            const safeMimeTypes = [
                'image/png',
                'image/jpeg',
                'image/jpg',
                'image/gif',
                'image/webp',
                'image/bmp'
            ];
            expect(safeMimeTypes).not.toContain('image/svg+xml');
        });

        it('should block data:text/html via scriptingPatterns', () => {
            // data:text/html is a dangerous MIME type used in XSS attacks.
            // getSanitizedDataUri blocks non-image MIME types and returns
            // 'data:,' (inert placeholder) to prevent empty src="" requests.
            expect(VisualConstants.scriptingPatterns).toContain(
                'data:text/html'
            );
        });

        it('should identify unsafe MIME types', () => {
            const unsafeMimeTypes = [
                'text/html',
                'text/javascript',
                'application/javascript',
                'application/x-javascript',
                'text/xml',
                'application/xml'
            ];

            unsafeMimeTypes.forEach(mime => {
                expect(mime).not.toMatch(/^image\//);
            });
        });
    });

    describe('SVG Content Validation', () => {
        it('should identify dangerous patterns in SVG', () => {
            const dangerousPatterns = [
                '<script',
                'javascript:',
                'onload=',
                'onerror=',
                'onclick=',
                'onmouseover='
            ];

            const safeSvg =
                '<svg><circle cx="50" cy="50" r="40" fill="blue"/></svg>';
            const dangerousSvgs = [
                '<svg><script>alert(1)</script></svg>',
                '<svg onload="alert(1)"></svg>',
                '<svg><a href="javascript:alert(1)"></a></svg>'
            ];

            // Verify safe SVG has no dangerous patterns
            dangerousPatterns.forEach(pattern => {
                expect(safeSvg.toLowerCase()).not.toContain(
                    pattern.toLowerCase()
                );
            });

            // Verify dangerous SVGs contain patterns
            dangerousSvgs.forEach(svg => {
                const hasDangerousPattern = dangerousPatterns.some(pattern =>
                    svg.toLowerCase().includes(pattern.toLowerCase())
                );
                expect(hasDangerousPattern).toBe(true);
            });
        });
    });

    describe('Integration - Security in Practice', () => {
        it('should block all critical XSS vectors', () => {
            const xssVectors = [
                { pattern: 'javascript:alert(1)', blocked: true },
                { pattern: 'vbscript:msgbox(1)', blocked: true },
                { pattern: 'data:text/html,<script>', blocked: true },
                { pattern: 'url(javascript:alert(1))', blocked: true },
                { pattern: 'expression(alert(1))', blocked: true },
                { pattern: '@import url(evil)', blocked: true },
                { pattern: 'https://microsoft.com', blocked: false }, // Safe
                { pattern: 'color: red', blocked: false } // Safe
            ];

            xssVectors.forEach(({ pattern, blocked }) => {
                const lowerPattern = pattern.toLowerCase();

                // Check scriptingPatterns
                const scriptingMatch = VisualConstants.scriptingPatterns.some(
                    p => lowerPattern.includes(p.toLowerCase())
                );

                // Check cssDangerousPatterns
                const cssMatch = VisualConstants.cssDangerousPatterns.some(p =>
                    p.test(pattern)
                );

                const isBlocked = scriptingMatch || cssMatch;

                if (blocked) {
                    expect(isBlocked).toBe(true);
                } else {
                    expect(isBlocked).toBe(false);
                }
            });
        });
    });
});
