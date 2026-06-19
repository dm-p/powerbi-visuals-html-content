/** Shared types for the diagnostics dialog snapshot and its producers. */

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

export type HostEventType = 'update' | 'cross-filter' | 'tooltip' | 'drill';
export type TooltipPhase = 'show' | 'hide';
export type TooltipSource = 'standard' | 'manual';

/** One captured visual-host event for the diagnostics Events tab. */
export interface HostEvent {
    /** Unix epoch ms (Date.now()). */
    ts: number;
    type: HostEventType;
    /** Short headline, e.g. "type=Data+Resize, viewMode=Edit" or "show · standard". */
    summary: string;
    /** Optional bounded detail, e.g. 'Employee[FullName]="A. Smith" (+1 more)'. */
    context?: string;
}

/** One sanitizer removal: a stripped attribute, element, CSS declaration, or core tag. */
export interface SanitizerEntry {
    kind: 'attr' | 'element' | 'css' | 'tag';
    /** Human-readable subject, e.g. `onclick on <div>` or `<script>`. */
    subject: string;
    /** Rule label that fired, e.g. `event-handler` or `disallowed-url-scheme`. */
    rule: string;
    /** Optional truncated value snippet for context. */
    snippet?: string;
}

export interface SanitizerCapture {
    entries: SanitizerEntry[];
    /** Count of removals dropped after the entry cap was reached. */
    overflow: number;
}

export interface ConsoleEntry {
    /** Unix epoch timestamp in milliseconds (Date.now()). */
    ts: number;
    level: ConsoleLevel;
    text: string;
}

/**
 * Localized UI strings the dialog renders. The dialog runs in its own iframe
 * (only an IDialogHost, no localization manager), so the visual resolves these
 * via its ILocalizationManager and passes them in the snapshot. `overflow` and
 * `truncated` are templates: `{0}`/`{1}` are substituted at render time.
 */
export interface DiagnosticsLabels {
    tabSanitizer: string;
    tabConsole: string;
    tabRaw: string;
    sanitizerEmpty: string;
    consoleEmpty: string;
    colKind: string;
    colSubject: string;
    colRule: string;
    /** Template, `{0}` = overflow count. */
    overflow: string;
    /** Template, `{0}` = shown chars, `{1}` = total chars. */
    truncated: string;
    copy: string;
    consoleClear: string;
    docsHeading: string;
    docsSanitization: string;
    docsAcceptedTags: string;
    /** Raw HTML banner — unsanitized editions. */
    rawBanner: string;
    /** Raw HTML banner — sanitized (lite) edition. */
    rawBannerSanitized: string;
    // Events tab.
    tabEvents: string;
    eventsEmpty: string;
    colTime: string;
    colEvent: string;
    colContext: string;
    eventsClear: string;
    /** Per-type filter labels. */
    evtUpdate: string;
    evtCrossFilter: string;
    evtTooltip: string;
    evtDrill: string;
    /** Radio-filter "show everything" option (Console + Events). */
    filterAll: string;
}

/** Doc pages the Sanitizer tab links to (launched by the visual via launchUrl). */
export type DiagnosticsDocKey = 'sanitization' | 'acceptedTags';

export interface DiagnosticsSnapshot {
    sanitizer: SanitizerCapture;
    console: ConsoleEntry[];
    rawHtml: { text: string; truncated: boolean; totalLength: number };
    labels: DiagnosticsLabels;
    /**
     * Whether this edition runs the sanitizer (config.sanitize). The Sanitizer
     * tab is shown only when true — it's meaningless in the unsanitized
     * standard/standalone editions, where the sanitizer never runs.
     */
    sanitizeEnabled: boolean;
    /**
     * Tab to open on (the visual's remembered selection for the session). The
     * dialog falls back to the first tab when this is absent or unavailable.
     */
    initialTab?: string;
    /** Captured visual host events (update/cross-filter/tooltip/drill). */
    events: HostEvent[];
    /**
     * Remembered Console level filter for the session ('all' or a single level),
     * so the selection is sticky across open/close like the active tab. Defaults
     * to 'all' when absent.
     */
    consoleFilter?: string;
    /** Remembered Events type filter for the session ('all' or a single type). */
    eventsFilter?: string;
}
