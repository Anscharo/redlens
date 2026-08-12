// Shared HTTP request/response helpers for the Bun API handlers.

// JSON response with the right content-type and any Set-Cookie header(s).
// `cookies` accepts a single cookie string or an array (e.g. a session-refresh
// cookie, or OAuth state-clear cookies); undefined/empty adds none.
export function json(body: unknown, status = 200, cookies: string | string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  const list = typeof cookies === "string" ? [cookies] : cookies;
  for (const c of list) headers.append("set-cookie", c);
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
