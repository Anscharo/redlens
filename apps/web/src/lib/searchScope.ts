// Pure `in:` scope text logic: how the scope button reads and rewrites the
// query text. No React, no URL state. The worker's parser (search.worker.ts)
// honours the LAST `in:` token, so the rewrite keeps at most one.

// The value stops at a quote, so a token typed against a closing quote never
// takes that quote with it when the button removes or replaces the token.
const IN_TOKEN_RE = /\bin:([^\s"']+)/gi;
const IN_TOKEN_WITH_SPACE_RE = /(\s?)\bin:[^\s"']+(\s?)/gi;

/** The doc_no the query is scoped to, or null when it carries no `in:` token. */
export function scopeOf(query: string): string | null {
  let last: string | null = null;
  for (const m of query.matchAll(IN_TOKEN_RE)) last = m[1];
  return last;
}

/**
 * The query with every `in:` token removed. Only the space a token leaves
 * behind is closed up: the reader's own spacing stays as typed, because a
 * quoted phrase matches its spaces literally.
 */
export function withoutScope(query: string): string {
  return query.replace(IN_TOKEN_WITH_SPACE_RE, (_m, before: string, after: string) => (before && after ? " " : "")).trim();
}

/**
 * The query a scope-button press produces: scoped to `docNo` when it is not
 * already, unscoped when it is. The token goes at the end so the reader's own
 * terms, quotes included, stay where they typed them; the mode pills already
 * keep field tokens outside the quotes they add (see searchMode.ts).
 */
export function toggleScope(query: string, docNo: string): string {
  const current = scopeOf(query);
  const rest = withoutScope(query);
  if (current?.toUpperCase() === docNo.toUpperCase()) return rest;
  return rest ? `${rest} in:${docNo}` : `in:${docNo}`;
}
