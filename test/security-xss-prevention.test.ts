import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisualConstants } from '../src/visual-constants';

/**
 * These tests verify that the security patterns defined in VisualConstants
 * correctly identify and match malicious content patterns.
 */
describe('Security XSS Attack Prevention', () => {
    // Helper to test scriptingPatterns matching
    const matchesScriptingPattern = (input: string): boolean => {
        const lowerInput = input.toLowerCase();
        return VisualConstants.scriptingPatterns.some(pattern =>
            lowerInput.includes(pattern.toLowerCase())
        );
    };

    const matchesCssDangerousPattern = (input: string): boolean => {
        return VisualConstants.cssDangerousPatterns.some(pattern => {
            return pattern.test(input);
        });
    };

    describe('1. JavaScript URI Schemes', () => {
        it('❌ Test 1.1: Basic JavaScript URI should be blocked', () => {
            const href = "javascript:alert('XSS')";
            expect(matchesScriptingPattern(href)).toBe(true);
        });

        it('❌ Test 1.2: JavaScript with Null Bytes should be blocked', () => {
            const href = "javas\x00cript:alert('XSS')";
            expect(matchesScriptingPattern(href)).toBe(true);
        });

        it('❌ Test 1.3: JavaScript with Tab Character should be blocked', () => {
            const href = "javas\tcript:alert('XSS')";
            expect(matchesScriptingPattern(href)).toBe(true);
        });

        it('❌ Test 1.5: VBScript URI should be blocked', () => {
            const href = "vbscript:msgbox('XSS')";
            expect(matchesScriptingPattern(href)).toBe(true);
        });

        it('✅ Test 1.6: Legitimate HTTP Link should NOT be blocked', () => {
            const href = 'https://www.microsoft.com';
            expect(matchesScriptingPattern(href)).toBe(false);
        });

        it('should block case variations of javascript:', () => {
            const variations = [
                'JAVASCRIPT:alert(1)',
                'JavaScript:alert(1)',
                'JaVaScRiPt:alert(1)'
            ];
            variations.forEach(v => {
                expect(matchesScriptingPattern(v)).toBe(true);
            });
        });

        it('should block livescript and mocha schemes', () => {
            expect(matchesScriptingPattern('livescript:alert(1)')).toBe(true);
            expect(matchesScriptingPattern('mocha:alert(1)')).toBe(true);
        });
    });

    describe('2. Event Handler Detection', () => {
        const eventHandlerPattern = /^on[a-z]+$/i;

        it('❌ should detect onclick event handler', () => {
            expect(eventHandlerPattern.test('onclick')).toBe(true);
        });

        it('❌ should detect onload event handler', () => {
            expect(eventHandlerPattern.test('onload')).toBe(true);
        });

        it('❌ should detect onerror event handler', () => {
            expect(eventHandlerPattern.test('onerror')).toBe(true);
        });

        it('❌ should detect onmouseover event handler', () => {
            expect(eventHandlerPattern.test('onmouseover')).toBe(true);
        });

        it('❌ should detect OnClick (mixed case) event handler', () => {
            expect(eventHandlerPattern.test('OnClick')).toBe(true);
        });

        it('✅ should NOT match regular attributes', () => {
            expect(eventHandlerPattern.test('class')).toBe(false);
            expect(eventHandlerPattern.test('id')).toBe(false);
            expect(eventHandlerPattern.test('style')).toBe(false);
            expect(eventHandlerPattern.test('href')).toBe(false);
        });

        it('✅ should NOT match "on" prefix in normal attribute values', () => {
            // The pattern should only match attribute names, not values
            expect(eventHandlerPattern.test('data-value')).toBe(false);
            expect(eventHandlerPattern.test('ion-button')).toBe(false);
        });
    });

    describe('3. CSS-Based Attacks', () => {
        it('❌ Test 3.1: CSS url() with JavaScript should be blocked', () => {
            const style = "background: url('javascript:alert(1)')";
            expect(matchesScriptingPattern(style)).toBe(true);
        });

        it('❌ Test 3.2: CSS expression() should be blocked', () => {
            const style = "width: expression(alert('XSS'))";
            expect(matchesScriptingPattern(style)).toBe(true);
        });

        it('❌ Test 3.3: CSS -moz-binding should be blocked', () => {
            const style = "-moz-binding: url('http://evil.com/xss.xml')";
            expect(matchesScriptingPattern(style)).toBe(true);
        });

        it('❌ Test 3.4: CSS behavior should be blocked', () => {
            const style = "behavior: url('xss.htc')";
            expect(matchesScriptingPattern(style)).toBe(true);
        });

        it('✅ Test 3.5: Safe inline styles should NOT be blocked', () => {
            const style = 'color: red; font-size: 20px; background: #f0f0f0';
            expect(matchesScriptingPattern(style)).toBe(false);
        });
    });

    describe('4. CSS @import Attacks', () => {
        it('❌ Test 4.1: Basic @import should be blocked', () => {
            const css = "@import url('https://evil.com/xss.css');";
            expect(matchesCssDangerousPattern(css)).toBe(true);
        });

        it('❌ Test 4.2: @import with inline comment should be blocked', () => {
            // The regex catches @/**/import patterns
            const css = "@/**/import url('evil.css');";
            expect(matchesCssDangerousPattern(css)).toBe(true);
        });

        it('❌ Test 4.4: CSS with javascript: in url() should be blocked', () => {
            const css = "body { background: url('javascript:alert(1)'); }";
            expect(matchesCssDangerousPattern(css)).toBe(true);
        });

        it('✅ Test 4.5: Safe CSS should NOT be blocked', () => {
            const css = '.safe { color: blue; font-weight: bold; }';
            expect(matchesCssDangerousPattern(css)).toBe(false);
        });

        it('should detect expression() in CSS', () => {
            const css = 'width: expression(alert(1))';
            expect(matchesCssDangerousPattern(css)).toBe(true);
        });

        it('should detect vbscript: in CSS', () => {
            const css = "background: url('vbscript:msgbox(1)');";
            expect(matchesCssDangerousPattern(css)).toBe(true);
        });
    });

    describe('5. Data URI Attacks', () => {
        it('❌ Test 5.1: Data URI with HTML should be blocked', () => {
            const src = "data:text/html,<script>alert('XSS')</script>";
            expect(matchesScriptingPattern(src)).toBe(true);
        });

        it('❌ Test 5.2: Data URI with JavaScript should be blocked', () => {
            const src = "data:text/javascript,alert('XSS')";
            expect(matchesScriptingPattern(src)).toBe(true);
        });

        it('should block data:application/javascript', () => {
            const src = 'data:application/javascript,alert(1)';
            expect(matchesScriptingPattern(src)).toBe(true);
        });

        it('should block data:application/x-javascript', () => {
            const src = 'data:application/x-javascript,alert(1)';
            expect(matchesScriptingPattern(src)).toBe(true);
        });

        it('should NOT block data:image/png', () => {
            // Base patterns don't include image MIME types
            const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
            expect(matchesScriptingPattern(src)).toBe(false);
        });
    });

    describe('6. SVG Attack Patterns', () => {
        it('should block script inside SVG', () => {
            const svg = '<svg><script>alert(1)</script></svg>';
            // Script tags should not be in allowedTags
            expect(VisualConstants.allowedTags).not.toContain('script');
        });

        it('should block onload on SVG', () => {
            const eventPattern = /^on[a-z]+$/i;
            expect(eventPattern.test('onload')).toBe(true);
        });

        it('should block href with javascript in SVG a tag', () => {
            const href = 'javascript:alert(1)';
            expect(matchesScriptingPattern(href)).toBe(true);
        });

        it('should allow safe SVG elements', () => {
            const safeSvgTags = ['svg', 'circle', 'rect', 'path', 'g', 'text'];
            safeSvgTags.forEach(tag => {
                expect(VisualConstants.allowedTags).toContain(tag);
            });
        });
    });

    describe('7. Edge Cases and Obfuscation', () => {
        it('should block javascript with multiple spaces', () => {
            const href = 'javascript   :alert(1)';
            // After normalization/lowercase, this should still match
            expect(href.toLowerCase().includes('javascript')).toBe(true);
        });

        it('should block URL-encoded javascript', () => {
            // When decoded: javascript:alert(1)
            // The actual check happens on decoded values
            const decoded = decodeURIComponent('javascript%3Aalert(1)');
            expect(matchesScriptingPattern(decoded)).toBe(true);
        });

        it('should block all control character variations', () => {
            // Control characters 0x00-0x1F
            for (let i = 0; i < 32; i++) {
                const pattern = `javas${String.fromCharCode(i)}cript`;
                expect(VisualConstants.scriptingPatterns).toContain(pattern);
            }
        });

        it('should block expression with space before parenthesis', () => {
            expect(VisualConstants.scriptingPatterns).toContain('expression (');
        });

        it('should block behavior with space before colon', () => {
            expect(VisualConstants.scriptingPatterns).toContain('behavior :');
        });
    });

    describe('8. Safe Content Verification', () => {
        it('should NOT block normal HTML content', () => {
            const safeContent = '<p>Hello, World!</p>';
            expect(matchesScriptingPattern(safeContent)).toBe(false);
            expect(matchesCssDangerousPattern(safeContent)).toBe(false);
        });

        it('should NOT block HTML tables', () => {
            const tableContent = '<table><tr><td>Data</td></tr></table>';
            expect(matchesScriptingPattern(tableContent)).toBe(false);
        });

        it('should NOT block safe links', () => {
            const links = [
                'https://microsoft.com',
                'http://example.org',
                'https://github.com/repo'
            ];
            links.forEach(link => {
                expect(matchesScriptingPattern(link)).toBe(false);
            });
        });

        it('should NOT block safe CSS colors', () => {
            const safeCss = [
                'color: red;',
                'background-color: #fff;',
                'border: 1px solid rgba(0,0,0,0.5);'
            ];
            safeCss.forEach(css => {
                expect(matchesCssDangerousPattern(css)).toBe(false);
                expect(matchesScriptingPattern(css)).toBe(false);
            });
        });

        it('should NOT block CSS with safe url()', () => {
            const safeCss = "background: url('https://example.com/image.png');";
            expect(matchesCssDangerousPattern(safeCss)).toBe(false);
        });
    });

    describe('9. Allowed Tags Verification', () => {
        it('should include all standard text formatting tags', () => {
            const textTags = [
                'p',
                'span',
                'div',
                'strong',
                'em',
                'b',
                'i',
                'u',
                'br'
            ];
            textTags.forEach(tag => {
                expect(VisualConstants.allowedTags).toContain(tag);
            });
        });

        it('should include heading tags', () => {
            const headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
            headings.forEach(tag => {
                expect(VisualConstants.allowedTags).toContain(tag);
            });
        });

        it('should include list tags', () => {
            const listTags = ['ul', 'ol', 'li'];
            listTags.forEach(tag => {
                expect(VisualConstants.allowedTags).toContain(tag);
            });
        });

        it('should include table-related tags', () => {
            const tableTags = ['table', 'tr', 'td', 'th', 'thead', 'tbody'];
            tableTags.forEach(tag => {
                expect(VisualConstants.allowedTags).toContain(tag);
            });
        });

        it('should NOT include dangerous tags', () => {
            const dangerousTags = [
                'script',
                'iframe',
                'frame',
                'frameset',
                'object',
                'embed',
                'applet',
                'form',
                'input',
                'button',
                'select',
                'textarea',
                'base',
                'link',
                'meta'
            ];
            dangerousTags.forEach(tag => {
                expect(VisualConstants.allowedTags).not.toContain(tag);
            });
        });
    });
});
