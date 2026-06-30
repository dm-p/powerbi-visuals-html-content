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
    copy: 'Copy',
    consoleClear: 'Clear',
    docsHeading: 'Learn:',
    docsSanitization: 'Sanitization rules',
    docsAcceptedTags: 'Accepted tags',
    rawBanner: 'Processed HTML.',
    rawBannerSanitized: 'Processed and sanitized HTML.',
    tabEvents: 'Events',
    eventsEmpty: 'No host events captured.',
    colTime: 'time',
    colEvent: 'event',
    colContext: 'context',
    eventsClear: 'Clear',
    evtUpdate: 'update',
    evtCrossFilter: 'cross-filter',
    evtTooltip: 'tooltip',
    evtContextMenu: 'context-menu',
    filterAll: 'all'
};

const snap = (
    over: Partial<DiagnosticsSnapshot> = {}
): DiagnosticsSnapshot => ({
    sanitizer: { entries: [], overflow: 0 },
    console: [],
    events: [],
    rawHtml: { text: '<p>hi</p>', truncated: false, totalLength: 9 },
    labels,
    sanitizeEnabled: true,
    ...over
});

describe('renderPanel', () => {
    it('renders four tab buttons when the sanitizer applies', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        const tabs = el.querySelectorAll('[role="tab"]');
        expect(tabs.length).toBe(4);
    });

    it('puts Raw HTML first as the default active tab', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        const tabs = el.querySelectorAll<HTMLElement>('[role="tab"]');
        expect(tabs[0].textContent).toBe('Raw HTML');
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    });

    it('omits the Sanitizer tab when sanitize is disabled (standard/standalone)', () => {
        const el = document.createElement('div');
        renderPanel(el, snap({ sanitizeEnabled: false }));
        const tabTexts = Array.from(el.querySelectorAll('[role="tab"]')).map(
            (t) => t.textContent
        );
        expect(tabTexts).toEqual(['Raw HTML', 'Console', 'Events']);
    });

    it('opens on the remembered initialTab when available', () => {
        const el = document.createElement('div');
        renderPanel(el, snap({ initialTab: 'console' }));
        expect(
            el.querySelector('#hc-tab-console')?.getAttribute('aria-selected')
        ).toBe('true');
        expect(
            el.querySelector('#hc-tab-raw')?.getAttribute('aria-selected')
        ).toBe('false');
    });

    it('falls back to the first tab when initialTab is unavailable', () => {
        const el = document.createElement('div');
        // remembered "sanitizer" but the tab is hidden this edition
        renderPanel(
            el,
            snap({ initialTab: 'sanitizer', sanitizeEnabled: false })
        );
        const tabs = el.querySelectorAll<HTMLElement>('[role="tab"]');
        expect(tabs[0].textContent).toBe('Raw HTML');
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    });

    it('reports the active tab via onTabChange on init and on click', () => {
        const el = document.createElement('div');
        const seen: string[] = [];
        renderPanel(el, snap(), { onTabChange: (id) => seen.push(id) });
        expect(seen).toEqual(['raw']); // initial active tab reported
        (el.querySelector('#hc-tab-console') as HTMLButtonElement).click();
        expect(seen[seen.length - 1]).toBe('console');
    });

    it('raw tab shows the sanitized banner when sanitize is on, plain otherwise', () => {
        const on = document.createElement('div');
        renderPanel(on, snap({ sanitizeEnabled: true }));
        // Scope to the raw panel: the Sanitizer tab's doc banner also carries
        // .hc-banner, so an unscoped selector would depend on tab render order.
        expect(on.querySelector('.hc-raw .hc-banner')?.textContent).toBe(
            'Processed and sanitized HTML.'
        );
        const off = document.createElement('div');
        renderPanel(off, snap({ sanitizeEnabled: false }));
        expect(off.querySelector('.hc-raw .hc-banner')?.textContent).toBe(
            'Processed HTML.'
        );
    });

    it('places the sanitizer doc links in a top info banner (matches Raw HTML position)', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        const panel = el.querySelector('.hc-sanitizer');
        // The doc banner is the first child and reuses the .hc-banner box so it
        // matches the Raw HTML info label's format and top position (UAT).
        const first = panel?.firstElementChild as HTMLElement;
        expect(first.classList.contains('hc-banner')).toBe(true);
        expect(first.classList.contains('hc-docs')).toBe(true);
        expect(first.querySelectorAll('.hc-doc-link').length).toBe(2);
    });

    it('console Clear empties the display and reports onClearConsole', () => {
        const el = document.createElement('div');
        let cleared = 0;
        renderPanel(
            el,
            snap({ console: [{ ts: 0, level: 'warn', text: 'careful' }] }),
            { onClearConsole: () => cleared++ }
        );
        expect(el.querySelector('.hc-log')).not.toBeNull();
        (el.querySelector('.hc-clear') as HTMLButtonElement).click();
        expect(el.querySelector('.hc-log')).toBeNull();
        expect(cleared).toBe(1);
    });

    it('console level filter (radio) shows only the selected level', () => {
        const el = document.createElement('div');
        renderPanel(
            el,
            snap({
                console: [
                    { ts: 0, level: 'warn', text: 'w' },
                    { ts: 0, level: 'error', text: 'e' }
                ]
            })
        );
        const warnLine = el.querySelector('.hc-log.hc-warn') as HTMLElement;
        const errorLine = el.querySelector('.hc-log.hc-error') as HTMLElement;
        // Default 'all' → both visible.
        expect(warnLine.style.display).not.toBe('none');
        expect(errorLine.style.display).not.toBe('none');
        // Pick the 'warn' radio → only warn visible.
        const warnRadio = el.querySelector(
            'input[name="hc-console-filter"][value="warn"]'
        ) as HTMLInputElement;
        warnRadio.checked = true;
        warnRadio.dispatchEvent(new Event('change'));
        expect(warnLine.style.display).not.toBe('none');
        expect(errorLine.style.display).toBe('none');
    });

    it('console filter restores the remembered pick and reports changes', () => {
        const el = document.createElement('div');
        const picks: string[] = [];
        renderPanel(
            el,
            snap({
                consoleFilter: 'error',
                console: [
                    { ts: 0, level: 'warn', text: 'w' },
                    { ts: 0, level: 'error', text: 'e' }
                ]
            }),
            { onConsoleFilter: (l) => picks.push(l) }
        );
        // Remembered 'error' applied on open: warn hidden, error shown, radio set.
        expect(
            (el.querySelector('.hc-log.hc-warn') as HTMLElement).style.display
        ).toBe('none');
        expect(
            (el.querySelector('.hc-log.hc-error') as HTMLElement).style.display
        ).not.toBe('none');
        expect(
            (
                el.querySelector(
                    'input[name="hc-console-filter"][value="error"]'
                ) as HTMLInputElement
            ).checked
        ).toBe(true);
        // Switching back to All reports the change.
        const allRadio = el.querySelector(
            'input[name="hc-console-filter"][value="all"]'
        ) as HTMLInputElement;
        allRadio.checked = true;
        allRadio.dispatchEvent(new Event('change'));
        expect(picks).toContain('all');
    });

    it('sanitizer doc links report onLaunchDoc with the doc key', () => {
        const el = document.createElement('div');
        const launched: string[] = [];
        renderPanel(el, snap(), { onLaunchDoc: (k) => launched.push(k) });
        const links = el.querySelectorAll<HTMLButtonElement>('.hc-doc-link');
        expect(links.length).toBe(2);
        links[0].click();
        links[1].click();
        expect(launched).toEqual(['sanitization', 'acceptedTags']);
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
        expect(panels.length).toBe(4);
        // First tab active initially.
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(tabs[1].getAttribute('aria-selected')).toBe('false');
        expect(panels[0].style.display).toBe('flex');
        expect(panels[1].style.display).toBe('none');
        // Each tab controls/labels its panel.
        expect(tabs[1].getAttribute('aria-controls')).toBe(panels[1].id);
        expect(panels[1].getAttribute('aria-labelledby')).toBe(tabs[1].id);
        // Click the second tab.
        tabs[1].click();
        expect(tabs[0].getAttribute('aria-selected')).toBe('false');
        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        expect(panels[0].style.display).toBe('none');
        expect(panels[1].style.display).toBe('flex');
    });

    it('places Copy beside the banner in the Raw HTML header row', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        const header = el.querySelector('.hc-raw .hc-raw-header') as HTMLElement;
        expect(header).not.toBeNull();
        // Banner and Copy are siblings in the header row (Copy shrinks to the
        // right rather than stretching full width below the banner).
        expect(header.querySelector(':scope > .hc-banner')).not.toBeNull();
        expect(header.querySelector(':scope > .hc-copy')).not.toBeNull();
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

    it('always renders an Events tab (every edition)', () => {
        const el = document.createElement('div');
        renderPanel(el, snap({ sanitizeEnabled: false }));
        const tabTexts = Array.from(el.querySelectorAll('[role="tab"]')).map(
            (t) => t.textContent
        );
        expect(tabTexts).toContain('Events');
    });

    it('renders host-event rows with time, type, and context', () => {
        const el = document.createElement('div');
        renderPanel(
            el,
            snap({
                events: [
                    {
                        ts: 0,
                        type: 'cross-filter',
                        summary: 'cross-filter',
                        context: 'Region="East"'
                    }
                ]
            })
        );
        const row = el.querySelector('.hc-evt') as HTMLElement;
        expect(row.querySelector('.hc-time')?.textContent).toMatch(
            /^\d{2}:\d{2}:\d{2}\.\d{3}$/
        );
        expect(row.querySelector('.hc-evt-type')?.textContent).toBe('cross-filter');
        // The context cell shows "summary · context" (the detail); assert it carries
        // the point context.
        expect(row.querySelector('.hc-evt-context')?.textContent).toContain(
            'Region="East"'
        );
    });

    it('event type filter (radio) shows only the selected type', () => {
        const el = document.createElement('div');
        renderPanel(
            el,
            snap({
                events: [
                    { ts: 0, type: 'update', summary: 'u' },
                    { ts: 0, type: 'context-menu', summary: 'd' }
                ]
            })
        );
        const updateRow = el.querySelector(
            '.hc-evt.hc-evt-update'
        ) as HTMLElement;
        const ctxRow = el.querySelector(
            '.hc-evt.hc-evt-context-menu'
        ) as HTMLElement;
        // Default 'all' → both visible.
        expect(updateRow.style.display).not.toBe('none');
        expect(ctxRow.style.display).not.toBe('none');
        // Pick the 'context-menu' radio → only context-menu visible.
        const ctxRadio = el.querySelector(
            'input[name="hc-events-filter"][value="context-menu"]'
        ) as HTMLInputElement;
        ctxRadio.checked = true;
        ctxRadio.dispatchEvent(new Event('change'));
        expect(updateRow.style.display).toBe('none');
        expect(ctxRow.style.display).not.toBe('none');
    });

    it('events filter restores the remembered pick and reports changes', () => {
        const el = document.createElement('div');
        const picks: string[] = [];
        renderPanel(
            el,
            snap({
                eventsFilter: 'context-menu',
                events: [
                    { ts: 0, type: 'update', summary: 'u' },
                    { ts: 0, type: 'context-menu', summary: 'd' }
                ]
            }),
            { onEventsFilter: (t) => picks.push(t) }
        );
        // Remembered 'context-menu' applied on open.
        expect(
            (el.querySelector('.hc-evt.hc-evt-update') as HTMLElement).style
                .display
        ).toBe('none');
        expect(
            (el.querySelector('.hc-evt.hc-evt-context-menu') as HTMLElement)
                .style.display
        ).not.toBe('none');
        expect(
            (
                el.querySelector(
                    'input[name="hc-events-filter"][value="context-menu"]'
                ) as HTMLInputElement
            ).checked
        ).toBe(true);
        // Switching to update reports it.
        const updateRadio = el.querySelector(
            'input[name="hc-events-filter"][value="update"]'
        ) as HTMLInputElement;
        updateRadio.checked = true;
        updateRadio.dispatchEvent(new Event('change'));
        expect(picks).toContain('update');
    });

    it('events Clear empties the display and reports onClearEvents', () => {
        const el = document.createElement('div');
        let cleared = 0;
        renderPanel(
            el,
            snap({ events: [{ ts: 0, type: 'update', summary: 'u' }] }),
            { onClearEvents: () => cleared++ }
        );
        expect(el.querySelector('.hc-evt')).not.toBeNull();
        (el.querySelector('.hc-events .hc-clear') as HTMLButtonElement).click();
        expect(el.querySelector('.hc-evt')).toBeNull();
        expect(cleared).toBe(1);
    });

    it('events tab shows an empty state when there are no events', () => {
        const el = document.createElement('div');
        renderPanel(el, snap({ events: [] }));
        expect(el.querySelector('.hc-events')?.textContent?.toLowerCase()).toContain(
            'no host events'
        );
    });

    it('activates the selected panel with display:flex (frozen-header layout)', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        const raw = el.querySelector('#hc-panel-raw') as HTMLElement;
        expect(raw.style.display).toBe('flex');
    });

    it('wraps each tab body in a scrollable .hc-tab-body under a header sibling', () => {
        const el = document.createElement('div');
        renderPanel(el, snap());
        const consolePanel = el.querySelector('#hc-panel-console') as HTMLElement;
        // toolbar (header) and the scrollable body are siblings; body carries .hc-tab-body
        expect(consolePanel.querySelector(':scope > .hc-console-toolbar')).not.toBeNull();
        expect(consolePanel.querySelector(':scope > .hc-tab-body')).not.toBeNull();
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

    it('fills the height chain so only the tab body scrolls (frozen header)', () => {
        // Save/restore the shared jsdom document styles this mutates.
        const prevHtmlH = document.documentElement.style.height;
        const prevBodyH = document.body.style.height;
        const prevBodyM = document.body.style.margin;

        const host = document.createElement('div');
        const inner = document.createElement('div'); // nested host element
        host.appendChild(inner);
        document.body.appendChild(host);
        new DiagnosticsDialog(
            {
                element: inner,
                host: { setResult() {}, close() {} }
            },
            snap()
        );
        // The chain from <html>/<body> down through the host ancestors gets a
        // definite height so .hc-diagnostics { height: 100% } resolves.
        expect(document.documentElement.style.height).toBe('100%');
        expect(document.body.style.height).toBe('100%');
        expect(document.body.style.margin).not.toBe('');
        expect(host.style.height).toBe('100%');
        expect(inner.style.height).toBe('100%');

        document.body.removeChild(host);
        document.documentElement.style.height = prevHtmlH;
        document.body.style.height = prevBodyH;
        document.body.style.margin = prevBodyM;
    });
});
