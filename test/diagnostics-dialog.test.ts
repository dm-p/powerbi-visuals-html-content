import { describe, it, expect, vi } from 'vitest';
import {
    renderPanel,
    DiagnosticsDialog
} from '../src/diagnostics/diagnostics-dialog';
import { DiagnosticsSnapshot } from '../src/diagnostics/types';
import { VisualConstants } from '../src/visual-constants';

const labels = {
    tabSanitizer: 'Sanitizer',
    tabConsole: 'Console',
    tabRaw: 'Raw HTML',
    sanitizerEmpty: 'No removals in the last render.',
    consoleEmpty: 'No console output captured.',
    colKind: 'kind',
    colSubject: 'subject',
    colRule: 'rule',
    overflow: '+{0} more removals not shown',
    truncated: '… truncated — showing first {0} of {1} characters',
    copy: 'Copy'
};

const snap = (
    over: Partial<DiagnosticsSnapshot> = {}
): DiagnosticsSnapshot => ({
    sanitizer: { entries: [], overflow: 0 },
    console: [],
    rawHtml: { text: '<p>hi</p>', truncated: false, totalLength: 9 },
    labels,
    ...over
});

describe('renderPanel', () => {
    it('renders three tab buttons', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        const tabs = el.querySelectorAll('[role="tab"]');
        expect(tabs.length).toBe(3);
    });

    it('lists sanitizer entries and the overflow note', () => {
        const el = document.createElement('div');
        renderPanel(
            el,
            snap({
                sanitizer: {
                    entries: [
                        {
                            kind: 'attr',
                            subject: 'onclick on <div>',
                            rule: 'event-handler'
                        }
                    ],
                    overflow: 7
                }
            })
        );
        expect(el.textContent).toContain('onclick on <div>');
        expect(el.textContent).toContain('event-handler');
        expect(el.textContent).toContain('7');
    });

    it('shows an empty state when there are no removals', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        expect(el.textContent?.toLowerCase()).toContain('no');
    });

    it('renders the raw HTML with the truncation marker when truncated', () => {
        const el = document.createElement('div');
        renderPanel(
            el,
            snap({
                rawHtml: { text: 'abc', truncated: true, totalLength: 99999 }
            })
        );
        expect(el.textContent).toContain('truncated');
    });

    it('interpolates overflow and truncation counts from the labels', () => {
        const el = document.createElement('div');
        renderPanel(
            el,
            snap({
                sanitizer: {
                    entries: [{ kind: 'attr', subject: 's', rule: 'r' }],
                    overflow: 4
                },
                rawHtml: { text: 'ab', truncated: true, totalLength: 500 }
            })
        );
        expect(el.textContent).toContain('+4 more removals not shown');
        expect(el.textContent).toContain('showing first 2 of 500');
        expect(el.textContent).not.toContain('{0}');
        expect(el.textContent).not.toContain('{1}');
    });

    it('renders the raw tab as colorized DOM nodes (no innerHTML, lossless)', () => {
        const el = document.createElement('div');
        const raw = '<p class="x">hi & bye</p>';
        renderPanel(
            el,
            snap({
                rawHtml: {
                    text: raw,
                    truncated: false,
                    totalLength: raw.length
                }
            })
        );
        const pre = el.querySelector('pre.hc-pre') as HTMLElement;
        expect(pre).not.toBeNull();
        // Colorized via span nodes...
        expect(pre.querySelector('.hc-tag')?.textContent).toBe('p');
        // ...and lossless: the pre's text is exactly the raw source.
        expect(pre.textContent).toBe(raw);
    });

    it('marks the active tab via aria-selected and toggles panels on click', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        const tabs = el.querySelectorAll<HTMLElement>('[role="tab"]');
        const panels = el.querySelectorAll<HTMLElement>('[role="tabpanel"]');
        expect(panels.length).toBe(3);
        // First tab active initially.
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(tabs[1].getAttribute('aria-selected')).toBe('false');
        expect(panels[0].style.display).toBe('block');
        expect(panels[1].style.display).toBe('none');
        // Each tab controls/labels its panel.
        expect(tabs[1].getAttribute('aria-controls')).toBe(panels[1].id);
        expect(panels[1].getAttribute('aria-labelledby')).toBe(tabs[1].id);
        // Click the second tab.
        tabs[1].click();
        expect(tabs[0].getAttribute('aria-selected')).toBe('false');
        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        expect(panels[0].style.display).toBe('none');
        expect(panels[1].style.display).toBe('block');
    });

    it('copy button uses execCommand (Clipboard API is blocked in the dialog iframe)', () => {
        const exec = vi.fn().mockReturnValue(true);
        const original = (document as unknown as { execCommand?: unknown })
            .execCommand;
        (document as unknown as { execCommand: unknown }).execCommand = exec;
        try {
            const el = document.createElement('div');
            const raw = '<p>copy me</p>';
            renderPanel(
                el,
                snap({
                    rawHtml: { text: raw, truncated: false, totalLength: 14 }
                })
            );
            (el.querySelector('.hc-copy') as HTMLButtonElement).click();
            expect(exec).toHaveBeenCalledWith('copy');
        } finally {
            (document as unknown as { execCommand: unknown }).execCommand =
                original;
        }
    });

    it('renders console entries with a timestamp, level, and text', () => {
        const el = document.createElement('div');
        renderPanel(
            el,
            snap({
                console: [{ ts: 0, level: 'warn', text: 'careful' }]
            })
        );
        const line = el.querySelector('.hc-log') as HTMLElement;
        expect(line.querySelector('.hc-time')?.textContent).toMatch(
            /^\d{2}:\d{2}:\d{2}\.\d{3}$/
        );
        expect(line.querySelector('.hc-level')?.textContent).toBe('warn');
        expect(line.querySelector('.hc-text')?.textContent).toBe('careful');
    });
});

describe('DiagnosticsDialog registration', () => {
    it('registers itself in the global registry under its id', () => {
        const reg = (
            globalThis as unknown as {
                dialogRegistry?: Record<string, unknown>;
            }
        ).dialogRegistry;
        expect(reg?.[VisualConstants.diagnostics.dialogId]).toBe(
            DiagnosticsDialog
        );
    });
});
