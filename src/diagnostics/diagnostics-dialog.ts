/**
 * The registered diagnostics modal dialog and its pure renderer. renderPanel
 * builds the three-tab UI from a snapshot (no live link to the visual). The
 * DiagnosticsDialog class is the host entry point; it self-registers so the
 * packaged config can resolve it by id (no webpack entry needed).
 */
import {
    DiagnosticsSnapshot,
    SanitizerEntry,
    ConsoleEntry,
    ConsoleLevel,
    DiagnosticsDocKey,
    HostEvent,
    HostEventType,
    DiagnosticsLabels
} from './types';
import { buildHighlightedFragment } from './highlight-html';
import { VisualConstants } from '../visual-constants';

/** Callbacks the renderer fires; the dialog wires them to the host result. */
export interface PanelCallbacks {
    onTabChange?: (tabId: string) => void;
    onClearConsole?: () => void;
    onLaunchDoc?: (key: DiagnosticsDocKey) => void;
    onClearEvents?: () => void;
    /** Console level filter changed ('all' or a single level) — memoized. */
    onConsoleFilter?: (level: string) => void;
    /** Events type filter changed ('all' or a single type) — memoized. */
    onEventsFilter?: (type: string) => void;
}

/**
 * A single-select radio filter: an "All" option followed by each individual
 * option. Single-select (radio, not checkboxes) is less cumbersome to drive
 * repeatedly when focusing on one level/type. `selected` is the initially-picked
 * value (memoized across opens); `onChange` fires with the newly picked value.
 */
const buildRadioFilter = (
    groupName: string,
    options: { value: string; label: string }[],
    selected: string,
    allLabel: string,
    onChange: (value: string) => void
): HTMLElement => {
    const group = el('div', 'hc-filter-group');
    const add = (value: string, label: string): void => {
        const lbl = el('label', 'hc-filter');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = groupName;
        radio.value = value;
        radio.checked = value === selected;
        radio.addEventListener('change', () => {
            if (radio.checked) onChange(value);
        });
        lbl.appendChild(radio);
        lbl.appendChild(el('span', 'hc-filter-label', label));
        group.appendChild(lbl);
    };
    add('all', allLabel);
    options.forEach((o) => add(o.value, o.label));
    return group;
};

/** Console levels offered as filter options, in severity order. */
const CONSOLE_LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error'];

/**
 * Host-event types offered as Events-tab filter options, each paired with its
 * localized label key. Order defines the radio order in the toolbar.
 */
const EVENT_TYPES: { type: HostEventType; label: keyof DiagnosticsLabels }[] = [
    { type: 'update', label: 'evtUpdate' },
    { type: 'cross-filter', label: 'evtCrossFilter' },
    { type: 'tooltip', label: 'evtTooltip' },
    { type: 'context-menu', label: 'evtContextMenu' }
];

/** Create an element with an optional class and text content — the terse DOM
 * builder the pure renderer leans on instead of innerHTML (cert-safe). */
const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
};

/**
 * Establish a definite height from the dialog viewport down to the host
 * element, so the frozen-header flex layout (`.hc-tab-body { overflow:auto }`)
 * has a fixed height to size against. Without this the host element and its
 * ancestors default to content height, the flex chain collapses, and the WHOLE
 * panel scrolls instead of just each tab's body. This runs in the dialog's own
 * sandboxed iframe, so styling its <html>/<body> is scoped to the dialog alone.
 * Best-effort — guarded so a missing document can't throw.
 */
const fillDialogHeight = (element: HTMLElement): void => {
    const doc = element.ownerDocument;
    if (!doc) return;
    if (doc.documentElement) doc.documentElement.style.height = '100%';
    if (doc.body) {
        doc.body.style.height = '100%';
        doc.body.style.margin = '0';
    }
    // Walk the host element and its ancestors up to <body>, giving each a
    // definite height so `.hc-diagnostics { height: 100% }` can resolve no
    // matter how deeply Power BI nests the host element.
    for (
        let node: HTMLElement | null = element;
        node && node !== doc.body;
        node = node.parentElement
    ) {
        node.style.height = '100%';
    }
};

/**
 * Top info banner of doc links; styled like the Raw HTML banner (.hc-banner)
 * for cross-tab consistency. The visual launches the links via launchUrl on a
 * doc key (the dialog iframe can't call launchUrl itself).
 */
