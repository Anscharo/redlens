// access.ts: per-visitor access gate for private atlas previews. Mocks
// ../session.ts (getSessionUser), ./github-app.ts (userRepoPermission), and
// ../db.ts (sql) — same mock.module-before-import pattern as auth.test.ts /
// preview/db.test.ts. __resetAccessCacheForTest() runs in beforeEach so one
// test's cached decision can't leak into the next.
import { test, expect, mock, beforeEach, afterEach, afterAll } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "../pg-array.ts";
import crypto from "node:crypto";
import { config } from "../config.ts";
import { __resetCachesForTest } from "./github-app.ts";

// NOTE: we deliberately do NOT mock.module("./github-app.ts") here. Bun's
// mock.module is process-global, and github-app.test.ts links the REAL module —
// a stub of userRepoPermission here would win for that sibling file too (its
// real-behavior tests would then run against our stub). Instead we let the real
// github-app run and drive its OUTCOME through a stubbed global fetch (the same
// approach github-app.test.ts uses), so github-app never enters the module-mock
// registry and there's nothing to leak. session + db stay module-mocked (no
// sibling links their real exports through a partial factory).

// The signed-in user for the current test (null = signed out), applied via a
// REAL signed session cookie in req() below — deliberately NOT a
// mock.module("../session.ts"). bun runs every test file's module-level
// mock.module before any tests, and mock.module persists process-globally, so a
// PARTIAL session mock (getSessionUser only) would strip signSession /
// SESSION_COOKIE from sibling files that import them (chat.test.ts /
// conversations.test.ts build their own auth cookies), breaking those suites
// depending on file-discovery order. See chat.test.ts's note on mock.module.
let sessionResult: { user: { id: string; provider: string } } | null = null;
config.jwtSecret ||= "test-jwt-secret";

// Drives the REAL userRepoPermission via fetch. "grant" returns permission+id;
// "forbidden" is GitHub's 404 for a non-collaborator; "unavailable" is a 5xx.
// permFetches counts collaborator-permission hits (== old permCalls): the
// installation-lookup + token-mint calls are cached per-repo within a test.
let permMode: "grant" | "forbidden" | "unavailable" = "unavailable";
let grantUserId = 42;
let permFetches = 0;
const realFetch = globalThis.fetch;
function installFetch(): void {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/installation")) return Response.json({ id: 1 });
    if (u.endsWith("/access_tokens")) return Response.json({ token: "inst-tok" });
    if (u.includes("/collaborators/")) {
      permFetches++;
      if (permMode === "forbidden") return new Response("no", { status: 404 });
      if (permMode === "unavailable") return new Response("err", { status: 500 });
      return Response.json({ permission: "write", user: { id: grantUserId } });
    }
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
}

// A real RSA key so the real appJwt() can sign; the value is irrelevant to the
// stubbed fetch, only that signing succeeds.
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
config.githubAppId = "1";
config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

