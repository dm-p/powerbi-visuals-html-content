import { describe, it, expect, vi, afterEach } from 'vitest';
import type powerbi from 'powerbi-visuals-api';

// Same constructor-completion workaround as test/diagnostics-wiring.test.ts:
// the repo's VisualBuilder harness needs powerbi-visuals-utils-testutils
// (not installed), and the global test/setup.ts mock of
// powerbi-visuals-utils-interactivityutils doesn't expose
// createInteractivitySelectionService, which the Visual constructor calls.
// Construct the Visual directly with a minimal host stub, overriding the
// interactivity-service mock for this file only.
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

/**
 * Wiring coverage for the branch's riskiest new code: `update()`'s
 * resolveCompatibilityForUpdate + flushCompatibilityPersist path
 * (src/visual.ts), which defers host.persistProperties via setTimeout until
 * AFTER the update's renderingFinished/renderingFailed has fired (see the
 * comment above flushCompatibilityPersist). This pins that ordering plus the
 * once-per-session persist guard and the destroy() cancellation, none of
 * which src/compatibility.test.ts (pure decision function) can see.
 */

// VisualUpdateType.Data, per test/setup.ts's powerbi-visuals-api mock and
// render-orchestrator.ts's DATA_BIT (const-enums aren't inlined by vitest).
const DATA_TYPE = 1 << 1;

/** A dataView whose metadata carries the `content` role (data bound), with
 * zero actual rows — sufficient for dataViewHasContentRole() and for a valid,
 * empty-but-successful render (isEmpty branch), without needing
 * host.createSelectionIdBuilder(). */
const dataBoundDataView = (
    compatibilityObject?: Record<string, unknown>
): powerbi.DataView =>
    ({
        metadata: {
            columns: [{ roles: { content: true }, displayName: 'HTML' }],
            objects: compatibilityObject
                ? { compatibility: compatibilityObject }
                : undefined
        },
        categorical: {
            categories: [
                {
                    source: { roles: { content: true }, displayName: 'HTML' },
                    values: []
                }
            ]
        }
    }) as unknown as powerbi.DataView;

/** No content role at all: validateDataView resolves isValid=false, which
 * renderUpdate treats as an error (throws → renderingFailed). Used for the
 * "fresh visual, no data" cases — see the note on test 3 below. */
const noContentDataView = (): powerbi.DataView =>
    ({
        metadata: {
            columns: [{ roles: { sampling: true }, displayName: 'Category' }]
        },
        categorical: {
            categories: [
                {
                    source: {
                        roles: { sampling: true },
                        displayName: 'Category'
                    },
                    values: []
                }
            ]
        }
    }) as unknown as powerbi.DataView;

const buildVisual = (): {
    root: HTMLElement;
    visual: any;
    persistProperties: ReturnType<typeof vi.fn>;
    renderingFinished: ReturnType<typeof vi.fn>;
    renderingFailed: ReturnType<typeof vi.fn>;
    callOrder: string[];
} => {
    const root = document.createElement('div');
    const callOrder: string[] = [];
    const persistProperties = vi.fn(() => {
        callOrder.push('persistProperties');
    });
    const renderingFinished = vi.fn(() => {
        callOrder.push('renderingFinished');
    });
    const renderingFailed = vi.fn(() => {
        callOrder.push('renderingFailed');
    });
    const host: any = {
        createLocalizationManager: () => ({
            getDisplayName: (key: string) => key
        }),
        eventService: {
            renderingStarted: () => undefined,
            renderingFinished,
            renderingFailed
        },
        hostCapabilities: { allowModalDialog: false, allowInteractions: false },
        colorPalette: { isHighContrast: false },
        persistProperties,
        launchUrl: vi.fn()
    };
    const visual = new Visual({ element: root, host } as any);
    return {
        root,
        visual,
        persistProperties,
        renderingFinished,
        renderingFailed,
        callOrder
    };
};

const update = (
    visual: any,
    dataViews: powerbi.DataView[],
    viewMode: 0 | 1
): void => {
    visual.update({
        type: DATA_TYPE,
        viewMode,
        dataViews,
        viewport: { width: 200, height: 200 }
    } as unknown as powerbi.extensibility.visual.VisualUpdateOptions);
};

