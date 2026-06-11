import { describe, it, expect } from 'vitest';
import { mapCategoricalToTable } from '../src/categorical-table';

interface IRecordedCall {
    method: 'withCategory' | 'withMeasure';
    args: unknown[];
}

const createRecordingBuilder = () => {
    const calls: IRecordedCall[] = [];
    const builder: any = {
        withCategory: (...args: unknown[]) => {
            calls.push({ method: 'withCategory', args });
            return builder;
        },
        withMeasure: (...args: unknown[]) => {
            calls.push({ method: 'withMeasure', args });
            return builder;
        },
        createSelectionId: () => ({ calls, equals: () => false })
    };
    return builder;
};

const mockHost = {
    createSelectionIdBuilder: () => createRecordingBuilder(),
    locale: 'en-US'
} as any;

const categoryCol = (
    roles: Record<string, boolean>,
    displayName: string,
    queryName: string,
    values: unknown[]
) => ({ source: { roles, displayName, queryName }, values });

describe('mapCategoricalToTable', () => {
    describe('happy path', () => {
        it('one sampling category (3 values) + one content measure → 3 rows, correct columns, correct identity chain', () => {
            const catCol = categoryCol(
                { sampling: true },
                'Category',
                'cq',
                ['A', 'B', 'C']
            );
            const valSource = {
                roles: { content: true },
                displayName: 'HTML',
                queryName: 'mq'
            };
            const categorical: any = {
                categories: [catCol],
                values: [{ source: valSource, values: ['<p>1</p>', '<p>2</p>', '<p>3</p>'] }]
            };

            const result = mapCategoricalToTable(categorical, mockHost);

            expect(result.columns).toHaveLength(2);
            expect(result.columns[0]).toBe(catCol.source);
            expect(result.columns[1]).toBe(valSource);
            expect(result.rows).toHaveLength(3);
            expect(result.rows[0]).toEqual(['A', '<p>1</p>']);
            expect(result.rows[1]).toEqual(['B', '<p>2</p>']);
            expect(result.rows[2]).toEqual(['C', '<p>3</p>']);
            expect(result.identities).toHaveLength(3);

            // verify identity chain for row 0: withCategory(catColObject, 0) then withMeasure('mq')
            const calls0 = (result.identities[0] as any).calls as IRecordedCall[];
            expect(calls0).toEqual([
                { method: 'withCategory', args: [catCol, 0] },
                { method: 'withMeasure', args: ['mq'] }
            ]);
            // row 1
            const calls1 = (result.identities[1] as any).calls as IRecordedCall[];
            expect(calls1).toEqual([
                { method: 'withCategory', args: [catCol, 1] },
                { method: 'withMeasure', args: ['mq'] }
            ]);
        });

        it('measure-only (content measure, no categories) → exactly 1 row with aggregate; pure withMeasure identity (issue #130)', () => {
            // Issue #130: when there are no category columns, a single-row aggregate is returned
            const valSource = {
                roles: { content: true },
                displayName: 'Total HTML',
                queryName: 'mq'
            };
            const categorical: any = {
                categories: [],
                values: [{ source: valSource, values: ['<p>agg</p>'] }]
            };

            const result = mapCategoricalToTable(categorical, mockHost);

            expect(result.columns).toHaveLength(1);
            expect(result.columns[0]).toBe(valSource);
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0]).toEqual(['<p>agg</p>']);
            expect(result.identities).toHaveLength(1);

            const calls = (result.identities[0] as any).calls as IRecordedCall[];
            expect(calls).toEqual([{ method: 'withMeasure', args: ['mq'] }]);
        });

        it('column-only (content as grouping column, no measures) → one row per category entry; pure withCategory identities', () => {
            const catCol = categoryCol(
                { content: true },
                'HTML Col',
                'cq',
                ['<p>X</p>', '<p>Y</p>']
            );
            const categorical: any = {
                categories: [catCol],
                values: []
            };

            const result = mapCategoricalToTable(categorical, mockHost);

            expect(result.columns).toHaveLength(1);
            expect(result.columns[0]).toBe(catCol.source);
            expect(result.rows).toHaveLength(2);
            expect(result.rows[0]).toEqual(['<p>X</p>']);
            expect(result.rows[1]).toEqual(['<p>Y</p>']);
            expect(result.identities).toHaveLength(2);

            const calls0 = (result.identities[0] as any).calls as IRecordedCall[];
            expect(calls0).toEqual([{ method: 'withCategory', args: [catCol, 0] }]);
            const calls1 = (result.identities[1] as any).calls as IRecordedCall[];
            expect(calls1).toEqual([{ method: 'withCategory', args: [catCol, 1] }]);
        });

        it('multiple sampling columns + content measure + tooltip measure → row zip is categories-then-values; identity chains every category then every measure', () => {
            const catCol1 = categoryCol({ sampling: true }, 'Region', 'rq', ['East', 'West']);
            const catCol2 = categoryCol({ sampling: true }, 'Product', 'pq', ['Foo', 'Bar']);
            const contentSource = {
                roles: { content: true },
                displayName: 'HTML',
                queryName: 'mq1'
            };
            const tooltipSource = {
                roles: { tooltips: true },
                displayName: 'Value',
                queryName: 'mq2'
            };
            const categorical: any = {
                categories: [catCol1, catCol2],
                values: [
                    { source: contentSource, values: ['<p>A</p>', '<p>B</p>'] },
                    { source: tooltipSource, values: [100, 200] }
                ]
            };

            const result = mapCategoricalToTable(categorical, mockHost);

            expect(result.columns).toHaveLength(4);
            expect(result.columns[0]).toBe(catCol1.source);
            expect(result.columns[1]).toBe(catCol2.source);
            expect(result.columns[2]).toBe(contentSource);
            expect(result.columns[3]).toBe(tooltipSource);

            expect(result.rows[0]).toEqual(['East', 'Foo', '<p>A</p>', 100]);
            expect(result.rows[1]).toEqual(['West', 'Bar', '<p>B</p>', 200]);

            const calls0 = (result.identities[0] as any).calls as IRecordedCall[];
            expect(calls0).toEqual([
                { method: 'withCategory', args: [catCol1, 0] },
                { method: 'withCategory', args: [catCol2, 0] },
                { method: 'withMeasure', args: ['mq1'] },
                { method: 'withMeasure', args: ['mq2'] }
            ]);
        });
    });

    describe('edge cases', () => {
        it('edge (#159): value column with no roles key is excluded from columns, rows, and identity — does not throw', () => {
            // calc-group dynamic-format-string columns arrive with no roles property at all
            const goodSource = {
                roles: { content: true },
                displayName: 'HTML',
                queryName: 'mq'
            };
            const badSource = {
                // no roles key at all (calc group dynamic format string shape)
                displayName: '__Format',
                queryName: 'fq'
            } as any;
            const categorical: any = {
                categories: [],
                values: [
                    { source: goodSource, values: ['<p>ok</p>'] },
                    { source: badSource, values: ['@£$'] }
                ]
            };

            const result = mapCategoricalToTable(categorical, mockHost);

            expect(result.columns).toHaveLength(1);
            expect(result.columns[0]).toBe(goodSource);
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0]).toHaveLength(1);
            expect(result.rows[0][0]).toBe('<p>ok</p>');

            const calls = (result.identities[0] as any).calls as IRecordedCall[];
            expect(calls).toEqual([{ method: 'withMeasure', args: ['mq'] }]);
        });

        it('edge: column with roles: {} (empty object) is excluded', () => {
            const goodSource = {
                roles: { content: true },
                displayName: 'HTML',
                queryName: 'mq'
            };
            const emptyRolesSource = {
                roles: {},
                displayName: 'Ghost',
                queryName: 'gq'
            };
            const categorical: any = {
                categories: [],
                values: [
                    { source: goodSource, values: ['<p>ok</p>'] },
                    { source: emptyRolesSource, values: ['ignored'] }
                ]
            };

            const result = mapCategoricalToTable(categorical, mockHost);

            expect(result.columns).toHaveLength(1);
            expect(result.columns[0]).toBe(goodSource);
            expect(result.rows[0]).toEqual(['<p>ok</p>']);
        });

        it('edge: undefined categorical → empty result', () => {
            const result = mapCategoricalToTable(undefined, mockHost);

            expect(result.columns).toEqual([]);
            expect(result.rows).toEqual([]);
            expect(result.identities).toEqual([]);
        });

        it('edge: categorical with empty categories and empty values → empty result', () => {
            const categorical: any = { categories: [], values: [] };

            const result = mapCategoricalToTable(categorical, mockHost);

            expect(result.columns).toEqual([]);
            expect(result.rows).toEqual([]);
            expect(result.identities).toEqual([]);
        });

        it('edge: length mismatch (category 3 values, measure 2) → 3 rows; missing measure cell is null; no throw', () => {
            const catCol = categoryCol(
                { sampling: true },
                'Category',
                'cq',
                ['A', 'B', 'C']
            );
            const valSource = {
                roles: { content: true },
                displayName: 'HTML',
                queryName: 'mq'
            };
            const categorical: any = {
                categories: [catCol],
                values: [{ source: valSource, values: ['<p>1</p>', '<p>2</p>'] }]
            };

            const result = mapCategoricalToTable(categorical, mockHost);

            expect(result.rows).toHaveLength(3);
            expect(result.rows[0]).toEqual(['A', '<p>1</p>']);
            expect(result.rows[1]).toEqual(['B', '<p>2</p>']);
            expect(result.rows[2]).toEqual(['C', null]);
        });

        it('edge: value column without queryName contributes cell values but adds no withMeasure call', () => {
            const valSource = {
                roles: { content: true },
                displayName: 'HTML'
                // no queryName
            };
            const categorical: any = {
                categories: [],
                values: [{ source: valSource, values: ['<p>no-qn</p>'] }]
            };

            const result = mapCategoricalToTable(categorical, mockHost);

            expect(result.rows).toHaveLength(1);
            expect(result.rows[0]).toEqual(['<p>no-qn</p>']);

            const calls = (result.identities[0] as any).calls as IRecordedCall[];
            expect(calls).toHaveLength(0);
        });
    });
});
