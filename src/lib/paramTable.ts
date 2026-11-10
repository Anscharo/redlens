// A param value that lists its holders in a markdown table ("The Allocator
// role is held by the following entities …: | Entity | Address | …"), split
// so a card can show each row as its own key and value: the sentence before
// the table, the one address that sentence names (a Curator Multisig) as the
// param's own value, each row's first cell against its last, and any note
// after the table. Pure.

export interface ParamTable {
  /** The text before the table. */
  lead: string;
  /** The one address the lead names in backticks; null when it names none or several. */
  main: string | null;
  rows: { label: string; value: string }[];
  /** The text after the table. */
  note: string;
}

const ROW_RE = /^\s*\|.*\|\s*$/;
const SEPARATOR_RE = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;
const TICKED_ADDRESS_RE = /`(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})`/g;

const cells = (line: string) => line.trim().slice(1, -1).split("|").map((c) => c.trim().replace(/^`(.*)`$/, "$1"));

/** The value's first table, split from the text around it; null when it holds none, or one of fewer than two columns. */
export function paramTable(value: string): ParamTable | null {
  const lines = value.split("\n");
  const at = lines.findIndex((l, i) => ROW_RE.test(l) && SEPARATOR_RE.test(lines[i + 1] ?? ""));
  if (at < 0 || cells(lines[at]).length < 2) return null;
  let end = at + 2;
  while (end < lines.length && ROW_RE.test(lines[end])) end++;
  const rows = lines.slice(at + 2, end).map(cells).map((c) => ({ label: c[0], value: c[c.length - 1] }));
  const lead = lines.slice(0, at).join("\n").trim();
  const named = [...lead.matchAll(TICKED_ADDRESS_RE)].map((m) => m[1]);
  return { lead, main: named.length === 1 ? named[0] : null, rows, note: lines.slice(end).join("\n").trim() };
}
