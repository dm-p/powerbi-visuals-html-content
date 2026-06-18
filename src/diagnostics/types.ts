/** Shared types for the diagnostics dialog snapshot and its producers. */

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

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
}

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
}