let queuedUserRows: unknown[] = [];
mock.module("../db.ts", () => ({
  sql(_strings: TemplateStringsArray, ..._values: unknown[]) {
    return Promise.resolve(queuedUserRows);
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  // Real impls, never re-stubbed: `Array.isArray("{uuid,uuid}")` is false, so a
  // hand-rolled stub silently returns [] for what Bun.sql actually hands back.
  // See pg-array.ts; enforced by scripts/aux/audit-mock-modules.mjs.
  toUuidArrayLiteral,
  fromUuidArray,
}));

const { authorizePreviewAccess, __resetAccessCacheForTest } = await import("./access.ts");
const { signSession, SESSION_COOKIE } = await import("../session.ts");

const REPO = "sky-ecosystem/next-gen-atlas";
// Attach a real signed session cookie for `sessionResult` (or none when null),
// so access.ts's real getSessionUser resolves the same user the test intends —
// without globally mocking ../session.ts.
async function req(): Promise<Request> {
  const headers = new Headers();
  if (sessionResult) headers.set("cookie", `${SESSION_COOKIE}=${await signSession(sessionResult.user)}`);
  return new Request("https://example.com/api/preview/deadbeef/docs.json", { headers });
}

// mock.module is process-global in Bun; restore the ../session.ts + ../db.ts
// overrides so they don't leak into sibling test files in the shared
// `bun test src/server` process.
afterAll(() => mock.restore());

beforeEach(() => {
  __resetAccessCacheForTest();
  __resetCachesForTest(); // github-app installation/token caches
  sessionResult = null;
  queuedUserRows = [];
  permMode = "unavailable";
  grantUserId = 42;
  permFetches = 0;
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("no session -> login-required", async () => {
  sessionResult = null;
  expect(await authorizePreviewAccess(await req(), REPO)).toBe("login-required");
});

test("github user, matching numeric id, permission granted -> ok", async () => {
  sessionResult = { user: { id: "u1", provider: "github" } };
  queuedUserRows = [{ provider: "github", provider_id: "42", github_login: "alice" }];
  permMode = "grant";
  grantUserId = 42;
  expect(await authorizePreviewAccess(await req(), REPO)).toBe("ok");
});

test("google user -> forbidden", async () => {
  sessionResult = { user: { id: "u2", provider: "google" } };
  queuedUserRows = [{ provider: "google", provider_id: "99", github_login: null }];
  expect(await authorizePreviewAccess(await req(), REPO)).toBe("forbidden");
});

test("missing user row -> forbidden", async () => {
  sessionResult = { user: { id: "ghost", provider: "github" } };
  queuedUserRows = [];
  expect(await authorizePreviewAccess(await req(), REPO)).toBe("forbidden");
});

test("github user with github_login null (pre-migration) -> login-required", async () => {
  sessionResult = { user: { id: "u3", provider: "github" } };
  queuedUserRows = [{ provider: "github", provider_id: "7", github_login: null }];
  expect(await authorizePreviewAccess(await req(), REPO)).toBe("login-required");
});

test("userRepoPermission forbidden -> forbidden", async () => {
  sessionResult = { user: { id: "u4", provider: "github" } };
  queuedUserRows = [{ provider: "github", provider_id: "8", github_login: "bob" }];
  permMode = "forbidden";
  expect(await authorizePreviewAccess(await req(), REPO)).toBe("forbidden");
});

test("userRepoPermission unavailable -> unavailable, and is NOT cached", async () => {
  sessionResult = { user: { id: "u5", provider: "github" } };
  queuedUserRows = [{ provider: "github", provider_id: "9", github_login: "carol" }];
  permMode = "unavailable";

  expect(await authorizePreviewAccess(await req(), REPO)).toBe("unavailable");
  expect(await authorizePreviewAccess(await req(), REPO)).toBe("unavailable");
  expect(permFetches).toBe(2); // no caching -> re-checked both times
});

test("G4: perm.ok but userId mismatches stored provider_id -> forbidden", async () => {
  sessionResult = { user: { id: "u6", provider: "github" } };
  queuedUserRows = [{ provider: "github", provider_id: "10", github_login: "dave" }];
  permMode = "grant";
  grantUserId = 999; // != stored provider_id 10
  expect(await authorizePreviewAccess(await req(), REPO)).toBe("forbidden");
});

test("negative caching: two consecutive forbidden calls invoke userRepoPermission once", async () => {
  sessionResult = { user: { id: "u7", provider: "github" } };
  queuedUserRows = [{ provider: "github", provider_id: "11", github_login: "erin" }];
  permMode = "forbidden";

  expect(await authorizePreviewAccess(await req(), REPO)).toBe("forbidden");
  expect(await authorizePreviewAccess(await req(), REPO)).toBe("forbidden");
  expect(permFetches).toBe(1); // second call hit the negative cache
});
