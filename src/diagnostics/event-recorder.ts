/**
 * Passive host-event recorder for the diagnostics Events tab. A bounded ring
 * buffer that is a NO-OP unless armed — armed only while diagnostics is active
 * (the visual's diagActive gate), so there is zero cost in view mode or when the
 * toggle is off. Mirrors console-capture's buffer discipline; iframe-scoped.
 *
 * Imports only the pure types/constants — no dialog/UI, no powerbi host service.
 */
import { HostEvent, HostEventType, TooltipPhase, TooltipSource } from './types';
import { VisualConstants } from '../visual-constants';

let armed = false;
let buffer: HostEvent[] = [];
// Decision 9: dedup key of the LAST RECORDED tooltip event, so consecutive
// identical (phase, source, context) tooltip events collapse to one.
let lastTooltipKey: string | undefined;

export const setArmed = (value: boolean): void => {
    armed = value;
};

const push = (e: HostEvent): void => {
    buffer.push(e);
    while (buffer.length > VisualConstants.diagnostics.eventBufferCap) {
        buffer.shift();
    }
};

/** Record a host event. No-op unless armed. Self-guarded — never throws into
 *  the render/interaction paths that call it. */
export const recordEvent = (
    type: HostEventType,
    summary: string,
    context?: string
): void => {
    if (!armed) return;
    try {
        push({ ts: Date.now(), type, summary, context });
    } catch {
        /* diagnostics must never break the visual */
    }
};

/** Record a tooltip event with Decision 9/10 de-duplication. No-op unless
 *  armed. The dedup key includes source so standard/manual never collapse. */
export const recordTooltipEvent = (
    phase: TooltipPhase,
    source: TooltipSource,
    context: string
): void => {
    if (!armed) return;
    const key = `${phase}|${source}|${context}`;
    if (key === lastTooltipKey) return;
    lastTooltipKey = key;
    recordEvent('tooltip', `${phase} · ${source}`, context || undefined);
};

export const snapshot = (): HostEvent[] => buffer.slice();

/** Empty the buffer (the Clear affordance) and reset tooltip dedup so the next
 *  show always logs. Does not disarm. */
export const clear = (): void => {
    buffer = [];
    lastTooltipKey = undefined;
};

/** Test-only: full reset (disarm, empty, clear dedup). */
export const resetForTests = (): void => {
    armed = false;
    buffer = [];
    lastTooltipKey = undefined;
};