describe('compatibility persist wiring', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('edit-mode unstamped + data bound: persists legacy ON exactly once, after the rendering event, once per session', () => {
        vi.useFakeTimers();
        const {
            visual,
            persistProperties,
            renderingFinished,
            renderingFailed,
            callOrder
        } = buildVisual();

        update(visual, [dataBoundDataView()], 1);

        // Rendering-event ordering: by the time update() returns, the
        // rendering event pair for this update has already fired (either
        // finished or failed — renderUpdate's try/catch means exactly one of
        // the two), but persistProperties has NOT been called yet — it's
        // deferred behind the setTimeout(0) in flushCompatibilityPersist.
        const renderingEventFired =
            renderingFinished.mock.calls.length +
            renderingFailed.mock.calls.length;
        expect(renderingEventFired).toBe(1);
        expect(persistProperties).not.toHaveBeenCalled();

        vi.runAllTimers();

        expect(persistProperties).toHaveBeenCalledTimes(1);
        const call = persistProperties.mock.calls[0][0];
        expect(call.merge[0].objectName).toBe('compatibility');
        expect(call.merge[0].properties.legacyRendering).toBe(true);
        // The rendering event must precede the persist call in the shared
        // sequence log — this is the ordering the deferred setTimeout exists
        // to guarantee (spec: update-cycle discipline).
        expect(callOrder.indexOf('persistProperties')).toBeGreaterThan(
            Math.max(
                callOrder.indexOf('renderingFinished'),
                callOrder.indexOf('renderingFailed')
            )
        );

        // Second update, still unstamped (no compatibility object echoed
        // back yet, as a real host wouldn't have re-delivered it inside a
        // single fake-timer tick) — the once-per-session guard must hold.
        update(visual, [dataBoundDataView()], 1);
        vi.runAllTimers();
        expect(persistProperties).toHaveBeenCalledTimes(1);

        visual.destroy();
    });

    it('view mode never persists', () => {
        vi.useFakeTimers();
        const {
            visual,
            persistProperties,
            renderingFinished,
            renderingFailed
        } = buildVisual();

        update(visual, [dataBoundDataView()], 0);
        vi.runAllTimers();

        expect(persistProperties).not.toHaveBeenCalled();
        expect(
            renderingFinished.mock.calls.length +
                renderingFailed.mock.calls.length
        ).toBe(1);

        visual.destroy();
    });

    it('fresh visual (no data) in edit mode stamps modern OFF', () => {
        // No content-role column ⇒ the view model is invalid, which
        // renderUpdate treats as a failure (throws → renderingFailed fires
        // instead of renderingFinished). resolveCompatibilityForUpdate and
        // flushCompatibilityPersist both run regardless of that outcome (the
        // persist scheduling happens before the try/catch in update(), and
        // the flush happens unconditionally after it), so the classification
        // and persist contract under test still holds — only the fired event
        // differs from the data-bound case. Acceptable per task brief.
        vi.useFakeTimers();
        const {
            visual,
            persistProperties,
            renderingFinished,
            renderingFailed
        } = buildVisual();

        update(visual, [noContentDataView()], 1);

        expect(renderingFailed).toHaveBeenCalledTimes(1);
        expect(renderingFinished).not.toHaveBeenCalled();

        vi.runAllTimers();

        expect(persistProperties).toHaveBeenCalledTimes(1);
        const call = persistProperties.mock.calls[0][0];
        expect(call.merge[0].properties.legacyRendering).toBe(false);

        visual.destroy();
    });

    it('destroy() cancels the pending stamp', () => {
        vi.useFakeTimers();
        const { visual, persistProperties } = buildVisual();

        update(visual, [dataBoundDataView()], 1);
        visual.destroy();
        vi.runAllTimers();

        expect(persistProperties).not.toHaveBeenCalled();
    });

    it('a persisted marker suppresses persistence and drives the legacy styling class', () => {
        vi.useFakeTimers();
        const { root, visual, persistProperties } = buildVisual();

        update(visual, [dataBoundDataView({ legacyRendering: true })], 1);
        vi.runAllTimers();
        expect(persistProperties).not.toHaveBeenCalled();

        const content = root.querySelector(
            '#' + VisualConstants.dom.contentIdSelector
        ) as HTMLElement;
        expect(content.classList.contains('hc-legacy-v1')).toBe(true);

        update(visual, [dataBoundDataView({ legacyRendering: false })], 1);
        vi.runAllTimers();
        expect(persistProperties).not.toHaveBeenCalled();
        expect(content.classList.contains('hc-legacy-v1')).toBe(false);

        visual.destroy();
    });
});
