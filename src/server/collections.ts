// /api/collections — user-curated ordered lists of atlas doc ids. Auth-gated,
// ownership scoped via WHERE user_id (mirrors chat.ts). No streaming here —
// plain JSON in/out.
import { sql } from "./db.ts";
import { getSessionUser } from "./session.ts";
import { json, isStringArray } from "./http.ts";
import { MAX_COLLECTION_DOCS } from "../lib/collectionsLimits.ts";
import { UUID_RE } from "../lib/patterns.ts";

interface CollectionRow {
  id: string;
  name: string;
  updated_at: string | Date;
}

interface CollectionOut {
  id: string;
  name: string;
  updatedAt: string;
  ids: string[];
}

interface CollectionBody {
  name?: string;
  ids?: string[];
}

// Server-side safety caps (these guard a direct authenticated POST/PATCH from
// inserting a giant name or a huge ids array). MAX_NAME_LEN matches
// MAX_COLLECTION_NAME_LEN in src/lib/collectionsApi.ts (the UI's maxLength) so
// a name the UI would let you type is never rejected server-side and a rename
// can't sneak past the UI cap by deleting a character out of an old, longer
// name — single source of truth is the number 32 itself; it's kept as a
// literal here (not imported) because collectionsApi.ts pulls in browser-only
// chat/api types. If that constant ever moves to the zero-import
// src/lib/collectionsLimits.ts (mirroring MAX_COLLECTION_DOCS below), switch
// this to a real shared import. MAX_IDS is the shared MAX_COLLECTION_DOCS so
// the limit shown in the UI matches what the server accepts; items are
// inserted in batches (insertItems) so even a full-atlas save is a few
// statements, not one per doc.
const MAX_NAME_LEN = 32;
const MAX_IDS = MAX_COLLECTION_DOCS;

// True when `v` is a string with non-whitespace content. `body` is untyped
// JSON cast to CollectionBody (`as CollectionBody`), so `body.name` can be any
// JSON value at runtime — a plain `!body.name?.trim()` check only guards
// null/undefined; a truthy non-string (42, true, ["a"], {}) reaches `.trim()`
// and throws a TypeError, which surfaces as an unhandled 500.
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

async function itemsFor(collectionId: string): Promise<string[]> {
  const rows = (await sql`
    SELECT doc_id FROM collection_items WHERE collection_id = ${collectionId} ORDER BY position
  `) as { doc_id: string }[];
  return rows.map((r) => r.doc_id);
}

// Drop duplicate doc ids (keeping first-seen order): the caller-supplied list
// can repeat, and (collection_id, doc_id) is a primary key — an unfiltered
// re-insert would throw mid-loop and, for a PATCH, leave the collection emptied.
function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

// `exec` is either the pooled `sql` or a transaction handle from sql.begin().
// Batched multi-row insert: at MAX_COLLECTION_DOCS this is a handful of
// statements instead of thousands of round-trips. Chunked so bind-param count
// stays well under Postgres' ~65k limit (3000 rows × 2 params + 1 shared = ~6k).
const INSERT_CHUNK = 3000;
async function insertItems(exec: typeof sql, collectionId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
    const chunk = ids.slice(i, i + INSERT_CHUNK);
    const params: unknown[] = [collectionId]; // $1, reused for every row
    const valuesSql = chunk
      .map((docId, j) => {
        params.push(docId, i + j);
        return `($1, $${params.length - 1}, $${params.length})`;
      })
      .join(",");
    await exec.unsafe(
      `INSERT INTO collection_items (collection_id, doc_id, position) VALUES ${valuesSql}`,
      params,
    );
  }
}

async function listCollections(userId: string): Promise<CollectionOut[]> {
  const rows = (await sql`
    SELECT id, name, updated_at FROM collections WHERE user_id = ${userId} ORDER BY updated_at DESC
  `) as CollectionRow[];
  const out: CollectionOut[] = [];
  for (const row of rows) {
    const ids = await itemsFor(row.id);
    out.push({ id: row.id, name: row.name, updatedAt: new Date(row.updated_at).toISOString(), ids });
  }
  return out;
}

async function createCollection(userId: string, body: CollectionBody): Promise<CollectionOut> {
  const name = body.name!.trim();
  const ids = dedupe(body.ids ?? []);
  // Insert the collection and its items in one transaction so a failed item
  // insert can't leave an empty collection behind.
  const row = await sql.begin(async (tx) => {
    const created = (await tx`
      INSERT INTO collections (user_id, name) VALUES (${userId}, ${name}) RETURNING id, name, updated_at
    `) as CollectionRow[];
    await insertItems(tx, created[0].id, ids);
    return created[0];
  });
  return { id: row.id, name: row.name, updatedAt: new Date(row.updated_at).toISOString(), ids };
}

