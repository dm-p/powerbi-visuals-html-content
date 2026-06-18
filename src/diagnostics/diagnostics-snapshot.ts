/** Snapshot assembly (with raw-HTML truncation), icon gating, and icon DOM. */
import {
    DiagnosticsSnapshot,
    SanitizerCapture,
    ConsoleEntry,
    DiagnosticsLabels
} from './types';
import { VisualConstants } from '../visual-constants';

/**
 * Diagnostics is active only when ALL three hold: the toggle is on, the host
 * supports modal dialogs (Desktop + Service), AND the report is being edited.
 * Gating on edit mode keeps diagnostics (icon and recording) out of view mode,
 * so report consumers are never shown more than necessary. Fail-closed: an
 * absent capability or non-edit/unknown view mode hides it.
 */
export const shouldShowDiagnosticsIcon = (
    enabled: boolean,
    allowModalDialog: boolean | undefined,
    isEditMode: boolean
): boolean => enabled && allowModalDialog === true && isEditMode;

export const buildSnapshot = (input: {
    rawHtml: string;
    sanitizer: SanitizerCapture;
    console: ConsoleEntry[];
    labels: DiagnosticsLabels;
}): DiagnosticsSnapshot => {
    const cap = VisualConstants.diagnostics.rawHtmlCapBytes;
    const total = input.rawHtml.length;
    const truncated = total > cap;
    return {
        sanitizer: input.sanitizer,
        console: input.console,
        labels: input.labels,
        rawHtml: {
            text: truncated ? input.rawHtml.slice(0, cap) : input.rawHtml,
            truncated,
            totalLength: total
        }
    };
};

/**
 * Build the diagnostics icon. `title`/`ariaLabel` are passed in already
 * localized (the visual owns the ILocalizationManager) so this DOM helper stays
 * pure and free of any powerbi-visuals-api dependency.
 */
export const createDiagnosticsIcon = (
    onClick: () => void,
    title: string,
    ariaLabel: string
): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.id = VisualConstants.diagnostics.iconIdSelector;
    btn.type = 'button';
    btn.title = title;
    btn.setAttribute('aria-label', ariaLabel);
    btn.textContent = '🐞';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
};

export const setIconVisibility = (btn: HTMLElement, visible: boolean): void => {
    // inline-block (not block) keeps the button's hit-area content-sized. The
    // visual also absolutely-positions the icon via CSS (#htmlDiagnosticsToggle
    // in visual.less); inline-block is harmless there and safe if that CSS is
    // ever absent.
    btn.style.display = visible ? 'inline-block' : 'none';
};
