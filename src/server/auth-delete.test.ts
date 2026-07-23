import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// Exercises the DELETE /api/auth/me (account deletion) branch of handleAuth.
// db.ts and session.ts are mocked so the test needs no Postgres and no real JWT.
let sqlCalls: { strings: string; values: unknown[] }[] = [];
let session: { user: { id: string; provider: string } } | null = null;

mock.module("./db.ts", () => ({
  sql(strings: TemplateStringsArray, ...values: unknown[]) {
    sqlCalls.push({ strings: strings.join("?"), values });
    return Promise.resolve([]);
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

// Provide every named export auth.ts imports (ESM binds them all at load time);
// only getSessionUser + clearSessionCookie matter for the delete path.
mock.module("./session.ts", () => ({
  getSessionUser: () => Promise.resolve(session),
  signSession: () => Promise.resolve("token"),
  sessionCookie: () => "sky_session=token",
  clearSessionCookie: () => "sky_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  stateCookie: () => "sky_oauth_state=s",
  clearStateCookie: () => "sky_oauth_state=; Max-Age=0",
  verifierCookie: () => "sky_oauth_verifier=v",
  clearVerifierCookie: () => "sky_oauth_verifier=; Max-Age=0",
  parseCookies: () => ({}),
  STATE_COOKIE: "sky_oauth_state",
  VERIFIER_COOKIE: "sky_oauth_verifier",
}));

const { handleAuth } = await import("./auth.ts");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  sqlCalls = [];
  session = null;
});

describe("DELETE /api/auth/me", () => {
  it("401s and touches no data when unauthenticated", async () => {
    session = null;
    const res = await handleAuth(new Request("http://x/api/auth/me", { method: "DELETE" }), "/api/auth/me");
    expect(res.status).toBe(401);
    expect(sqlCalls).toHaveLength(0);
  });

  it("deletes the signed-in user and clears the session cookie", async () => {
    session = { user: { id: "user-1", provider: "github" } };
    const res = await handleAuth(new Request("http://x/api/auth/me", { method: "DELETE" }), "/api/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Exactly one DELETE, scoped to the session user's id.
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].strings).toContain("DELETE FROM users");
    expect(sqlCalls[0].values).toEqual(["user-1"]);
    // Session cookie is expired on the way out.
    expect(res.headers.get("set-cookie")).toContain("sky_session=");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
