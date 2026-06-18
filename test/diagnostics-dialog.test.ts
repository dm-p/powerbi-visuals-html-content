import { describe, it, expect } from 'vitest';
import {
    renderPanel,
    DiagnosticsDialog
} from '../src/diagnostics/diagnostics-dialog';
import { DiagnosticsSnapshot } from '../src/diagnostics/types';
import { VisualConstants } from '../src/visual-constants';

const snap = (
    over: Partial<DiagnosticsSnapshot> = {}
): DiagnosticsSnapshot => ({
    sanitizer: { entries: [], overflow: 0 },
    console: [],
    rawHtml: { text: '<p>hi</p>', truncated: false, totalLength: 9 },
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
