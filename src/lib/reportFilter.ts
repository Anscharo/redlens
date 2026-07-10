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
 * joined with " | " so a token can't straddle two fields. Each field with
 * internal whitespace also contributes a de-spaced copy, so "skybase"
 * matches "Sky Base" (and "sky base" already matches "SkyBase" token-wise).
 */
export function buildHaystack(fields: Array<string | number | null | undefined>): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (f === null || f === undefined || f === "") continue;
    const lower = String(f).toLowerCase();
    parts.push(lower);
    const despaced = lower.replace(/\s+/g, "");
    if (despaced !== lower) parts.push(despaced);
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
}

/** Same haystack semantics as buildHaystack, from labelled fields. */
export function fieldsHaystack(fields: SearchField[]): string {
  return buildHaystack(fields.map((f) => f.value));
}

/** Token-vs-single-field test (plain + de-spaced, case-insensitive). */
export function fieldMatches(value: string, token: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes(token) || lower.replace(/\s+/g, "").includes(token);
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
}

/** Short window of `value` around the first occurrence of `token`. */
export function excerptAround(value: string, token: string, radius = 26): string {
  let idx = value.toLowerCase().indexOf(token);
  let len = token.length;
  if (idx === -1) {
    const m = new RegExp(flexTokenSource(token), "i").exec(value);
    idx = m?.index ?? 0;
    len = m?.[0].length ?? 0;
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
    const visibleHit = fields.some((f) => !f.hidden && f.value && fieldMatches(f.value, t));
    if (visibleHit) continue;
    for (const f of fields) {
      if (!f.hidden || !f.value || seen.has(f.label) || !fieldMatches(f.value, t)) continue;
      seen.add(f.label);
      out.push({ label: f.label, excerpt: excerptAround(f.value, t) });
    }
  }
  return out;
}