const sanitizerDocs = (
    s: DiagnosticsSnapshot,
    callbacks: PanelCallbacks
): HTMLElement => {
    const docs = el('div', 'hc-banner hc-docs');
    docs.appendChild(el('span', 'hc-docs-heading', s.labels.docsHeading));
    const link = (text: string, key: DiagnosticsDocKey): HTMLButtonElement => {
        const b = el('button', 'hc-doc-link', text) as HTMLButtonElement;
        b.type = 'button';
        b.addEventListener('click', () => callbacks.onLaunchDoc?.(key));
        return b;
    };
    docs.appendChild(link(s.labels.docsSanitization, 'sanitization'));
    docs.appendChild(link(s.labels.docsAcceptedTags, 'acceptedTags'));
    return docs;
};

/**
 * Build the Sanitizer tab: the doc banner as a frozen header over a scrolling
 * body that lists each sanitizer entry (kind, subject/snippet, rule) as a
 * table, with an overflow note when entries were dropped past the cap.
 */
const sanitizerTab = (
    s: DiagnosticsSnapshot,
    callbacks: PanelCallbacks
): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-sanitizer');
    // Doc banner at the top (frozen header), matching the Raw HTML tab's
    // info-label position.
    wrap.appendChild(sanitizerDocs(s, callbacks));
    // Only the table/overflow body scrolls beneath the frozen banner.
    const body = el('div', 'hc-tab-body');
    if (s.sanitizer.entries.length === 0) {
        body.appendChild(el('p', 'hc-empty', s.labels.sanitizerEmpty));
    } else {
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
        body.appendChild(table);
        if (s.sanitizer.overflow > 0) {
            body.appendChild(
                el(
                    'p',
                    'hc-overflow',
                    s.labels.overflow.replace(
                        '{0}',
                        String(s.sanitizer.overflow)
                    )
                )
            );
        }
    }
    wrap.appendChild(body);
    return wrap;
};

