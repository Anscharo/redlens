// Postgres array literals for uuid[] bind/read. Isolated from db.ts so tests can
// import the real implementation even after another file mock.module's db.ts
// (bun mocks are process-wide). Search/sync still re-export these from db.ts.

// Format a uuid[] as a Postgres array literal: {a,b,c}. Pair with `::uuid[]`.
//
// REQUIRED — do not pass a JS array as a bound parameter for an array column.
// Bun.sql does not encode JS arrays as Postgres arrays: it sends the first element
// as a scalar, and Postgres fails with `malformed array literal` / "Array value
// must start with {". This surfaced as the noisy boot-embeddings failure on
// atlas_doc_embeddings.member_ids.
//
// Safe unquoted for UUIDs specifically: they can't contain a comma, brace or quote,
// and the `::uuid[]` cast validates every element. For a list of arbitrary strings
// pass the RAW JS array with a `::jsonb` cast and unwrap with
// jsonb_array_elements_text (see atlas-artifacts.ts getArtifacts). Do NOT
// JSON.stringify first — Bun JSON-encodes from the cast, and pre-stringifying
// double-encodes into a jsonb string scalar (chat.ts jsonb note; live-tested
// 2026-09-01).
export function toUuidArrayLiteral(ids: readonly string[]): string {
  return `{${ids.join(",")}}`;
}

// Inverse of toUuidArrayLiteral. Bun.sql does not decode uuid[] into a JS array
// — SELECT returns the Postgres text form `{uuid,uuid}` (or `{}`). Passing that
// string through as Hit.memberIds made rewriteSemanticHit throw `ids.map is not
// a function` and fail the e2e atlas_query smoke (PR #286).
//
// Also accepts a real string[] so a future bun that does decode arrays still
// works, and a bare uuid (one-element column read as a scalar).
export function fromUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.length > 0);
  if (typeof value !== "string" || value.length === 0) return [];
  const inner = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  if (!inner) return [];
  return inner.split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}
