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
