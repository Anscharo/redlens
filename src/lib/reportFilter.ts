// Shared text filter for report pages. The header search box (scoped to the
// current report) filters rows in place — no results page, no ranking, no
// index: report datasets are a few hundred structured rows already in memory,
// so tokenized case-insensitive substring matching is instant and preserves
// each report's native grouping/order.
//
// Semantics: the query is split on whitespace; a row matches when EVERY token
// is a substring of the row's haystack (AND). Facet fields that already have
// pill filters (category, domain, rating, status) are deliberately excluded
// from haystacks — pills own facets, the box owns text.

/** Lowercased whitespace-split tokens; empty array = no filtering. */
export function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Builds a lowercase haystack from a row's searchable fields. Fields are
 * joined with " | " so a token can't straddle two fields. Plain substring
 * semantics only — de-spaced matching is a per-field opt-in (see
 * SearchField.despace), reserved for entity names; applying it to prose
 * made "dss" match "recorDS Show".
 */
export function buildHaystack(fields: Array<string | number | null | undefined>): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (f === null || f === undefined || f === "") continue;
    parts.push(String(f).toLowerCase());
  }
  return parts.join(" | ");
}

export function matchesTokens(haystack: string, tokens: string[]): boolean {
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Filters rows by the query. Returns the input array untouched (same
 * identity) for a blank query so memoized consumers don't re-render.
 */
export function filterRows<T>(
  rows: readonly T[],
  query: string,
  haystackOf: (row: T) => string,
): readonly T[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return rows;
  return rows.filter((r) => matchesTokens(haystackOf(r), tokens));
}

// ---------------------------------------------------------------------------
// Field-level matching. Reports that search more than the visible row text
// describe their haystack as labelled fields with a `hidden` flag, so the UI
// can explain WHY a row matched: tokens that hit only hidden fields surface
// as a floating excerpt beside the row (MatchAside).

export interface SearchField {
  label: string; // short human label, e.g. "executor", "tracking"
  value: string;
  hidden?: boolean; // searched but not rendered in the row
  // Entity-name field: also match with internal whitespace removed, so
  // "skybase" finds "Sky Base". NEVER set on prose/titles — bridging spaces
  // in running text produces junk matches ("dss" ↔ "recorDS Show").
  despace?: boolean;
}

/** Haystack from labelled fields; de-spaced copies only for despace fields. */
export function fieldsHaystack(fields: SearchField[]): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (!f.value) continue;
    const lower = f.value.toLowerCase();
    parts.push(lower);
    if (f.despace) {
      const despaced = lower.replace(/\s+/g, "");
      if (despaced !== lower) parts.push(despaced);
    }
  }
  return parts.join(" | ");
}

/** Token-vs-single-field test (case-insensitive; de-spaced only if opted in). */
export function fieldMatches(field: SearchField, token: string): boolean {
  const lower = field.value.toLowerCase();
  if (lower.includes(token)) return true;
  return !!field.despace && lower.replace(/\s+/g, "").includes(token);
}

/** Regex source matching `token` with optional whitespace between characters —
 * so a de-spaced token ("skybase") still locates "Sky Base" in original text. */
export function flexTokenSource(token: string): string {
  return token
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
}

export interface HiddenMatch {
  label: string;
  excerpt: string;
  despace?: boolean; // the source field allows space-bridged highlighting
}

/** Short window of `value` around the first occurrence of `token`. */
export function excerptAround(value: string, token: string, despace = false, radius = 26): string {
  let idx = value.toLowerCase().indexOf(token);
  let len = token.length;
  if (idx === -1 && despace) {
    const m = new RegExp(flexTokenSource(token), "i").exec(value);
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
 * For tokens that match NO visible field, returns one highlighted-excerpt
 * entry per hidden field that carries such a token — the "why did this row
 * match?" payload. Empty when every token is accounted for by visible text.
 */
export function hiddenMatches(fields: SearchField[], tokens: string[]): HiddenMatch[] {
  if (tokens.length === 0) return [];
  const out: HiddenMatch[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const visibleHit = fields.some((f) => !f.hidden && f.value && fieldMatches(f, t));
    if (visibleHit) continue;
    for (const f of fields) {
      if (!f.hidden || !f.value || seen.has(f.label) || !fieldMatches(f, t)) continue;
      seen.add(f.label);
      out.push({ label: f.label, excerpt: excerptAround(f.value, t, f.despace), despace: f.despace });
    }
  }
  return out;
}
