// Browser-only CSV download trigger. Split out of csv.ts so that csv.ts's pure
// `toCSV` string builder stays DOM-free and importable by server-side report
// builders; only this file touches `document`.
//
// - Prepends a UTF-8 BOM so Excel on Windows decodes non-ASCII (em-dashes,
//   curly quotes, accented names) correctly instead of mojibake.
// - Appends the anchor to the DOM and defers revokeObjectURL to the next tick:
//   Safari/Firefox need the anchor in the document and the blob URL still live
//   when the click is processed, or a large export silently fails/truncates.
export function downloadCSV(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
