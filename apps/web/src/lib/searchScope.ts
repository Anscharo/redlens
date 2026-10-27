// Pure `in:` scope text logic: how the scope button reads and rewrites the
// query text. No React, no URL state. The worker's parser (search.worker.ts)
// honours the LAST `in:` token, so the rewrite keeps at most one.

const IN_TOKEN_RE = /\bin:(\S+)/gi;

/** The doc_no the query is scoped to, or null when it carries no `in:` token. */
export function scopeOf(query: string): string | null {
  let last: string | null = null;
  for (const m of query.matchAll(IN_TOKEN_RE)) last = m[1];
  return last;
}

/** The query with every `in:` token removed and whitespace collapsed. */
export function withoutScope(query: string): string {
  return query.replace(IN_TOKEN_RE, " ").replace(/\s+/g, " ").trim();
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
