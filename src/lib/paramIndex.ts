// Deterministic constraint-parameter table (docs/research/synlang-wiki.md §3.1):
// extracts numeric governance parameters (rate limits, ratios, quorums,
// thresholds) that sit in typed positions in atlas doc content, into an
// in-memory lookup table. Pure function of doc content — no baseline file, no
// curation, no external state — recomputed on every index rebuild so a row
// can never be stale-wrong (see the update-path section of the design doc).
//
// Wired in by other agents: a deterministic verifier check (compare an
// answer's stated numbers against rows), filtered [E-const] standing evidence
// (matchText), and an on-demand lookup tool. This module only builds the
// table + lookup API.
import type { AtlasNode } from "../types";
import { extractBacktick, extractCoreChild, extractKv, extractProse } from "./paramExtract";
import { resolveOwner } from "./paramOwner";

export interface ParamRow {
  uuid: string; // doc that carries the value
  doc_no: string; // display/reference only — never a lookup key
  name: string; // normalized param name: lowercased, single-spaced
  value: string; // canonical string as written, commas kept ("10,000")
  num: number | null; // parsed numeric value where unambiguous, else null
  unit: string | null; // "%", "USDS", "USDS/day", "signers", … or null
  owner: string | null; // disambiguating ancestor title, lowercased, or null
  context: string; // <=160 chars of source text surrounding the value
  source: string; // extraction-pattern id: "kv" | "core-child" | "backtick" | "prose"
}

export interface ParamIndex {
  rows: ParamRow[];
  byUuid: Map<string, ParamRow[]>;
  byName: Map<string, ParamRow[]>; // normalized name -> rows; many-to-many
  // (e.g. "maxamount" spans 7 agents) — a bare hit is not a unique value,
  // consumers must disambiguate on `owner`.
  matchText(text: string): ParamRow[];
}

// Shared normalizer for BOTH row names and matchText's input text — they must
// tokenize identically or a row's own name could never match its own mention.
// Lowercase, punctuation collapsed to whitespace (so "current yield (at
// launch)" and "usds/sky lp (uni-v2) amount" tokenize to real words instead of
// producing tokens like "(at" or "usds/sky" that can never appear in
// punctuation-stripped text).
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Tokens of length >=3; if every token is <3 chars, use them all (spec'd
// fallback — covers degenerate short names). Note this collapses some names:
// "slope 2" -> ["slope"] (the "2" is dropped) is indistinguishable from plain
// "slope"; "f2 function" -> ["function"] similarly loses its most specific
// part. That's a fan-out cost, not a correctness bug — see the report.
function tokenize(name: string): string[] {
  const words = normalizeForMatch(name).split(/\s+/).filter(Boolean);
  const long = words.filter((w) => w.length >= 3);
  return long.length > 0 ? long : words;
}

// Plain ASCII string compare (not localeCompare — no ICU/locale dependency,
// per the repo's deterministic-builds convention).
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildParamIndex(docMap: Map<string, AtlasNode>): ParamIndex {
  const rows: ParamRow[] = [];
  for (const n of docMap.values()) {
    const coreChild = extractCoreChild(n);
    if (coreChild) {
      // core-child claims the whole doc (content IS the value) — mutually
      // exclusive with backtick, which needs surrounding prose to extract a name from.
      rows.push({ ...coreChild, owner: resolveOwner(docMap, n) });
      continue;
    }
    const extracted = [...extractKv(n), ...extractBacktick(n)];
    const prose = extractProse(n);
    if (prose) extracted.push(prose);
    if (extracted.length === 0) continue;
    const owner = resolveOwner(docMap, n); // one ancestor walk per doc, shared across its rows
    for (const r of extracted) rows.push({ ...r, owner });
  }

  // Total order: doc_no, then name, then value, then source — multiple rows
  // per doc (distinct names) and same-name rows across docs (e.g. two
  // "Signers" docs) both need a deterministic tiebreak.
  rows.sort((a, b) => cmp(a.doc_no, b.doc_no) || cmp(a.name, b.name) || cmp(a.value, b.value) || cmp(a.source, b.source));

  const byUuid = new Map<string, ParamRow[]>();
  const byName = new Map<string, ParamRow[]>();
  const tokensByRow = new Map<ParamRow, string[]>();
  const bucket = <K,>(m: Map<K, ParamRow[]>, k: K, r: ParamRow) => {
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  };
  for (const r of rows) {
    bucket(byUuid, r.uuid, r);
    bucket(byName, r.name, r);
    tokensByRow.set(r, tokenize(r.name));
  }

  function matchText(text: string): ParamRow[] {
    const words = new Set(normalizeForMatch(text).split(/\s+/).filter(Boolean));
    // `.every()` on an empty token list is vacuously true — guard against a
    // row with no tokens matching every call. Every extraction pattern
    // guarantees a non-empty `name`, so this can't happen today; kept as a
    // belt-and-braces invariant rather than a live bug.
    return rows.filter((r) => {
      const t = tokensByRow.get(r)!;
      return t.length > 0 && t.every((tok) => words.has(tok));
    });
  }

  return { rows, byUuid, byName, matchText };
}
