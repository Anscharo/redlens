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
