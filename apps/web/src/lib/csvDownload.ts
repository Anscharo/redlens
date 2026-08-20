// Browser-only file download trigger. Split out of csv.ts so that csv.ts's pure
// `toCSV` string builder stays DOM-free and importable by server-side report
// builders; only this file touches `document`.
//
// - `bom` prepends a UTF-8 BOM so Excel on Windows decodes non-ASCII (em-dashes,
//   curly quotes, accented names) correctly instead of mojibake. On for CSV;
//   off for markdown/plain text, where a stray BOM can show as a leading glyph.
// - Appends the anchor to the DOM and defers revokeObjectURL to the next tick:
//   Safari/Firefox need the anchor in the document and the blob URL still live
//   when the click is processed, or a large export silently fails/truncates.
export function downloadFile(filename: string, content: string, mime: string, bom = false): void {
  const url = URL.createObjectURL(new Blob([bom ? "\uFEFF" + content : content], { type: mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Thin CSV wrapper kept for the /reports/* call-sites (Excel BOM always on).
export function downloadCSV(filename: string, csv: string): void {
  downloadFile(filename, csv, "text/csv;charset=utf-8", true);
}
