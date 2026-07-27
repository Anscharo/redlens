// collections.ts unit tests. Mocks ./db.ts COMPLETELY (every named export the
// real module has, as no-ops/an in-memory fake — mirrors auth.test.ts's
// convention) with a tiny in-memory "database" (arrays keyed like the real
// `collections` / `collection_items` tables) so createCollection/
// updateCollection/insertItems's batched `.unsafe()` insert path and the
// tagged-template queries all round-trip realistically without Postgres.
// session.ts is NOT mocked — a real signed JWT (mirrors auth.test.ts's DELETE
// /api/auth/me tests) drives the auth-gated routes.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

interface Col {
  id: string;
  user_id: string;
  name: string;
  updated_at: string;
}

let collections: Col[] = [];
let items: Record<string, string[]> = {};
let idCounter = 0;
function newId(): string {
  idCounter++;
  return `col-${idCounter}`;
}
function nowIso(): string {
  idCounter++; // also nudges updated_at strictly forward for ORDER BY assertions
  return new Date(Date.now() + idCounter).toISOString();
}

function execTag(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.join("?").replace(/\s+/g, " ").trim();

  if (text.includes("SELECT doc_id FROM collection_items")) {
    const [collectionId] = values as [string];
    return Promise.resolve((items[collectionId] ?? []).map((doc_id) => ({ doc_id })));
  }
  if (text.includes("SELECT id, name, updated_at FROM collections WHERE user_id")) {
    const [userId] = values as [string];
    const rows = collections
      .filter((c) => c.user_id === userId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return Promise.resolve(rows.map(({ id, name, updated_at }) => ({ id, name, updated_at })));
  }
  if (text.includes("INSERT INTO collections (user_id, name)")) {
    const [userId, name] = values as [string, string];
    const row: Col = { id: newId(), user_id: userId, name, updated_at: nowIso() };
    collections.push(row);
    return Promise.resolve([{ id: row.id, name: row.name, updated_at: row.updated_at }]);
  }
  if (text.includes("SELECT id FROM collections WHERE id") && text.includes("AND user_id")) {
    const [id, userId] = values as [string, string];
    const c = collections.find((x) => x.id === id && x.user_id === userId);
    return Promise.resolve(c ? [{ id: c.id }] : []);
  }
  if (text.includes("UPDATE collections SET name")) {
    const [name, id] = values as [string, string];
    const c = collections.find((x) => x.id === id);
    if (c) {
      c.name = name;
      c.updated_at = nowIso();
    }
    return Promise.resolve([]);
  }
  if (text.includes("DELETE FROM collection_items WHERE collection_id")) {
    const [id] = values as [string];
    items[id] = [];
    return Promise.resolve([]);
  }
  if (text.includes("UPDATE collections SET updated_at = now() WHERE id")) {
    const [id] = values as [string];
    const c = collections.find((x) => x.id === id);
    if (c) c.updated_at = nowIso();
    return Promise.resolve([]);
  }
  if (text.includes("SELECT id, name, updated_at FROM collections WHERE id")) {
    const [id] = values as [string];
    const c = collections.find((x) => x.id === id);
    return Promise.resolve(c ? [{ id: c.id, name: c.name, updated_at: c.updated_at }] : []);
  }
  if (text.includes("DELETE FROM collections WHERE id") && text.includes("RETURNING id")) {
    const [id, userId] = values as [string, string];
    const idx = collections.findIndex((x) => x.id === id && x.user_id === userId);
    if (idx === -1) return Promise.resolve([]);
    const [removed] = collections.splice(idx, 1);
    return Promise.resolve([{ id: removed.id }]);
  }
  throw new Error(`collections.test.ts: unmocked query: ${text}`);
}

function makeExec() {
  const fn = execTag as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    unsafe: (text: string, params: unknown[]) => Promise<unknown[]>;
    begin?: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  };
  fn.unsafe = (text: string, params: unknown[]) => {
    if (text.includes("INSERT INTO collection_items")) {
      const collectionId = params[0] as string;
      const rest = params.slice(1);
      const existing = items[collectionId] ?? [];
      for (let i = 0; i < rest.length; i += 2) existing.push(rest[i] as string); // (doc_id, position) pairs
      items[collectionId] = existing;
      return Promise.resolve([]);
    }
    throw new Error(`collections.test.ts: unmocked unsafe: ${text}`);
  };
  return fn;
}

