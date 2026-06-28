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
