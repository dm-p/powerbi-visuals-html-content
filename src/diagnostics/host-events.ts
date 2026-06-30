/**
 * Pure formatters for the diagnostics host-event log. No DOM, no powerbi host
 * services — just value-in/string-out so they're trivially testable.
 */
import powerbi from 'powerbi-visuals-api';
import { VisualConstants } from '../visual-constants';

/** A {displayName, value} pair, as carried by IHtmlEntry.tooltips. */
export interface TooltipItem {
    displayName: string;
    value: string;
}

// VisualUpdateType is a bitflag enum; decode by name so we never hard-code its
// numeric values (which are an API detail).
const UPDATE_FLAGS: ReadonlyArray<[number, string]> = [
    [powerbi.VisualUpdateType.Data, 'Data'],
    [powerbi.VisualUpdateType.Resize, 'Resize'],
    [powerbi.VisualUpdateType.ViewMode, 'ViewMode'],
    [powerbi.VisualUpdateType.Style, 'Style'],
    [powerbi.VisualUpdateType.ResizeEnd, 'ResizeEnd']
];

/** Decode a VisualUpdateType bitmask to "Data+Resize"; numeric fallback. */
export const describeUpdateType = (type: number): string => {
    const names = UPDATE_FLAGS.filter(([bit]) => (type & bit) === bit).map(
        ([, name]) => name
    );
    return names.length ? names.join('+') : String(type);
};

/** Bounded "field=value, … (+k more)" from tooltip items. Empty → "". */
export const formatTooltipItems = (
    items: TooltipItem[],
    maxItems: number,
    valueCap: number
): string => {
    if (!items || items.length === 0) return '';
    const shown = items.slice(0, maxItems).map((i) => {
        // Power BI can pass null/undefined values for null measure results.
        const raw = i.value ?? '';
        const v = raw.length > valueCap ? `${raw.slice(0, valueCap)}…` : raw;
        return `${i.displayName}="${v}"`;
    });
    const extra = items.length - maxItems;
    return extra > 0
        ? `${shown.join(', ')} (+${extra} more)`
        : shown.join(', ');
};

/** formatTooltipItems with the visual's default event-context caps applied. */
export const tooltipContext = (items: TooltipItem[]): string =>
    formatTooltipItems(
        items ?? [],
        VisualConstants.diagnostics.eventContextItems,
        VisualConstants.diagnostics.eventContextCap
    );

/** "@ (x,y)" from a pointer event, for the event-context coordinate prefix. */
export const eventCoords = (event: MouseEvent): string =>
    `@ (${event.clientX},${event.clientY})`;