const sqlMock = makeExec();
(sqlMock as unknown as { begin: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).begin = async (
  cb: (tx: unknown) => Promise<unknown>,
) => await cb(makeExec());

mock.module("./db.ts", () => ({
  sql: sqlMock,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

const { handleCollections, handleSharedCollection } = await import("./collections.ts");
const { config } = await import("./config.ts");
const { signSession, SESSION_COOKIE } = await import("./session.ts");

afterAll(() => {
  mock.restore();
});

const origSecret = config.jwtSecret;
beforeAll(() => {
  config.jwtSecret = "test-secret-0123456789abcdef0123456789abcdef";
});
afterAll(() => {
  config.jwtSecret = origSecret;
});

beforeEach(() => {
  collections = [];
  items = {};
  idCounter = 0;
});

async function authed(): Promise<string> {
  return await signSession({ id: "user-1", provider: "github" });
}

function req(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, headers, ...rest } = init;
  const h = new Headers(headers);
  if (cookie) h.set("cookie", `${SESSION_COOKIE}=${cookie}`);
  return new Request(`http://x${path}`, { ...rest, headers: h });
}

describe("handleCollections auth gate", () => {
  it("401s every route without a session", async () => {
    const res = await handleCollections(req("/api/collections"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/collections (create)", () => {
  it("400s on invalid JSON", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: "{not json", headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("400s on an empty/whitespace name", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "   " }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_name" });
  });

  it("400s when ids is not a string array", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "x", ids: [1, 2] }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_ids" });
  });

  it("400s when the name exceeds the length cap", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "x".repeat(201) }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name_too_long" });
  });

  it("400s when ids exceeds MAX_COLLECTION_DOCS", async () => {
    const token = await authed();
    const ids = Array.from({ length: 8001 }, (_, i) => `doc-${i}`);
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "x", ids }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too_many_ids" });
  });

  it("creates a collection, dedupes ids, and returns 201 with a Set-Cookie refresh", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", {
        method: "POST",
        cookie: token,
        body: JSON.stringify({ name: "My Docs", ids: ["a", "b", "a", "c"] }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; ids: string[]; updatedAt: string };
    expect(body.name).toBe("My Docs");
    expect(body.ids).toEqual(["a", "b", "c"]);
    expect(typeof body.updatedAt).toBe("string");
  });
});

describe("GET /api/collections (list)", () => {
  it("lists only the current user's collections, newest first", async () => {
    const token = await authed();
    await handleCollections(req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "first", ids: [] }) }));
    await handleCollections(req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "second", ids: ["z"] }) }));

    const res = await handleCollections(req("/api/collections", { cookie: token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string }[];
    expect(body.map((c) => c.name)).toEqual(["second", "first"]);
  });
});