/** Left-pad a number with zeros to a fixed width (for HH:MM:SS.mmm parts). */
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Local wall-clock HH:MM:SS.mmm for a captured console entry timestamp. */
const fmtTime = (ts: number): string => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
        d.getSeconds()
    )}.${pad(d.getMilliseconds(), 3)}`;
};

/**
 * Build the Console tab: a frozen toolbar (Clear + single-select level filter)
 * over a scrolling body of captured console lines. Filtering is in-dialog
 * show/hide; the level pick is memoized via the snapshot so it sticks across
 * opens. Clearing empties the display and reports the request to the caller.
 */
const consoleTab = (
    s: DiagnosticsSnapshot,
    callbacks: PanelCallbacks
): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-console');
    const lines = el('div', 'hc-console-lines');

    // Level filter (single-select radios: All + each level). Memoized via the
    // snapshot so the pick is sticky across opens. In-dialog show/hide only.
    const initialLevel = s.consoleFilter ?? 'all';
    function applyFilter(level: string): void {
        lines.querySelectorAll<HTMLElement>('.hc-log').forEach((line) => {
            line.style.display =
                level === 'all' || line.dataset.level === level ? '' : 'none';
        });
    }

    const toolbar = el('div', 'hc-console-toolbar');
    const clearBtn = el(
        'button',
        'hc-clear',
        s.labels.consoleClear
    ) as HTMLButtonElement;
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', () => {
        // Empty the display now; the live buffer is cleared by the visual when
        // the dialog closes (via the result), so the next open starts fresh.
        lines.replaceChildren(el('p', 'hc-empty', s.labels.consoleEmpty));
        callbacks.onClearConsole?.();
    });
    toolbar.appendChild(clearBtn);
    toolbar.appendChild(
        buildRadioFilter(
            'hc-console-filter',
            CONSOLE_LEVELS.map((level) => ({ value: level, label: level })),
            initialLevel,
            s.labels.filterAll,
            (level) => {
                applyFilter(level);
                callbacks.onConsoleFilter?.(level);
            }
        )
    );

    if (s.console.length === 0) {
        lines.appendChild(el('p', 'hc-empty', s.labels.consoleEmpty));
    } else {
        s.console.forEach((c: ConsoleEntry) => {
            const line = el('div', `hc-log hc-${c.level}`);
            line.dataset.level = c.level;
            line.appendChild(el('span', 'hc-time', fmtTime(c.ts)));
            line.appendChild(el('span', 'hc-level', c.level));
            line.appendChild(el('span', 'hc-text', c.text));
            lines.appendChild(line);
        });
    }
    // Apply the remembered filter to the freshly-built lines.
    applyFilter(initialLevel);

    // Toolbar stays frozen as the panel header; only the lines body scrolls.
    const body = el('div', 'hc-tab-body');
    body.appendChild(lines);
    wrap.appendChild(toolbar);
    wrap.appendChild(body);
    return wrap;
};

/**
 * Build the Events tab: a frozen toolbar (Clear + single-select type filter)
 * over a scrolling body of recorded host events. Mirrors the Console tab; the
 * type pick is memoized via the snapshot, falling back to 'all' if the
 * remembered type is no longer known so no row is left orphaned/hidden.
 */
const eventsTab = (
    s: DiagnosticsSnapshot,
    callbacks: PanelCallbacks
): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-events');
    const rows = el('div', 'hc-console-lines hc-evt-rows');

    // Type filter (single-select radios: All + each type). Memoized via the
    // snapshot so the pick is sticky across opens. Fall back to 'all' if the
    // remembered value is no longer a known type (e.g. a renamed event) — else
    // applyFilter would hide every row with no matching radio to recover.
    const initialType = EVENT_TYPES.some((t) => t.type === s.eventsFilter)
        ? (s.eventsFilter as string)
        : 'all';
    function applyFilter(type: string): void {
        rows.querySelectorAll<HTMLElement>('.hc-evt').forEach((r) => {
            r.style.display =
                type === 'all' || r.dataset.evt === type ? '' : 'none';
        });
    }

    const toolbar = el('div', 'hc-console-toolbar');
    const clearBtn = el(
        'button',
        'hc-clear',
        s.labels.eventsClear
    ) as HTMLButtonElement;
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', () => {
        rows.replaceChildren(el('p', 'hc-empty', s.labels.eventsEmpty));
        callbacks.onClearEvents?.();
    });
    toolbar.appendChild(clearBtn);
    toolbar.appendChild(
        buildRadioFilter(
            'hc-events-filter',
            EVENT_TYPES.map(({ type, label }) => ({
                value: type,
                label: s.labels[label]
            })),
            initialType,
            s.labels.filterAll,
            (type) => {
                applyFilter(type);
                callbacks.onEventsFilter?.(type);
            }
        )
    );

    if (s.events.length === 0) {
        rows.appendChild(el('p', 'hc-empty', s.labels.eventsEmpty));
    } else {
        s.events.forEach((e: HostEvent) => {
            const row = el('div', `hc-evt hc-evt-${e.type}`);
            row.dataset.evt = e.type;
            // The "context" column shows the descriptive detail: the summary,
            // and the point context appended when present (e.g. update →
            // "type=Data+Resize, viewMode=Edit · rows=42").
            const detail = e.context
                ? `${e.summary} · ${e.context}`
                : e.summary;
            row.appendChild(el('span', 'hc-time', fmtTime(e.ts)));
            row.appendChild(el('span', 'hc-evt-type', e.type));
            row.appendChild(el('span', 'hc-evt-context', detail));
            row.title = detail;
            rows.appendChild(row);
        });
    }
    // Apply the remembered filter to the freshly-built rows.
    applyFilter(initialType);

    // Toolbar stays frozen as the panel header; only the rows body scrolls.
    const body = el('div', 'hc-tab-body');
    body.appendChild(rows);
    wrap.appendChild(toolbar);
    wrap.appendChild(body);
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

/**
 * Build the Raw HTML tab (the default): a frozen header pairing the info banner
 * with a Copy button, an optional truncation note, then a scrolling body of the
 * syntax-highlighted source. The source is built as DOM nodes (not innerHTML)
 * to keep the certified visual's no-innerHTML posture; it is lossless.
 */
const rawTab = (s: DiagnosticsSnapshot): HTMLElement => {
    const wrap = el('div', 'hc-tabpanel hc-raw');
    // Frozen header row: the info banner grows to fill the width and the Copy
    // button shrinks to its right (a simple flex row), instead of Copy
    // stretching full width below the banner.
    const header = el('div', 'hc-raw-header');
    header.appendChild(
        el(
            'p',
            'hc-banner',
            s.sanitizeEnabled ? s.labels.rawBannerSanitized : s.labels.rawBanner
        )
    );
    const copy = el('button', 'hc-copy', s.labels.copy) as HTMLButtonElement;
    copy.type = 'button';
    copy.addEventListener('click', () => copyText(s.rawHtml.text));
    header.appendChild(copy);
    wrap.appendChild(header);
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
    // The header (and truncation note) stay frozen; only the highlighted source
    // body scrolls.
    const body = el('div', 'hc-tab-body');
    const pre = el('pre', 'hc-pre');
    // Built as DOM nodes (not innerHTML) so the certified visual keeps its
    // no-innerHTML posture; lossless — pre.textContent === s.rawHtml.text.
    pre.appendChild(buildHighlightedFragment(s.rawHtml.text));
    body.appendChild(pre);
    wrap.appendChild(body);
    return wrap;
};

/**
 * Build the tabbed diagnostics UI into `host` from `snapshot`. Pure DOM.
 * `callbacks` report tab changes, a console-clear request, and doc-link
 * launches back to the caller (the dialog wires them to the host result).
 */
export const renderPanel = (
    host: HTMLElement,
    snapshot: DiagnosticsSnapshot,
    callbacks: PanelCallbacks = {}
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
            body: sanitizerTab(snapshot, callbacks)
        });
    }
    tabs.push({
        id: 'console',
        label: snapshot.labels.tabConsole,
        body: consoleTab(snapshot, callbacks)
    });
    tabs.push({
        id: 'events',
        label: snapshot.labels.tabEvents,
        body: eventsTab(snapshot, callbacks)
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
            o.body.style.display = on ? 'flex' : 'none';
            buttons[j].setAttribute('aria-selected', String(on));
        });
        callbacks.onTabChange?.(id);
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
        t.body.style.display = t.id === activeId ? 'flex' : 'none';
        btn.addEventListener('click', () => activate(t.id));
        buttons.push(btn);
        bar.appendChild(btn);
        panels.appendChild(t.body);
    });
    host.appendChild(bar);
    host.appendChild(panels);
    // Report the initial active tab so the caller's remembered selection is
    // correct even if the user closes without switching tabs.
    callbacks.onTabChange?.(activeId);
};

/**
 * Host entry point for the diagnostics modal. Given the dialog element, an
 * initial-state snapshot, and the host's setResult/close, it fills the dialog
 * height, renders the panel, and accumulates the result the visual reads on
 * close: the last tab, console/events clear requests, filter picks, and (for a
 * doc link) the doc key. Self-registers below so the packaged config resolves
 * it by id.
 */
export class DiagnosticsDialog {
    static id = VisualConstants.diagnostics.dialogId;
    constructor(
        options: {
            element: HTMLElement;
            host?: {
                setResult?: (state: object) => void;
                close?: (action: number, state?: object) => void;
            };
        },
        initialState: object
    ) {
        const host = options.host;
        // Accumulate the result the visual reads on close: the last tab (so it
        // can reopen there) and a console-clear request. Doc links close the
        // dialog explicitly, carrying the same state plus the doc key.
        const result: {
            lastTab: string;
            clearConsole?: boolean;
            clearEvents?: boolean;
            consoleFilter?: string;
            eventsFilter?: string;
        } = { lastTab: 'raw' };
        // Give the frozen-header flex layout a definite height to size against,
        // otherwise the whole panel scrolls instead of each tab's body.
        fillDialogHeight(options.element);
        renderPanel(options.element, initialState as DiagnosticsSnapshot, {
            onTabChange: (tabId) => {
                result.lastTab = tabId;
                host?.setResult?.({ ...result });
            },
            onClearConsole: () => {
                result.clearConsole = true;
                host?.setResult?.({ ...result });
            },
            onClearEvents: () => {
                result.clearEvents = true;
                host?.setResult?.({ ...result });
            },
            onConsoleFilter: (level) => {
                result.consoleFilter = level;
                host?.setResult?.({ ...result });
            },
            onEventsFilter: (type) => {
                result.eventsFilter = type;
                host?.setResult?.({ ...result });
            },
            onLaunchDoc: (key) =>
                host?.close?.(0 /* DialogAction.Close */, {
                    ...result,
                    launchDoc: key
                })
        });
    }
}

/** The global dialog registry the packaged config resolves dialogs from; the
 * next two lines register DiagnosticsDialog under its id (no webpack entry). */
const g = globalThis as unknown as { dialogRegistry?: Record<string, unknown> };
g.dialogRegistry = g.dialogRegistry || {};
g.dialogRegistry[DiagnosticsDialog.id] = DiagnosticsDialog;
