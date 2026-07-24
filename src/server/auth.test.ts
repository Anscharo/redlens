import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

let inserted: unknown[] = [];
let rows: unknown[] = [{ id: "user-1" }];

mock.module("./db.ts", () => ({
  sql(_strings: TemplateStringsArray, ...values: unknown[]) {
    inserted = values;
    return Promise.resolve(rows);
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

const { upsertUser, deleteAccount, handleAuth } = await import("./auth.ts");
const { config } = await import("./config.ts");
const { signSession, SESSION_COOKIE } = await import("./session.ts");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  inserted = [];
  rows = [{ id: "user-1" }];
});

describe("upsertUser", () => {
  it("upserts by provider identity and returns the session user", async () => {
    const user = await upsertUser(
      "github",
      "123",
      "ada@example.com",
      "Ada",
      "https://avatar.example/ada.png",
    );

    expect(user).toEqual({ id: "user-1", provider: "github" });
    expect(inserted).toEqual(["github", "123", "ada@example.com", "Ada", "https://avatar.example/ada.png"]);
  });

  it("passes nullable OAuth profile fields through to SQL", async () => {
    const user = await upsertUser("google", "sub-1", null, null, null);

    expect(user).toEqual({ id: "user-1", provider: "google" });
    expect(inserted).toEqual(["google", "sub-1", null, null, null]);
  });
});

describe("deleteAccount", () => {
  it("issues a DELETE scoped to the given user id", async () => {
    await deleteAccount("user-1");
    expect(inserted).toEqual(["user-1"]);
  });
});

describe("provider route guards", () => {
  it("github start route 500s when GitHub isn't configured", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/github", { method: "GET" }), "/api/auth/github");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "oauth_not_configured" });
  });

  it("google start route 500s when Google isn't configured", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/google", { method: "GET" }), "/api/auth/google");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "oauth_not_configured" });
  });
});

describe("DELETE /api/auth/me", () => {
  // Sign a real session cookie via a scoped jwt secret (restored after) rather
  // than mocking session.ts — Bun module mocks are global and would leak.
  const origSecret = config.jwtSecret;
  beforeEach(() => {
    config.jwtSecret = "test-secret-0123456789abcdef0123456789abcdef";
  });
  afterAll(() => {
    config.jwtSecret = origSecret;
  });

  it("401s and runs no delete when there is no session", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/me", { method: "DELETE" }), "/api/auth/me");
    expect(res.status).toBe(401);
    expect(inserted).toEqual([]); // no SQL touched the DB
  });

  it("deletes the signed-in user and clears the session cookie", async () => {
    const token = await signSession({ id: "user-1", provider: "github" });
    const req = new Request("http://x/api/auth/me", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(inserted).toEqual(["user-1"]); // DELETE scoped to the session user
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0"); // cookie expired
  });
});
