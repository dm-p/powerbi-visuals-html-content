/** Snapshot assembly (with raw-HTML truncation), icon gating, and icon DOM. */
import { DiagnosticsSnapshot, SanitizerCapture, ConsoleEntry } from './types';
import { VisualConstants } from '../visual-constants';

/** The toggle AND host support are both required; absent capability ⇒ hidden. */
export const shouldShowDiagnosticsIcon = (
    enabled: boolean,
    allowModalDialog: boolean | undefined
): boolean => enabled && allowModalDialog === true;

export const buildSnapshot = (input: {
    rawHtml: string;
    sanitizer: SanitizerCapture;
    console: ConsoleEntry[];
}): DiagnosticsSnapshot => {
    const cap = VisualConstants.diagnostics.rawHtmlCapBytes;
    const total = input.rawHtml.length;
    const truncated = total > cap;
    return {
        sanitizer: input.sanitizer,
        console: input.console,
        rawHtml: {
            text: truncated ? input.rawHtml.slice(0, cap) : input.rawHtml,
            truncated,
            totalLength: total
        }
    };
};

export const createDiagnosticsIcon = (
    onClick: () => void
): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.id = VisualConstants.diagnostics.iconIdSelector;
    btn.type = 'button';
    btn.title = 'HTML Content diagnostics';
    btn.setAttribute('aria-label', 'Open HTML Content diagnostics');
    btn.textContent = '🐞';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
};

export const setIconVisibility = (btn: HTMLElement, visible: boolean): void => {
    // inline-block (not block) so the button's hit-area stays content-sized —
    // it never expands to the container width if U10 positions it without
    // absolute positioning.
    btn.style.display = visible ? 'inline-block' : 'none';
};
