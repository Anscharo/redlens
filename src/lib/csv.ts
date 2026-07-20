// Shared, DOM-free CSV builder for the /reports/* exports. Every field is
// RFC-4180 quoted and embedded quotes are doubled ("→""), so values that
// contain commas, quotes, or newlines (e.g. an assessed atlas paragraph)
// round-trip cleanly. Reports build rows in their pure src/lib/*Index.ts module
// via toCSV(), then hand the string to downloadCSV() (src/lib/csvDownload.ts)
// from the component. Kept DOM-free so server-side report builders can import
// toCSV without pulling `document` into the server tsconfig.

export type CsvCell = string | number | null | undefined;

// CSV injection guard: a spreadsheet treats a string cell that opens with
// =, +, -, @ (or a leading tab/CR) as a formula, so an Atlas title/quote like
// "=cmd|…" could execute on open. Prefix such strings with a single quote so
// the spreadsheet renders them as literal text. Numbers are exempt — a JS
// number can't carry a payload, and neutralizing would corrupt legitimate
// negatives (e.g. a -30 "days until stale").
function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function escapeCell(v: CsvCell): string {
  const s = v == null ? "" : typeof v === "number" ? String(v) : neutralizeFormula(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// Rows are joined with CRLF per RFC 4180. A trailing header with no rows is
// still valid CSV (header line only).
export function toCSV(headers: string[], rows: readonly CsvCell[][]): string {
  const head = headers.map(escapeCell).join(",");
  const body = rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  return body ? `${head}\r\n${body}` : head;
}
