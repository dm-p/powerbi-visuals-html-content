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

const buildVisual = (): { root: HTMLElement } => {
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
        hostCapabilities: { allowModalDialog: false, allowInteractions: false }
    };
    new Visual({ element: root, host } as any);
    return { root };
};

describe('diagnostics wiring', () => {
    it('appends a hidden diagnostics icon on construction', () => {
        const { root } = buildVisual();
        const icon = root.querySelector(
            '#htmlDiagnosticsToggle'
        ) as HTMLElement;
        expect(icon).toBeTruthy();
        expect(icon.style.display).toBe('none');
    });
});
