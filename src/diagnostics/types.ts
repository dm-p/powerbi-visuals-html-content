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
    ts: number;
    level: ConsoleLevel;
    text: string;
}

export interface DiagnosticsSnapshot {
    sanitizer: SanitizerCapture;
    console: ConsoleEntry[];
    rawHtml: { text: string; truncated: boolean; totalLength: number };
}