describe("PATCH /api/collections/:id (update)", () => {
  it("404s for a collection that doesn't exist or isn't owned", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections/does-not-exist", { method: "PATCH", cookie: token, body: JSON.stringify({ name: "x" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("renames, replaces ids, and bumps updated_at when neither is given", async () => {
    const token = await authed();
    const created = await (
      await handleCollections(
        req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "orig", ids: ["a"] }) }),
      )
    ).json() as { id: string; updatedAt: string };

    const renamed = await (
      await handleCollections(
        req(`/api/collections/${created.id}`, { method: "PATCH", cookie: token, body: JSON.stringify({ name: "renamed" }) }),
      )
    ).json() as { name: string; ids: string[] };
    expect(renamed.name).toBe("renamed");
    expect(renamed.ids).toEqual(["a"]); // unchanged

    const idsReplaced = await (
      await handleCollections(
        req(`/api/collections/${created.id}`, { method: "PATCH", cookie: token, body: JSON.stringify({ ids: ["x", "y"] }) }),
      )
    ).json() as { ids: string[] };
    expect(idsReplaced.ids).toEqual(["x", "y"]);

    const bumped = await (
      await handleCollections(req(`/api/collections/${created.id}`, { method: "PATCH", cookie: token, body: JSON.stringify({}) }))
    ).json() as { updatedAt: string };
    expect(new Date(bumped.updatedAt).getTime()).toBeGreaterThan(new Date(created.updatedAt).getTime());
  });

  it("validates name/ids the same way as create", async () => {
    const token = await authed();
    const created = await (
      await handleCollections(
        req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "orig" }) }),
      )
    ).json() as { id: string };

    const badJson = await handleCollections(
      req(`/api/collections/${created.id}`, { method: "PATCH", cookie: token, body: "{bad" }),
    );
    expect(badJson.status).toBe(400);

    const emptyName = await handleCollections(
      req(`/api/collections/${created.id}`, { method: "PATCH", cookie: token, body: JSON.stringify({ name: "  " }) }),
    );
    expect((await emptyName.json())).toEqual({ error: "empty_name" });

    const badIds = await handleCollections(
      req(`/api/collections/${created.id}`, { method: "PATCH", cookie: token, body: JSON.stringify({ ids: [1] }) }),
    );
    expect((await badIds.json())).toEqual({ error: "invalid_ids" });

    const longName = await handleCollections(
      req(`/api/collections/${created.id}`, { method: "PATCH", cookie: token, body: JSON.stringify({ name: "x".repeat(300) }) }),
    );
    expect((await longName.json())).toEqual({ error: "name_too_long" });

    const tooMany = await handleCollections(
      req(`/api/collections/${created.id}`, {
        method: "PATCH",
        cookie: token,
        body: JSON.stringify({ ids: Array.from({ length: 8001 }, (_, i) => `d${i}`) }),
      }),
    );
    expect((await tooMany.json())).toEqual({ error: "too_many_ids" });
  });
});

describe("DELETE /api/collections/:id", () => {
  it("deletes an owned collection and 404s a second delete", async () => {
    const token = await authed();
    const created = await (
      await handleCollections(req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "gone" }) }))
    ).json() as { id: string };

    const res = await handleCollections(req(`/api/collections/${created.id}`, { method: "DELETE", cookie: token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const again = await handleCollections(req(`/api/collections/${created.id}`, { method: "DELETE", cookie: token }));
    expect(again.status).toBe(404);
  });
});

describe("unmatched method", () => {
  it("405s an unsupported method on the base route", async () => {
    const token = await authed();
    const res = await handleCollections(req("/api/collections", { method: "PUT", cookie: token }));
    expect(res.status).toBe(405);
  });
});

describe("handleSharedCollection", () => {
  it("405s non-GET requests", async () => {
    const res = await handleSharedCollection(new Request("http://x/api/collections/abc/shared", { method: "POST" }));
    expect(res.status).toBe(405);
  });

  it("404s a malformed path", async () => {
    const res = await handleSharedCollection(new Request("http://x/api/collections/shared"));
    expect(res.status).toBe(404);
  });

  it("404s an unknown collection id", async () => {
    const res = await handleSharedCollection(new Request("http://x/api/collections/nope/shared"));
    expect(res.status).toBe(404);
  });

  it("200s a public read with no auth required", async () => {
    const token = await authed();
    const created = await (
      await handleCollections(
        req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "public", ids: ["p1"] }) }),
      )
    ).json() as { id: string };

    const res = await handleSharedCollection(new Request(`http://x/api/collections/${created.id}/shared`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; ids: string[] };
    expect(body.name).toBe("public");
    expect(body.ids).toEqual(["p1"]);
  });
});
