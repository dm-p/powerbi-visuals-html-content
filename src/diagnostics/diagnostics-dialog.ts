/**
 * The registered diagnostics modal dialog and its pure renderer. renderPanel
 * builds the three-tab UI from a snapshot (no live link to the visual). The
 * DiagnosticsDialog class is the host entry point; it self-registers so the
 * packaged config can resolve it by id (no webpack entry needed).
 */
import { DiagnosticsSnapshot, SanitizerEntry, ConsoleEntry } from './types';
import { buildHighlightedFragment } from './highlight-html';
import { VisualConstants } from '../visual-constants';

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
};

const sanitizerTab = (s: DiagnosticsSnapshot): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-sanitizer');
    if (s.sanitizer.entries.length === 0) {
        wrap.appendChild(
            el('p', 'hc-empty', 'No removals in the last render.')
        );
        return wrap;
    }
    const table = el('table', 'hc-table');
    const head = el('tr');
    ['kind', 'subject', 'rule'].forEach((h) =>
        head.appendChild(el('th', undefined, h))
    );
    table.appendChild(head);
    s.sanitizer.entries.forEach((e: SanitizerEntry) => {
        const tr = el('tr');
        tr.appendChild(el('td', undefined, e.kind));
        tr.appendChild(
            el(
                'td',
                undefined,
                e.snippet ? `${e.subject} — ${e.snippet}` : e.subject
            )
        );
        tr.appendChild(el('td', undefined, e.rule));
        table.appendChild(tr);
    });
    wrap.appendChild(table);
    if (s.sanitizer.overflow > 0) {
        wrap.appendChild(
            el(
                'p',
                'hc-overflow',
                `+${s.sanitizer.overflow} more removals not shown`
            )
        );
    }
    return wrap;
};

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Local wall-clock HH:MM:SS.mmm for a captured console entry timestamp. */
const fmtTime = (ts: number): string => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
        d.getSeconds()
    )}.${pad(d.getMilliseconds(), 3)}`;
};

const consoleTab = (s: DiagnosticsSnapshot): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-console');
    if (s.console.length === 0) {
        wrap.appendChild(el('p', 'hc-empty', 'No console output captured.'));
        return wrap;
    }
    s.console.forEach((c: ConsoleEntry) => {
        const line = el('div', `hc-log hc-${c.level}`);
        line.appendChild(el('span', 'hc-time', fmtTime(c.ts)));
        line.appendChild(el('span', 'hc-level', c.level));
        line.appendChild(el('span', 'hc-text', c.text));
        wrap.appendChild(line);
    });
    return wrap;
};

const rawTab = (s: DiagnosticsSnapshot): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-raw');
    if (s.rawHtml.truncated) {
        wrap.appendChild(
            el(
                'p',
                'hc-overflow',
                `… truncated — showing first ${s.rawHtml.text.length} of ${s.rawHtml.totalLength} characters`
            )
        );
    }
    const copy = el('button', 'hc-copy', 'Copy') as HTMLButtonElement;
    copy.type = 'button';
    copy.addEventListener('click', () => {
        try {
            void navigator.clipboard?.writeText(s.rawHtml.text);
        } catch {
            /* clipboard unavailable; ignore */
        }
    });
    wrap.appendChild(copy);
    const pre = el('pre', 'hc-pre');
    // Built as DOM nodes (not innerHTML) so the certified visual keeps its
    // no-innerHTML posture; lossless — pre.textContent === s.rawHtml.text.
    pre.appendChild(buildHighlightedFragment(s.rawHtml.text));
    wrap.appendChild(pre);
    return wrap;
};

/** Build the tabbed diagnostics UI into `host` from `snapshot`. Pure DOM. */
export const renderPanel = (
    host: HTMLElement,
    snapshot: DiagnosticsSnapshot
): void => {
    host.replaceChildren(); // clear without innerHTML (cert-safe)
    host.className = 'hc-diagnostics';
    const tabs = [
        { id: 'sanitizer', label: 'Sanitizer', body: sanitizerTab(snapshot) },
        { id: 'console', label: 'Console', body: consoleTab(snapshot) },
        { id: 'raw', label: 'Raw HTML', body: rawTab(snapshot) }
    ];
    const bar = el('div', 'hc-tabbar');
    bar.setAttribute('role', 'tablist');
    const panels = el('div', 'hc-panels');
    const buttons: HTMLButtonElement[] = [];
    tabs.forEach((t, i) => {
        const tabId = `hc-tab-${t.id}`;
        const panelId = `hc-panel-${t.id}`;
        const btn = el('button', 'hc-tab', t.label) as HTMLButtonElement;
        btn.type = 'button';
        btn.id = tabId;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-controls', panelId);
        // aria-selected is the single source of truth for the active tab —
        // CSS (.hc-tab[aria-selected="true"]) styles it, and assistive tech
        // announces it. Keep it in sync with panel visibility below.
        btn.setAttribute('aria-selected', String(i === 0));
        t.body.id = panelId;
        t.body.setAttribute('role', 'tabpanel');
        t.body.setAttribute('aria-labelledby', tabId);
        t.body.style.display = i === 0 ? 'block' : 'none';
        btn.addEventListener('click', () => {
            tabs.forEach((o, j) => {
                const active = o.id === t.id;
                o.body.style.display = active ? 'block' : 'none';
                buttons[j].setAttribute('aria-selected', String(active));
            });
        });
        buttons.push(btn);
        bar.appendChild(btn);
        panels.appendChild(t.body);
    });
    host.appendChild(bar);
    host.appendChild(panels);
};

export class DiagnosticsDialog {
    static id = VisualConstants.diagnostics.dialogId;
    constructor(options: { element: HTMLElement }, initialState: object) {
        renderPanel(options.element, initialState as DiagnosticsSnapshot);
    }
}

const g = globalThis as unknown as { dialogRegistry?: Record<string, unknown> };
g.dialogRegistry = g.dialogRegistry || {};
g.dialogRegistry[DiagnosticsDialog.id] = DiagnosticsDialog;
