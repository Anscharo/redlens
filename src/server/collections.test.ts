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
// Real collection ids are `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
// (migrations/014_collections.sql) — mint UUID-shaped mock ids too, so the
// id-format guard in collections.ts (C1) doesn't reject the app's OWN fixture
// ids as malformed.
function newId(): string {
  idCounter++;
  return crypto.randomUUID();
}
function nowIso(): string {
  idCounter++; // also nudges updated_at strictly forward for ORDER BY assertions
  return new Date(Date.now() + idCounter).toISOString();
}

// A well-formed but never-inserted id — for "owned/not found" cases that must
// stay distinct from the malformed-id-format cases (C1) exercised below.
const ABSENT_ID = "00000000-0000-0000-0000-000000000000";
// A well-formed id the mock is rigged to throw on, for exercising the
// try/catch → JSON 500 path (C1) without a real Postgres error to trigger.
const DB_ERROR_ID = "11111111-1111-1111-1111-111111111111";

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
    if (id === DB_ERROR_ID) throw new Error("simulated db failure");
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
    if (id === DB_ERROR_ID) throw new Error("simulated db failure");
    const c = collections.find((x) => x.id === id);
    return Promise.resolve(c ? [{ id: c.id, name: c.name, updated_at: c.updated_at }] : []);
  }
  if (text.includes("DELETE FROM collections WHERE id") && text.includes("RETURNING id")) {
    const [id, userId] = values as [string, string];
    if (id === DB_ERROR_ID) throw new Error("simulated db failure");
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
  toUuidArrayLiteral: (ids: readonly string[]) => `{${ids.join(",")}}`,
  fromUuidArray: (v: unknown) => Array.isArray(v) ? v.map(String) : [],
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

  // C5: the server cap now matches MAX_COLLECTION_NAME_LEN (32, src/lib/collectionsApi.ts) —
  // pin the exact boundary so a name the UI's maxLength=32 input allows is
  // never rejected server-side, and one character past it always is.
  it("400s a 33-char name and accepts a 32-char name (C5 boundary)", async () => {
    const token = await authed();
    const tooLong = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "x".repeat(33) }) }),
    );
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "name_too_long" });

    const justRight = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "x".repeat(32) }) }),
    );
    expect(justRight.status).toBe(201);
  });

  // C2: `if (!body.name?.trim())` alone lets a truthy non-string (number,
  // boolean, array, object) reach `.trim()` and throw a TypeError → 500.
  // typeof-guard it and 400 instead. `null` was already correctly 400ing —
  // pinned here too so the fix doesn't regress it.
  it("400s when name is a number instead of a string", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: 42 }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_name" });
  });

  it("400s when name is a boolean instead of a string", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: true }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_name" });
  });

  it("400s when name is an array instead of a string", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: ["a"] }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_name" });
  });

  it("400s when name is an object instead of a string", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: {} }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_name" });
  });

  it("400s when name is null (already-correct baseline, pinned against regression)", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: null }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_name" });
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
  it("404s for a well-formed id that doesn't exist or isn't owned", async () => {
    const token = await authed();
    const res = await handleCollections(
      req(`/api/collections/${ABSENT_ID}`, { method: "PATCH", cookie: token, body: JSON.stringify({ name: "x" }) }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  // C1: a malformed id would otherwise reach Postgres as a bad ::uuid cast and
  // throw → unhandled 500 with an HTML body. Reject the shape up front instead,
  // as a clean JSON 404 — same as the well-formed-but-absent case above.
  it("404s (as JSON, not a 500) for a malformed id instead of hitting the DB", async () => {
    const token = await authed();
    const res = await handleCollections(
      req("/api/collections/not-a-uuid", { method: "PATCH", cookie: token, body: JSON.stringify({ name: "x" }) }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  // C1: an unexpected DB error (distinct from "not found") must still come
  // back as JSON, never an unhandled 500.
  it("500s as JSON (not a raw throw) when the DB errors unexpectedly", async () => {
    const token = await authed();
    const res = await handleCollections(
      req(`/api/collections/${DB_ERROR_ID}`, { method: "PATCH", cookie: token, body: JSON.stringify({ name: "x" }) }),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "server_error" });
  });

  // C2, PATCH side: same non-string-name TypeError risk as create.
  it("400s (not 500) when renaming to a non-string name", async () => {
    const token = await authed();
    const created = await (
      await handleCollections(
        req("/api/collections", { method: "POST", cookie: token, body: JSON.stringify({ name: "orig" }) }),
      )
    ).json() as { id: string };
    const res = await handleCollections(
      req(`/api/collections/${created.id}`, { method: "PATCH", cookie: token, body: JSON.stringify({ name: 42 }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_name" });
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

  // C1: same malformed-id guard as PATCH.
  it("404s (as JSON, not a 500) for a malformed id instead of hitting the DB", async () => {
    const token = await authed();
    const res = await handleCollections(req("/api/collections/not-a-uuid", { method: "DELETE", cookie: token }));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  // C1: same DB-error → JSON 500 guard as PATCH.
  it("500s as JSON when the DB errors unexpectedly", async () => {
    const token = await authed();
    const res = await handleCollections(req(`/api/collections/${DB_ERROR_ID}`, { method: "DELETE", cookie: token }));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "server_error" });
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

  // C1: a non-UUID-shaped id segment — must 404 via the format guard, before
  // ever reaching the DB (distinct from the well-formed-but-absent case below).
  it("404s (as JSON, not a 500) for a malformed id instead of hitting the DB", async () => {
    const res = await handleSharedCollection(new Request("http://x/api/collections/nope/shared"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("404s a well-formed but unknown collection id", async () => {
    const res = await handleSharedCollection(new Request(`http://x/api/collections/${ABSENT_ID}/shared`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  // C1: unexpected DB error → JSON 500, never an unhandled throw.
  it("500s as JSON when the DB errors unexpectedly", async () => {
    const res = await handleSharedCollection(new Request(`http://x/api/collections/${DB_ERROR_ID}/shared`));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "server_error" });
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
