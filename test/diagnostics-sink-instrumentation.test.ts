import { describe, it, expect, beforeEach } from 'vitest';
import { getSanitizedHtmlForTesting } from '../src/sanitize/backend.certified';
import { beginCapture, endCapture } from '../src/diagnostics/diagnostics-sink';
import type { SanitizeOptions } from '../src/sanitize/options';

const sanitizeWithCapture = (html: string, options?: SanitizeOptions) => {
    beginCapture();
    const out = getSanitizedHtmlForTesting(html, 'html', options);
    return { out, cap: endCapture() };
};

describe('sanitizer instrumentation', () => {
    beforeEach(() => endCapture());

    it('is byte-identical with capture armed vs disarmed', () => {
        const html =
            '<div onclick="x()" style="color:red"><a href="javascript:1">x</a>' +
            '<script>bad()</script><p title="ok">hi</p></div>';
        const disarmed = getSanitizedHtmlForTesting(html, 'html');
        beginCapture();
        const armed = getSanitizedHtmlForTesting(html, 'html');
        endCapture();
        expect(armed).toBe(disarmed);
    });

    it('records an event-handler removal', () => {
        const { cap } = sanitizeWithCapture('<div onclick="x()">hi</div>');
        expect(cap.entries.some((e) => e.rule === 'event-handler')).toBe(true);
    });

    it('records a disallowed URL scheme', () => {
        // allowHyperlinks: true so the hyperlink-toggle gate (which would
        // record 'hyperlinks-disabled' first and short-circuit) is bypassed
        // and the per-tag URL-scheme gate is the one that fires.
        const { cap } = sanitizeWithCapture('<a href="javascript:1">x</a>', {
            allowHyperlinks: true
        });
        expect(
            cap.entries.some((e) => e.rule === 'disallowed-url-scheme')
        ).toBe(true);
    });

    it('records a DOMPurify-core tag removal (<script>)', () => {
        const { cap } = sanitizeWithCapture('<script>bad()</script><p>ok</p>');
        expect(
            cap.entries.some(
                (e) => e.kind === 'tag' && /script/i.test(e.subject)
            )
        ).toBe(true);
    });

    it('records nothing when disarmed', () => {
        getSanitizedHtmlForTesting('<div onclick="x()">hi</div>', 'html');
        expect(endCapture().entries).toEqual([]);
    });
});
