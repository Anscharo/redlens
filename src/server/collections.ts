// /api/collections — user-curated ordered lists of atlas doc ids. Auth-gated,
// ownership scoped via WHERE user_id (mirrors chat.ts). No streaming here —
// plain JSON in/out.
import { sql } from "./db.ts";
import { getSessionUser } from "./session.ts";
import { json, isStringArray } from "./http.ts";

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
async function insertItems(exec: typeof sql, collectionId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await exec`
      INSERT INTO collection_items (collection_id, doc_id, position) VALUES (${collectionId}, ${ids[i]}, ${i})
    `;
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

export async function handleCollections(req: Request): Promise<Response> {
  const session = await getSessionUser(req);
  if (!session) return json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const { pathname } = new URL(req.url);
  const match = pathname.match(/^\/api\/collections(?:\/([^/]+))?$/);
  const id = match?.[1];

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
    if (!body.name?.trim()) return json({ error: "empty_name" }, 400);
    if (body.ids !== undefined && !isStringArray(body.ids)) return json({ error: "invalid_ids" }, 400);
    return json(await createCollection(userId, body), 201, session.refresh);
  }

  if (id && req.method === "PATCH") {
    let body: CollectionBody;
    try {
      body = (await req.json()) as CollectionBody;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (body.name !== undefined && !body.name.trim()) return json({ error: "empty_name" }, 400);
    if (body.ids !== undefined && !isStringArray(body.ids)) return json({ error: "invalid_ids" }, 400);
    const updated = await updateCollection(userId, id, body);
    if (!updated) return json({ error: "not_found" }, 404);
    return json(updated, 200, session.refresh);
  }

  if (id && req.method === "DELETE") {
    const ok = await deleteCollection(userId, id);
    if (!ok) return json({ error: "not_found" }, 404);
    return json({ ok: true }, 200, session.refresh);
  }

  return json({ error: "method_not_allowed" }, 405);
}
