import { describe, it, expect, vi } from 'vitest';

// The repo's test/VisualBuilder.ts harness depends on
// `powerbi-visuals-utils-testutils`, which is NOT installed in this project
// (and would require a package.json/lockfile change to add). Additionally the
// global test/setup.ts mock of `powerbi-visuals-utils-interactivityutils` does
// not expose `createInteractivitySelectionService`, which the Visual
// constructor calls. We therefore construct the Visual directly here with a
// minimal host stub, and override the interactivity-service mock for THIS file
// so the constructor can complete. The icon is appended to the visual root in
// the constructor, so a direct construction is sufficient to assert it.
vi.mock('powerbi-visuals-utils-interactivityutils', () => ({
    interactivitySelectionService: {
        SelectableDataPoint: {},
        createInteractivitySelectionService: () => ({ bind: vi.fn() })
    },
    interactivityBaseService: {
        IInteractivityService: {},
        ISelectionHandler: {}
    }
}));

import { Visual } from '../src/visual';
import { VisualConstants } from '../src/visual-constants';

const buildVisual = (
    hostOverrides: Record<string, any> = {}
): { root: HTMLElement; visual: any } => {
    const root = document.createElement('div');
    const host: any = {
        createLocalizationManager: () => ({
            getDisplayName: (key: string) => key
        }),
        eventService: {
            renderingStarted: () => undefined,
            renderingFinished: () => undefined,
            renderingFailed: () => undefined
        },
        hostCapabilities: { allowModalDialog: false, allowInteractions: false },
        colorPalette: {
            isHighContrast: false
        },
        ...hostOverrides
    };
    const visual = new Visual({ element: root, host } as any);
    return { root, visual };
};

// Drive the document-level Ctrl+D hotkey the visual binds in its constructor.
const pressHotkey = (): void =>
    document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', ctrlKey: true })
    );

describe('diagnostics wiring', () => {
    it('appends a hidden diagnostics icon on construction', () => {
        const { root } = buildVisual();
        const icon = root.querySelector(
            '#htmlDiagnosticsToggle'
        ) as HTMLElement;
        expect(icon).toBeTruthy();
        expect(icon.style.display).toBe('none');
    });

    it('openDiagnostics is single-flight: a second hotkey press mid-open does not open a second dialog', () => {
        // A promise that never resolves keeps the open "in flight" so the
        // re-entrancy guard is what must block the second press.
        const openModalDialog = vi.fn(() => new Promise<never>(() => {}));
        const { visual } = buildVisual({
            hostCapabilities: {
                allowModalDialog: true,
                allowInteractions: false
            },
            openModalDialog,
            launchUrl: vi.fn()
        });
        // update() sets these; force the minimum the hotkey → openDiagnostics
        // path needs (an empty stylesheet value skips stylesheet serialization).
        visual.formattingSettings = {
            stylesheet: { stylesheetCardMain: { stylesheet: { value: '' } } }
        };
        visual.diagActive = true;
        pressHotkey();
        pressHotkey();
        expect(openModalDialog).toHaveBeenCalledTimes(1);
        // Detach this instance's listener so it can't leak into later tests.
        visual.destroy();
    });

    it('destroy() detaches the keydown hotkey so a torn-down instance ignores Ctrl/Cmd+D', () => {
        const openModalDialog = vi.fn(() => new Promise<never>(() => {}));
        const { visual } = buildVisual({
            hostCapabilities: {
                allowModalDialog: true,
                allowInteractions: false
            },
            openModalDialog,
            launchUrl: vi.fn()
        });
        visual.diagActive = true;
        visual.destroy();
        pressHotkey();
        expect(openModalDialog).not.toHaveBeenCalled();
    });
});

// The constructor appends two <style> elements to <head> — the user stylesheet
// (#visualUserStylesheet, rewritten via .text() on every update) and the
// theme-vars block (#pbiThemeVars, written once). Both use a remove-before-
// append guard so re-instantiation (a theme/contrast switch re-runs the
// constructor in the same document — and tests build many instances in one
// jsdom document) never accumulates duplicates, and destroy() removes them.
describe('constructor <head> style hygiene', () => {
    const ssId = VisualConstants.dom.stylesheetIdSelector;
    const tvId = VisualConstants.dom.themeVarsIdSelector;
    const headCount = (id: string): number =>
        document.head.querySelectorAll('#' + id).length;

    it('keeps exactly one of each across re-instantiation (no accumulation)', () => {
        const a = buildVisual();
        const b = buildVisual();
        const c = buildVisual();
        expect(headCount(ssId)).toBe(1);
        expect(headCount(tvId)).toBe(1);
        // Clean up: detaches each instance's hotkey listener + head <style>.
        a.visual.destroy();
        b.visual.destroy();
        c.visual.destroy();
    });

    it('destroy() removes the instance head <style> elements', () => {
        const { visual } = buildVisual();
        expect(headCount(ssId)).toBe(1);
        expect(headCount(tvId)).toBe(1);
        visual.destroy();
        expect(headCount(ssId)).toBe(0);
        expect(headCount(tvId)).toBe(0);
    });
});
