// A param value that lists its holders in a markdown table ("The Allocator
// role is held by the following entities …: | Entity | Address | …"), split
// so a card can show each row as its own key and value: the sentence before
// the table, the one address that sentence names (a Curator Multisig) as the
// param's own value, each row's first cell against its second, and any note
// after the table. A row of more columns pairs its first cell with its one
// address; a table whose rows do not all pair, or whose lead names several
// addresses, is not split, so nothing it states is dropped. Pure.

export interface ParamTable {
  /** The text before the table. */
  lead: string;
  /** The one address the lead names in backticks; null when it names none. */
  main: string | null;
  rows: { label: string; value: string }[];
  /** The text after the table. */
  note: string;
}

const ROW_RE = /^\s*\|.*\|\s*$/;
const SEPARATOR_RE = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;
const TICKED_ADDRESS_RE = /`(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})`/g;

const ADDRESS_CELL_RE = /^(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

/** A row's cells, split on its unescaped pipes, each without its backticks. */
const cells = (line: string) => line.trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|").replace(/^`(.*)`$/, "$1"));

/** A row as a label and its value: two cells as they are, else the first against the row's one address; null when it has neither shape. */
function pair(c: string[]): { label: string; value: string } | null {
  if (c.length === 2) return { label: c[0], value: c[1] };
  const addresses = c.slice(1).filter((x) => ADDRESS_CELL_RE.test(x));
  return addresses.length === 1 ? { label: c[0], value: addresses[0] } : null;
}

/** The value's first table, split from the text around it; null when it holds none, or one it cannot split whole. */
export function paramTable(value: string): ParamTable | null {
  const lines = value.split("\n");
  const at = lines.findIndex((l, i) => ROW_RE.test(l) && SEPARATOR_RE.test(lines[i + 1] ?? ""));
  if (at < 0 || cells(lines[at]).length < 2) return null;
  let end = at + 2;
  while (end < lines.length && ROW_RE.test(lines[end])) end++;
  const rows = lines.slice(at + 2, end).map(cells).map(pair);
  const lead = lines.slice(0, at).join("\n").trim();
  const named = [...lead.matchAll(TICKED_ADDRESS_RE)].map((m) => m[1]);
  if (named.length > 1 || !rows.every((r) => r !== null)) return null;
  return { lead, main: named[0] ?? null, rows, note: lines.slice(end).join("\n").trim() };
}
