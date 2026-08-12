// atlas_params — deterministic lookup over the constraint-parameter table
// (src/lib/paramIndex.ts, docs/research/synlang-wiki.md §3.1). This is a
// membership match against the table's own rows, not a general search: no
// lexical/semantic scoring, no doc content scan.
import { type Indexes } from "../../retrieval/indexes.ts";
import { type ToolResult } from "./tools.ts";
import type { ParamRow } from "../../../lib/paramIndex.ts";

// Mirrors paramIndex.ts's normalizeForMatch (lowercase, punctuation collapsed
// to whitespace) so a query and a row's name/owner/doc_no tokenize identically.
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Plain ASCII compare — deterministic-builds convention, no locale dependency.
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function atlasParams(ix: Indexes, opts: { q: string; limit: number }): ToolResult {
  // Only tokens of length >=3 constrain the match — short query words (or a
  // query that normalizes to nothing) would otherwise vacuously match every
  // row, so both cases are treated as "no usable query".
  const tokens = normalizeForMatch(opts.q).split(/\s+/).filter((w) => w.length >= 3);
  if (tokens.length === 0) return { error: "q must contain at least one search term of 3+ characters" };

  const limit = Math.min(Math.max(1, opts.limit || 25), 100);

  const candidates: { row: ParamRow; ownerMatched: boolean }[] = [];
  for (const row of ix.params.rows) {
    const words = new Set(normalizeForMatch(`${row.name} ${row.owner ?? ""} ${row.doc_no}`).split(/\s+/).filter(Boolean));
    if (!tokens.every((t) => words.has(t))) continue;
    const ownerWords = row.owner ? new Set(normalizeForMatch(row.owner).split(/\s+/)) : null;
    candidates.push({ row, ownerMatched: !!ownerWords && tokens.some((t) => ownerWords.has(t)) });
  }

  // owner-matched rows first (a query that names the owning agent/entity is
  // disambiguating), then longer/more-specific names, then a stable doc_no tiebreak.
  candidates.sort(
    (a, b) =>
      Number(b.ownerMatched) - Number(a.ownerMatched) ||
      b.row.name.length - a.row.name.length ||
      cmp(a.row.doc_no, b.row.doc_no),
  );

  const rows = candidates.slice(0, limit).map(({ row }) => ({
    uuid: row.uuid,
    doc_no: row.doc_no,
    name: row.name,
    value: row.value,
    unit: row.unit,
    owner: row.owner,
    context: row.context,
  }));

  return { count: rows.length, ...(candidates.length > limit ? { truncated: true } : {}), rows };
}
