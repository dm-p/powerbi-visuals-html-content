// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import DataViewCategorical = powerbi.DataViewCategorical;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.visuals.ISelectionId;

/**
 * A flattened, row-major representation of a categorical data view, aligned to a
 * uniform column schema. Categories appear first, then values, mirroring the order
 * Power BI uses when routing GroupingOrMeasure role bindings.
 */
export interface ISimulatedTable {
    columns: DataViewMetadataColumn[]; // categories first, then values
    rows: PrimitiveValue[][]; // row-major, aligned to columns
    identities: ISelectionId[]; // one per row
}

/**
 * Returns true when the column source has a roles object with at least one key.
 * Columns injected by calc groups for dynamic format strings have no roles property,
 * and must be excluded to avoid downstream crashes (issue #159).
 */
const hasAnyRole = (source: DataViewMetadataColumn | undefined) =>
    !!source?.roles && Object.keys(source.roles).length > 0;

/**
 * Safe index-based lookup into a nullable values array. Returns null when the
 * array is absent or when the requested index is out of range.
 */
const valueAt = (values: PrimitiveValue[] | undefined, index: number) =>
    values && index < values.length ? values[index] : null;

/**
 * Converts a Power BI categorical data view into a simulated table structure,
 * producing row-major cell data and per-row selection identities. Columns with no
 * recognised roles are silently excluded; an undefined categorical yields an empty
 * result rather than throwing.
 *
 * @param categorical   - The categorical data view to adapt, or undefined.
 * @param host          - The visual host used to build per-row selection identities.
 */
export function mapCategoricalToTable(
    categorical: DataViewCategorical | undefined,
    host: IVisualHost
): ISimulatedTable {
    const categories = (categorical?.categories ?? []).filter((c) =>
        hasAnyRole(c.source)
    );
    const values = Array.from(categorical?.values ?? []).filter((v) =>
        hasAnyRole(v.source)
    );
    // Power BI guarantees all category value arrays are the same length, so the
    // first category is authoritative. The `1` encodes the measure-only
    // single-aggregate-row rule (issue #130).
    const rowCount =
        categories[0]?.values?.length ?? (values.length > 0 ? 1 : 0);
    const columns = [
        ...categories.map((c) => c.source),
        ...values.map((v) => v.source)
    ];
    const rows: PrimitiveValue[][] = [];
    const identities: ISelectionId[] = [];
    for (let i = 0; i < rowCount; i++) {
        rows.push([
            ...categories.map((c) => valueAt(c.values, i)),
            ...values.map((v) => valueAt(v.values, i))
        ]);
        let builder = host.createSelectionIdBuilder();
        categories.forEach((c) => {
            builder = builder.withCategory(c, i);
        });
        values.forEach((v) => {
            if (v.source.queryName) {
                builder = builder.withMeasure(v.source.queryName);
            }
        });
        identities.push(builder.createSelectionId());
    }
    return { columns, rows, identities };
}
