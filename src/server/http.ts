// Shared HTTP request/response helpers for the Bun API handlers. Deliberately
// dependency-free (no config, no db, no route module) so every layer — the
// router in index.ts, the preview handler, the DB-backed route handlers — can
// share one response shape without an import cycle.

// The full cross-origin header set. The app itself is same-origin (one Bun
// service serves dist/ AND /api/*), so this exists only for the endpoints with
// genuine off-origin consumers: the MCP transport at config.mcpPath (browser +
// agent MCP clients — the reason these headers were introduced), the
// health/freshness probes, the per-sha atlas artifacts and the OG images.
// Everything in index.ts's `routes` table is same-origin only and gets none of
// it — see the OPTIONS branch in handleRequest.
export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id",
};

// Preview bundle responses: readable cross-origin (they're plain sha-keyed
// artifacts, no credentials) but never search-indexed — unreviewed, possibly
// fork content must not be indexed under our domain (SEO-laundering defense).
// Deliberately NOT merged with CORS above: different surface, different intent.
export const PREVIEW_CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "x-robots-tag": "noindex",
};

// Optional third argument to json(). A bare string/string[] is still accepted
// as the cookie shorthand (the original signature, used by auth/collections/
// conversations), so callers that only set cookies read the same as before.
export interface JsonInit {
  /** Set-Cookie header(s) — appended, so several can coexist. Empty entries are dropped. */
  cookies?: string | string[];
  /** Extra response headers: CORS/robots/Cache-Control. */
  headers?: Record<string, string>;
}

// JSON response with the right content-type, any Set-Cookie header(s), and any
// extra headers. The single json() helper for the whole server — preview's
// handler wraps this rather than keeping its own copy.
export function json(body: unknown, status = 200, init: string | string[] | JsonInit = []): Response {
  const opts: JsonInit = typeof init === "string" || Array.isArray(init) ? { cookies: init } : init;
  const headers = new Headers({ "content-type": "application/json", ...opts.headers });
  const list = typeof opts.cookies === "string" ? [opts.cookies] : (opts.cookies ?? []);
  for (const c of list) if (c) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

// Request-body validation: true when `v` is an array of strings.
export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// True when `v` is a string with non-whitespace content. Request bodies are
// untyped JSON cast to a local interface, so a field can be any JSON value at
// runtime — a plain `!body.field?.trim()` check only guards null/undefined; a
// truthy non-string (42, true, ["a"], {}) reaches `.trim()` and throws a
// TypeError, which surfaces as an unhandled 500. Promoted out of
// collections.ts so feedback.ts (and any future POST handler) shares one copy.
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
