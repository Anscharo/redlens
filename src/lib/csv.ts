// Shared CSV builder + download trigger for the /reports/* exports. Every field
// is RFC-4180 quoted and embedded quotes are doubled ("→""), so values that
// contain commas, quotes, or newlines (e.g. an assessed atlas paragraph)
// round-trip cleanly. Reports build rows in their pure src/lib/*Index.ts module
// via toCSV(), then hand the string to downloadCSV() from the component.

export type CsvCell = string | number | null | undefined;

function escapeCell(v: CsvCell): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// Rows are joined with CRLF per RFC 4180. A trailing header with no rows is
// still valid CSV (header line only).
export function toCSV(headers: string[], rows: readonly CsvCell[][]): string {
  const head = headers.map(escapeCell).join(",");
  const body = rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  return body ? `${head}\r\n${body}` : head;
}

// Triggers a client-side download of `csv` as `filename`. Revokes the object
// URL after the click so the blob is not retained.
export function downloadCSV(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
