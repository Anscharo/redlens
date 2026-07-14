// /api/collections — user-curated ordered lists of atlas doc ids. Auth-gated,
// ownership scoped via WHERE user_id (mirrors chat.ts). No streaming here —
// plain JSON in/out.
import { sql } from "./db.ts";
import { getSessionUser } from "./session.ts";

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

function json(body: unknown, status = 200, refresh?: string): Response {
  const res = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (refresh) res.headers.append("set-cookie", refresh);
  return res;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

async function itemsFor(collectionId: string): Promise<string[]> {
  const rows = (await sql`
    SELECT doc_id FROM collection_items WHERE collection_id = ${collectionId} ORDER BY position
  `) as { doc_id: string }[];
  return rows.map((r) => r.doc_id);
}

async function insertItems(collectionId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await sql`
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
  const ids = body.ids ?? [];
  const created = (await sql`
    INSERT INTO collections (user_id, name) VALUES (${userId}, ${name}) RETURNING id, name, updated_at
  `) as CollectionRow[];
  const row = created[0];
  await insertItems(row.id, ids);
  return { id: row.id, name: row.name, updatedAt: new Date(row.updated_at).toISOString(), ids };
}

async function updateCollection(userId: string, id: string, body: CollectionBody): Promise<CollectionOut | null> {
  const owned = (await sql`SELECT id FROM collections WHERE id = ${id} AND user_id = ${userId}`) as { id: string }[];
  if (!owned.length) return null;

  if (body.name !== undefined) {
    await sql`UPDATE collections SET name = ${body.name.trim()}, updated_at = now() WHERE id = ${id}`;
  }
  if (body.ids !== undefined) {
    await sql`DELETE FROM collection_items WHERE collection_id = ${id}`;
    await insertItems(id, body.ids);
    await sql`UPDATE collections SET updated_at = now() WHERE id = ${id}`;
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