async function updateCollection(userId: string, id: string, body: CollectionBody): Promise<CollectionOut | null> {
  const owned = (await sql`SELECT id FROM collections WHERE id = ${id} AND user_id = ${userId}`) as { id: string }[];
  if (!owned.length) return null;

  if (body.name !== undefined) {
    await sql`UPDATE collections SET name = ${body.name.trim()}, updated_at = now() WHERE id = ${id}`;
  }
  if (body.ids !== undefined) {
    const ids = dedupe(body.ids);
    // Atomic replace: delete + reinsert in one transaction so a partial failure
    // can't leave the collection emptied or half-repopulated.
    await sql.begin(async (tx) => {
      await tx`DELETE FROM collection_items WHERE collection_id = ${id}`;
      await insertItems(tx, id, ids);
      await tx`UPDATE collections SET updated_at = now() WHERE id = ${id}`;
    });
  }
  if (body.name === undefined && body.ids === undefined) {
    await sql`UPDATE collections SET updated_at = now() WHERE id = ${id}`;
  }

  const rows = (await sql`SELECT id, name, updated_at FROM collections WHERE id = ${id}`) as CollectionRow[];
  const row = rows[0];
  const ids = await itemsFor(id);
  return { id: row.id, name: row.name, updatedAt: new Date(row.updated_at).toISOString(), ids };
}

async function deleteCollection(userId: string, id: string): Promise<boolean> {
  const deleted = (await sql`
    DELETE FROM collections WHERE id = ${id} AND user_id = ${userId} RETURNING id
  `) as { id: string }[];
  return deleted.length > 0;
}

// Public, unauthenticated read of a single collection by id — backs shared
// /c/<id> links. Anyone with the (unguessable) id can view it; no user scoping,
// and only name + ids are returned. Feature-gated (config.usersEnabled) at the
// route, so it 404s where collections don't exist.
export async function handleSharedCollection(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const { pathname } = new URL(req.url);
  const id = pathname.match(/^\/api\/collections\/([^/]+)\/shared$/)?.[1];
  // `id` is a bare uuid column (migrations/014_collections.sql) — an id that
  // isn't even shaped like a UUID would otherwise reach Postgres as a bad
  // ::uuid cast and throw, surfacing as an unhandled 500 with an HTML body
  // instead of the 404 a merely-unknown (but well-formed) id gets below.
  if (!id || !UUID_RE.test(id)) return json({ error: "not_found" }, 404);
  try {
    const rows = (await sql`SELECT id, name, updated_at FROM collections WHERE id = ${id}`) as CollectionRow[];
    if (!rows.length) return json({ error: "not_found" }, 404);
    const row = rows[0];
    return json({ id: row.id, name: row.name, updatedAt: new Date(row.updated_at).toISOString(), ids: await itemsFor(id) });
  } catch {
    return json({ error: "server_error" }, 500);
  }
}

export async function handleCollections(req: Request): Promise<Response> {
  const session = await getSessionUser(req);
  if (!session) return json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const { pathname } = new URL(req.url);
  const match = pathname.match(/^\/api\/collections(?:\/([^/]+))?$/);
  const id = match?.[1];
  // Same bad-::uuid-cast concern as handleSharedCollection above — reject a
  // malformed id before it ever reaches the PATCH/DELETE queries below. A
  // well-formed id that just doesn't exist (or isn't owned) still 404s further
  // down via the normal ownership checks.
  if (id && !UUID_RE.test(id)) return json({ error: "not_found" }, 404);

  if (!id && req.method === "GET") {
    return json(await listCollections(userId), 200, session.refresh);
  }

  if (!id && req.method === "POST") {
    let body: CollectionBody;
    try {
      body = (await req.json()) as CollectionBody;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!isNonEmptyString(body.name)) return json({ error: "empty_name" }, 400);
    if (body.ids !== undefined && !isStringArray(body.ids)) return json({ error: "invalid_ids" }, 400);
    if (body.name.trim().length > MAX_NAME_LEN) return json({ error: "name_too_long" }, 400);
    if ((body.ids?.length ?? 0) > MAX_IDS) return json({ error: "too_many_ids" }, 400);
    return json(await createCollection(userId, body), 201, session.refresh);
  }

  if (id && req.method === "PATCH") {
    let body: CollectionBody;
    try {
      body = (await req.json()) as CollectionBody;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (body.name !== undefined && !isNonEmptyString(body.name)) return json({ error: "empty_name" }, 400);
    if (body.ids !== undefined && !isStringArray(body.ids)) return json({ error: "invalid_ids" }, 400);
    if (body.name !== undefined && body.name.trim().length > MAX_NAME_LEN) return json({ error: "name_too_long" }, 400);
    if (body.ids !== undefined && body.ids.length > MAX_IDS) return json({ error: "too_many_ids" }, 400);
    try {
      const updated = await updateCollection(userId, id, body);
      if (!updated) return json({ error: "not_found" }, 404);
      return json(updated, 200, session.refresh);
    } catch {
      return json({ error: "server_error" }, 500);
    }
  }

  if (id && req.method === "DELETE") {
    try {
      const ok = await deleteCollection(userId, id);
      if (!ok) return json({ error: "not_found" }, 404);
      return json({ ok: true }, 200, session.refresh);
    } catch {
      return json({ error: "server_error" }, 500);
    }
  }

  return json({ error: "method_not_allowed" }, 405);
}
