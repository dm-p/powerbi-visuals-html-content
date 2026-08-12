import { describe, it, expect } from 'vitest';
import { describeUpdateType, formatTooltipItems } from '../src/diagnostics/host-events';
import powerbi from 'powerbi-visuals-api';

describe('describeUpdateType', () => {
    it('joins the set flag names with +', () => {
        const t =
            powerbi.VisualUpdateType.Data | powerbi.VisualUpdateType.Resize;
        expect(describeUpdateType(t)).toBe('Data+Resize');
    });
    it('falls back to the numeric value when no known flag matches', () => {
        expect(describeUpdateType(0)).toBe('0');
    });
});

describe('formatTooltipItems', () => {
    const items = [
        { displayName: 'Employee[FullName]', value: 'A. Smith' },
        { displayName: 'Sales', value: '100' },
        { displayName: 'Region', value: 'East' },
        { displayName: 'Qty', value: '4' }
    ];
    it('formats field=value, first N, with a (+k more) marker', () => {
        expect(formatTooltipItems(items, 2, 80)).toBe(
            'Employee[FullName]="A. Smith", Sales="100" (+2 more)'
        );
    });
    it('caps each value length', () => {
        const long = [{ displayName: 'k', value: 'x'.repeat(200) }];
        const out = formatTooltipItems(long, 3, 10);
        expect(out).toContain('k="xxxxxxxxxx…"');
    });
    it('returns empty string for no items', () => {
        expect(formatTooltipItems([], 3, 80)).toBe('');
    });
    it('treats a null/undefined item value as empty', () => {
        const out = formatTooltipItems(
            [{ displayName: 'k', value: null as unknown as string }],
            3,
            80
        );
        expect(out).toBe('k=""');
    });
});

it('formats a single known update flag without a trailing +', () => {
    expect(describeUpdateType(powerbi.VisualUpdateType.Data)).toBe('Data');
});
