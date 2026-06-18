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
        wrap.appendChild(el('p', 'hc-empty', s.labels.sanitizerEmpty));
        return wrap;
    }
    const table = el('table', 'hc-table');
    const head = el('tr');
    [s.labels.colKind, s.labels.colSubject, s.labels.colRule].forEach((h) =>
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
                s.labels.overflow.replace('{0}', String(s.sanitizer.overflow))
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
        wrap.appendChild(el('p', 'hc-empty', s.labels.consoleEmpty));
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

/**
 * Copy text to the clipboard. The dialog runs in Power BI's sandboxed iframe,
 * where the async Clipboard API (navigator.clipboard) is blocked, so we use the
 * deprecated-but-functional execCommand('copy') path: stage the text in an
 * off-screen textarea, select it, and copy. Best-effort — failures are silent.
 */
const copyText = (text: string): void => {
    const staging = document.createElement('textarea');
    staging.value = text;
    staging.setAttribute('readonly', '');
    staging.style.position = 'fixed';
    staging.style.top = '-1000px';
    staging.style.opacity = '0';
    document.body.appendChild(staging);
    staging.select();
    try {
        document.execCommand('copy');
    } catch {
        /* copy unavailable in this host; ignore */
    }
    document.body.removeChild(staging);
};

const rawTab = (s: DiagnosticsSnapshot): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-raw');
    if (s.rawHtml.truncated) {
        wrap.appendChild(
            el(
                'p',
                'hc-overflow',
                s.labels.truncated
                    .replace('{0}', String(s.rawHtml.text.length))
                    .replace('{1}', String(s.rawHtml.totalLength))
            )
        );
    }
    const copy = el('button', 'hc-copy', s.labels.copy) as HTMLButtonElement;
    copy.type = 'button';
    copy.addEventListener('click', () => copyText(s.rawHtml.text));
    wrap.appendChild(copy);
    const pre = el('pre', 'hc-pre');
    // Built as DOM nodes (not innerHTML) so the certified visual keeps its
    // no-innerHTML posture; lossless — pre.textContent === s.rawHtml.text.
    pre.appendChild(buildHighlightedFragment(s.rawHtml.text));
    wrap.appendChild(pre);
    return wrap;
};

/**
 * Build the tabbed diagnostics UI into `host` from `snapshot`. Pure DOM.
 * `onTabChange` (optional) fires with the active tab id on the initial render
 * and on every tab switch, so the caller can remember the selection.
 */
export const renderPanel = (
    host: HTMLElement,
    snapshot: DiagnosticsSnapshot,
    onTabChange?: (tabId: string) => void
): void => {
    host.replaceChildren(); // clear without innerHTML (cert-safe)
    host.className = 'hc-diagnostics';
    // Raw HTML is first (the default tab). The Sanitizer tab is included only
    // when this edition runs the sanitizer — it's meaningless in the
    // unsanitized standard/standalone editions. Console is always present.
    const tabs = [
        { id: 'raw', label: snapshot.labels.tabRaw, body: rawTab(snapshot) }
    ];
    if (snapshot.sanitizeEnabled) {
        tabs.push({
            id: 'sanitizer',
            label: snapshot.labels.tabSanitizer,
            body: sanitizerTab(snapshot)
        });
    }
    tabs.push({
        id: 'console',
        label: snapshot.labels.tabConsole,
        body: consoleTab(snapshot)
    });

    // Restore the remembered tab if it's available this render; otherwise
    // default to the first tab (Raw HTML).
    const activeId = tabs.some((t) => t.id === snapshot.initialTab)
        ? (snapshot.initialTab as string)
        : tabs[0].id;

    const bar = el('div', 'hc-tabbar');
    bar.setAttribute('role', 'tablist');
    const panels = el('div', 'hc-panels');
    const buttons: HTMLButtonElement[] = [];

    const activate = (id: string): void => {
        tabs.forEach((o, j) => {
            const on = o.id === id;
            o.body.style.display = on ? 'block' : 'none';
            buttons[j].setAttribute('aria-selected', String(on));
        });
        onTabChange?.(id);
    };

    tabs.forEach((t) => {
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
        btn.setAttribute('aria-selected', String(t.id === activeId));
        t.body.id = panelId;
        t.body.setAttribute('role', 'tabpanel');
        t.body.setAttribute('aria-labelledby', tabId);
        t.body.style.display = t.id === activeId ? 'block' : 'none';
        btn.addEventListener('click', () => activate(t.id));
        buttons.push(btn);
        bar.appendChild(btn);
        panels.appendChild(t.body);
    });
    host.appendChild(bar);
    host.appendChild(panels);
    // Report the initial active tab so the caller's remembered selection is
    // correct even if the user closes without switching tabs.
    onTabChange?.(activeId);
};

export class DiagnosticsDialog {
    static id = VisualConstants.diagnostics.dialogId;
    constructor(
        options: {
            element: HTMLElement;
            host?: { setResult?: (state: object) => void };
        },
        initialState: object
    ) {
        // Report tab changes back to the visual via the dialog host result, so
        // the visual can reopen on the same tab during the session.
        renderPanel(
            options.element,
            initialState as DiagnosticsSnapshot,
            (tabId) => options.host?.setResult?.({ lastTab: tabId })
        );
    }
}

const g = globalThis as unknown as { dialogRegistry?: Record<string, unknown> };
g.dialogRegistry = g.dialogRegistry || {};
g.dialogRegistry[DiagnosticsDialog.id] = DiagnosticsDialog;
