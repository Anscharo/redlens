// github-app.ts: App JWT signing + installation token minting + permission
// checks. Stubs globalThis.fetch the same way tarball-fetch.test.ts does,
// restored in afterEach. Caches are reset between tests via
// __resetCachesForTest so one test's mocked responses can't leak into the
// next through the module-level Maps.
import { test, expect, beforeEach, afterEach } from "bun:test";
import crypto from "node:crypto";
import { config } from "../config.ts";
import {
  appJwt,
  installationIdForRepo,
  userRepoPermission,
  __resetCachesForTest,
} from "./github-app.ts";

const realFetch = globalThis.fetch;
const realAppId = config.githubAppId;
const realPrivateKey = config.githubAppPrivateKey;

// Default signing key for tests that don't care about the JWT itself (the
// installationIdForRepo / userRepoPermission tests below) — appJwt() is on
// the call path for all of them, so config needs a usable key even though
// those tests only assert on the mocked HTTP responses.
const { privateKey: defaultPrivateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const defaultPkcs1Pem = defaultPrivateKey.export({ type: "pkcs1", format: "pem" }).toString();

beforeEach(() => {
  __resetCachesForTest();
  config.githubAppId = "test-app-id";
  config.githubAppPrivateKey = defaultPkcs1Pem;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  config.githubAppId = realAppId;
  config.githubAppPrivateKey = realPrivateKey;
});

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

// ---------------------------------------------------------------------------
// appJwt
// ---------------------------------------------------------------------------

test("appJwt: signs a 3-segment RS256 JWT verifiable against the matching public key, PKCS#1 PEM input", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs1Pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  config.githubAppId = "12345";
  config.githubAppPrivateKey = pkcs1Pem;

  const jwt = await appJwt();
  const parts = jwt.split(".");
  expect(parts.length).toBe(3);

  const header = JSON.parse(b64urlDecode(parts[0]!).toString("utf8"));
  expect(header).toEqual({ alg: "RS256", typ: "JWT" });

  const payload = JSON.parse(b64urlDecode(parts[1]!).toString("utf8"));
  expect(payload.iss).toBe("12345");
  expect(typeof payload.iat).toBe("number");
  expect(typeof payload.exp).toBe("number");

  const signingInput = `${parts[0]}.${parts[1]}`;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signingInput);
  const ok = verifier.verify(publicPem, b64urlDecode(parts[2]!));
  expect(ok).toBe(true);
});

test("appJwt: normalizes literal \\n escapes in the PEM (Railway-style env value)", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs1Pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  config.githubAppId = "1";
  config.githubAppPrivateKey = pkcs1Pem.replace(/\n/g, "\\n"); // simulate Railway escaping

  const jwt = await appJwt();
  const [h, p, s] = jwt.split(".");
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  expect(verifier.verify(publicPem, b64urlDecode(s!))).toBe(true);
});

// ---------------------------------------------------------------------------
// installationIdForRepo
// ---------------------------------------------------------------------------

test("installationIdForRepo: 404 (app not installed) -> null", async () => {
  // @ts-expect-error stub
  globalThis.fetch = () => Promise.resolve({ status: 404, ok: false, json: () => Promise.resolve({}) } as Response);
  const id = await installationIdForRepo("owner/private-repo");
  expect(id).toBeNull();
});

test("installationIdForRepo: 200 -> numeric id", async () => {
  // @ts-expect-error stub
  globalThis.fetch = () =>
    Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ id: 999 }) } as Response);
  const id = await installationIdForRepo("owner/private-repo-2");
  expect(id).toBe(999);
});

// ---------------------------------------------------------------------------
// userRepoPermission
// ---------------------------------------------------------------------------

// Builds a fetch stub that dispatches by URL shape: installation lookup ->
// access token mint -> collaborator permission check, so a single mock can
// drive userRepoPermission's full call chain.
function stubChain(permissionResponse: { status: number; body: any }) {
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    const u = String(url);
    if (u.endsWith("/installation")) {
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ id: 1 }) } as Response);
    }
    if (u.endsWith("/access_tokens")) {
      return Promise.resolve({
        status: 201,
        ok: true,
        json: () => Promise.resolve({ token: "installation-token-abc" }),
      } as Response);
    }
    if (u.includes("/collaborators/")) {
      return Promise.resolve({
        status: permissionResponse.status,
        ok: permissionResponse.status >= 200 && permissionResponse.status < 300,
        json: () => Promise.resolve(permissionResponse.body),
      } as Response);
    }
    throw new Error(`unexpected url in test stub: ${u}`);
  };
}

test("userRepoPermission: grants on 200 permission:admin with numeric user.id", async () => {
  stubChain({ status: 200, body: { permission: "admin", user: { id: 42 } } });
  const result = await userRepoPermission("owner/repo-admin", "alice");
  expect(result).toEqual({ ok: true, userId: 42, permission: "admin" });
});

test("userRepoPermission: grants on 200 permission:write with numeric user.id", async () => {
  stubChain({ status: 200, body: { permission: "write", user: { id: 43 } } });
  const result = await userRepoPermission("owner/repo-write", "bob");
  expect(result).toEqual({ ok: true, userId: 43, permission: "write" });
});

test("userRepoPermission: grants on 200 permission:read with numeric user.id", async () => {
  stubChain({ status: 200, body: { permission: "read", user: { id: 44 } } });
  const result = await userRepoPermission("owner/repo-read", "carol");
  expect(result).toEqual({ ok: true, userId: 44, permission: "read" });
});

test("userRepoPermission: denies forbidden on 404", async () => {
  stubChain({ status: 404, body: {} });
  const result = await userRepoPermission("owner/repo-404", "dave");
  expect(result).toEqual({ ok: false, reason: "forbidden" });
});

test("userRepoPermission: denies forbidden on 200 permission:none", async () => {
  stubChain({ status: 200, body: { permission: "none", user: { id: 45 } } });
  const result = await userRepoPermission("owner/repo-none", "erin");
  expect(result).toEqual({ ok: false, reason: "forbidden" });
});

test("userRepoPermission: denies unavailable on 500", async () => {
  stubChain({ status: 500, body: {} });
  const result = await userRepoPermission("owner/repo-500", "frank");
  expect(result).toEqual({ ok: false, reason: "unavailable" });
});

test("userRepoPermission: denies unavailable when fetch throws", async () => {
  // @ts-expect-error stub
  globalThis.fetch = () => {
    throw new Error("network down");
  };
  const result = await userRepoPermission("owner/repo-throw", "gina");
  expect(result).toEqual({ ok: false, reason: "unavailable" });
});

test("userRepoPermission: denies unavailable when installation token mint fails", async () => {
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    const u = String(url);
    if (u.endsWith("/installation")) {
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ id: 1 }) } as Response);
    }
    if (u.endsWith("/access_tokens")) {
      return Promise.resolve({ status: 500, ok: false, json: () => Promise.resolve({}) } as Response);
    }
    throw new Error(`unexpected url in test stub: ${u}`);
  };
  const result = await userRepoPermission("owner/repo-mint-fail", "hank");
  expect(result).toEqual({ ok: false, reason: "unavailable" });
});
