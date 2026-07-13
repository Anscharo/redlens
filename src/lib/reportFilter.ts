// Shared text filter for report pages. The header search box (scoped to the
// current report) filters rows in place — no results page, no ranking, no
// index: report datasets are a few hundred structured rows already in memory,
// so substring matching is instant and preserves each report's native
// grouping/order.
//
// The three header mode pills mean the same thing here as on the reader:
//   broad  — every whitespace token must appear somewhere in the row (AND)
//   phrase — the quoted text must appear verbatim, case-insensitive
//   strict — the quoted text must appear verbatim, case-sensitive
// Facet fields that already have pill filters (category, domain, rating,
// status) are deliberately excluded from haystacks — pills own facets, the
// box owns text.

export type ReportMode = "broad" | "phrase" | "strict";

/**
 * A parsed report query: the needles to match plus case sensitivity.
 * broad → one lowercased needle per word; phrase → single lowercased needle
 * (spaces preserved); strict → single needle in original case.
 */
export interface ReportQuery {
  needles: string[];
  cased: boolean; // strict mode: compare in original case
}

export const EMPTY_QUERY: ReportQuery = { needles: [], cased: false };

/** Lowercased whitespace-split tokens; empty array = no filtering. */
export function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

// A clean full wrap in double/single quotes selects phrase/strict regardless
// of the mode param — mirroring the reader, where typed quotes win.
const wrapped = (s: string, q: string) =>
  s.length >= 2 && s.startsWith(q) && s.endsWith(q) ? s.slice(1, -1) : null;

/**
 * Parses the raw header-box text + active mode into needles, mirroring the
 * reader's semantics (typed quote-wrap overrides the mode pill). In broad
 * mode, stray leading/trailing quotes on tokens are stripped so a half-typed
 * quote doesn't silently match nothing.
 */
export function parseReportQuery(raw: string, mode: ReportMode = "broad"): ReportQuery {
  const trimmed = raw.trim();
  if (!trimmed) return EMPTY_QUERY;

  const phrase = wrapped(trimmed, '"');
  if (phrase !== null) return phrase.trim() ? { needles: [phrase.trim().toLowerCase()], cased: false } : EMPTY_QUERY;
  const strict = wrapped(trimmed, "'");
  if (strict !== null) return strict.trim() ? { needles: [strict.trim()], cased: true } : EMPTY_QUERY;

  if (mode === "phrase") return { needles: [trimmed.toLowerCase()], cased: false };
  if (mode === "strict") return { needles: [trimmed], cased: true };

  const needles = queryTokens(trimmed)
    .map((t) => t.replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
  return needles.length ? { needles, cased: false } : EMPTY_QUERY;
}

// ---------------------------------------------------------------------------
// Field-level matching. Each report describes its haystack as labelled fields
// with a `hidden` flag, so the UI can explain WHY a row matched: needles that
// hit only hidden fields surface as a floating excerpt beside the row
// (MatchAside).

export interface SearchField {
  label: string; // short human label, e.g. "executor", "tracking"
  value: string;
  hidden?: boolean; // searched but not rendered in the row
  // Entity-name field: also match with internal whitespace removed, so
  // "skybase" finds "Sky Base". NEVER set on prose/titles — bridging spaces
  // in running text produces junk matches ("dss" ↔ "recorDS Show").
  despace?: boolean;
}

/** Needle-vs-single-field test; case + de-spacing per query/field flags. */
export function fieldMatches(field: SearchField, needle: string, cased = false): boolean {
  const value = cased ? field.value : field.value.toLowerCase();
  if (value.includes(needle)) return true;
  return !!field.despace && value.replace(/\s+/g, "").includes(needle);
}

/** Row test: EVERY needle must match at least one field. */
export function rowMatches(fields: SearchField[], rq: ReportQuery): boolean {
  return rq.needles.every((n) => fields.some((f) => f.value && fieldMatches(f, n, rq.cased)));
}

/**
 * Filters rows by a parsed query. Returns the input array untouched (same
 * identity) for a blank query so memoized consumers don't re-render.
 */
export function filterRows<T>(
  rows: readonly T[],
  rq: ReportQuery,
  fieldsOf: (row: T) => SearchField[],
): readonly T[] {
  if (rq.needles.length === 0) return rows;
  return rows.filter((r) => rowMatches(fieldsOf(r), rq));
}

/** Regex source matching `needle` with optional whitespace between characters —
 * so a de-spaced needle ("skybase") still locates "Sky Base" in original text. */
export function flexTokenSource(needle: string): string {
  return needle
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
}

export interface HiddenMatch {
  label: string;
  excerpt: string;
  despace?: boolean; // the source field allows space-bridged highlighting
}

/** Short window of `value` around the first occurrence of `needle`. */
export function excerptAround(value: string, needle: string, opts: { despace?: boolean; cased?: boolean } = {}, radius = 26): string {
  const scan = opts.cased ? value : value.toLowerCase();
  let idx = scan.indexOf(needle);
  let len = needle.length;
  if (idx === -1 && opts.despace) {
    const m = new RegExp(flexTokenSource(needle), opts.cased ? "" : "i").exec(value);
    idx = m?.index ?? 0;
    len = m?.[0].length ?? 0;
  } else if (idx === -1) {
    idx = 0;
    len = 0;
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(value.length, idx + len + radius);
  return `${start > 0 ? "…" : ""}${value.slice(start, end).trim()}${end < value.length ? "…" : ""}`;
}

/**
 * For needles that match NO visible field, returns one highlighted-excerpt
 * entry per hidden field that carries such a needle — the "why did this row
 * match?" payload. Empty when every needle is accounted for by visible text.
 */
export function hiddenMatches(fields: SearchField[], rq: ReportQuery): HiddenMatch[] {
  if (rq.needles.length === 0) return [];
  const out: HiddenMatch[] = [];
  const seen = new Set<string>();
  for (const n of rq.needles) {
    const visibleHit = fields.some((f) => !f.hidden && f.value && fieldMatches(f, n, rq.cased));
    if (visibleHit) continue;
    for (const f of fields) {
      if (!f.hidden || !f.value || seen.has(f.label) || !fieldMatches(f, n, rq.cased)) continue;
      seen.add(f.label);
      out.push({
        label: f.label,
        excerpt: excerptAround(f.value, n, { despace: f.despace, cased: rq.cased }),
        despace: f.despace,
      });
    }
  }
  return out;
}
