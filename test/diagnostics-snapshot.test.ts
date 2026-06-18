import { describe, it, expect } from 'vitest';
import {
    buildSnapshot,
    shouldShowDiagnosticsIcon,
    createDiagnosticsIcon,
    setIconVisibility
} from '../src/diagnostics/diagnostics-snapshot';
import { VisualConstants } from '../src/visual-constants';

describe('shouldShowDiagnosticsIcon', () => {
    it('requires the toggle, allowModalDialog, AND edit mode', () => {
        expect(shouldShowDiagnosticsIcon(true, true, true)).toBe(true);
        // any single gate failing hides it:
        expect(shouldShowDiagnosticsIcon(true, true, false)).toBe(false); // view mode
        expect(shouldShowDiagnosticsIcon(true, false, true)).toBe(false); // no host support
        expect(shouldShowDiagnosticsIcon(false, true, true)).toBe(false); // toggle off
        expect(shouldShowDiagnosticsIcon(true, undefined, true)).toBe(false);
        expect(shouldShowDiagnosticsIcon(false, false, false)).toBe(false);
    });
});

const labels = {
    tabSanitizer: 'Sanitizer',
    tabConsole: 'Console',
    tabRaw: 'Raw HTML',
    sanitizerEmpty: 'none',
    consoleEmpty: 'none',
    colKind: 'kind',
    colSubject: 'subject',
    colRule: 'rule',
    overflow: '+{0} more',
    truncated: 'first {0} of {1}',
    copy: 'Copy'
};

describe('buildSnapshot', () => {
    const base = {
        sanitizer: { entries: [], overflow: 0 },
        console: [],
        labels,
        sanitizeEnabled: true
    };

    it('passes the labels and sanitizeEnabled through unchanged', () => {
        const snap = buildSnapshot({ ...base, rawHtml: 'x' });
        expect(snap.labels).toBe(labels);
        expect(snap.sanitizeEnabled).toBe(true);
        expect(
            buildSnapshot({ ...base, rawHtml: 'x', sanitizeEnabled: false })
                .sanitizeEnabled
        ).toBe(false);
    });

    it('passes short raw HTML through untruncated', () => {
        const snap = buildSnapshot({ ...base, rawHtml: '<p>hi</p>' });
        expect(snap.rawHtml.truncated).toBe(false);
        expect(snap.rawHtml.text).toBe('<p>hi</p>');
        expect(snap.rawHtml.totalLength).toBe(9);
    });

    it('truncates raw HTML over the cap and reports totalLength', () => {
        const big = 'x'.repeat(
            VisualConstants.diagnostics.rawHtmlCapBytes + 100
        );
        const snap = buildSnapshot({ ...base, rawHtml: big });
        expect(snap.rawHtml.truncated).toBe(true);
        expect(snap.rawHtml.text.length).toBe(
            VisualConstants.diagnostics.rawHtmlCapBytes
        );
        expect(snap.rawHtml.totalLength).toBe(big.length);
    });

    it('does not truncate at exactly the cap boundary', () => {
        const exact = 'x'.repeat(VisualConstants.diagnostics.rawHtmlCapBytes);
        const snap = buildSnapshot({ ...base, rawHtml: exact });
        expect(snap.rawHtml.truncated).toBe(false);
        expect(snap.rawHtml.text.length).toBe(
            VisualConstants.diagnostics.rawHtmlCapBytes
        );
    });
});

describe('icon helpers', () => {
    it('creates a button with the configured id, localized labels, and wires the click', () => {
        let clicked = 0;
        const btn = createDiagnosticsIcon(
            () => clicked++,
            'Diag title',
            'Open diag'
        );
        expect(btn.id).toBe(VisualConstants.diagnostics.iconIdSelector);
        expect(btn.title).toBe('Diag title');
        expect(btn.getAttribute('aria-label')).toBe('Open diag');
        btn.dispatchEvent(new MouseEvent('click'));
        expect(clicked).toBe(1);
    });

    it('toggles visibility', () => {
        const btn = createDiagnosticsIcon(() => {}, 't', 'a');
        setIconVisibility(btn, false);
        expect(btn.style.display).toBe('none');
        setIconVisibility(btn, true);
        expect(btn.style.display).not.toBe('none');
    });

    it('stops click propagation (does not bubble to the visual)', () => {
        const btn = createDiagnosticsIcon(() => {}, 't', 'a');
        document.body.appendChild(btn);
        let bubbled = false;
        const onBody = () => {
            bubbled = true;
        };
        document.body.addEventListener('click', onBody);
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(bubbled).toBe(false);
        document.body.removeEventListener('click', onBody);
        btn.remove();
    });
});
