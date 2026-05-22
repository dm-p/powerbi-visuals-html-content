/**
 * Minimal RFC 4180 CSV record splitter. Returns one string per record
 * (header + data rows), correctly handling fields wrapped in double
 * quotes that contain embedded commas, double-quoted escapes (`""`), or
 * newlines.
 *
 * Shared by the three CSV-sync test suites
 * (`lorem-rendering.test.ts`, `hyperlinks-rendering.test.ts`,
 * `stylesheet-rendering.test.ts`). Previously inlined verbatim in each;
 * extracted so the parser stays in lockstep across all suites.
 *
 * Callers don't need per-field parsing — only to count rows and extract
 * the first comma-separated field (the row id) from each record. Each
 * suite's id-format guard tests (asserting ids are comma- and quote-free)
 * make a naive `split(',', 1)[0]` safe on the returned records.
 */
export function parseCsvRecords(csv: string): string[] {
    const records: string[] = [];
    let buf = '';
    let inQuotes = false;
    for (let i = 0; i < csv.length; i++) {
        const ch = csv[i];
        if (inQuotes) {
            if (ch === '"' && csv[i + 1] === '"') {
                buf += '""';
                i++;
                continue;
            }
            if (ch === '"') {
                inQuotes = false;
            }
            buf += ch;
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
            buf += ch;
            continue;
        }
        if (ch === '\n') {
            if (buf.length > 0) records.push(buf);
            buf = '';
            continue;
        }
        if (ch === '\r') continue;
        buf += ch;
    }
    if (buf.length > 0) records.push(buf);
    return records;
}
