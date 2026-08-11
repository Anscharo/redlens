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
  appInstallUrl,
  installationIdForRepo,
  installationToken,
  userRepoPermission,
  normalizePem,
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

test("normalizePem: every env-mangled form of a key still signs (Railway paste shapes)", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const b64 = Buffer.from(pkcs1, "utf8").toString("base64"); // `base64 -w0 key.pem`

  const forms: [string, string][] = [
    ["pristine PKCS#1", pkcs1],
    ["pristine PKCS#8", pkcs8],
    ["escaped \\n", pkcs1.replace(/\n/g, "\\n")],
    ["escaped \\r\\n", pkcs1.replace(/\n/g, "\\r\\n")],
    ["CRLF", pkcs1.replace(/\n/g, "\r\n")],
    ["quoted + escaped", `"${pkcs1.replace(/\n/g, "\\n")}"`],
    ["no trailing newline", pkcs1.trimEnd()],
    ["newlines collapsed to spaces", pkcs1.replace(/\n/g, " ")],
    ["base64 single line", b64],
    ["base64 wrapped", b64.match(/.{1,76}/g)!.join("\n")],
  ];

  for (const [name, mangled] of forms) {
    const sig = crypto.createSign("RSA-SHA256").update("payload").sign(normalizePem(mangled));
    const ok = crypto.createVerify("RSA-SHA256").update("payload").verify(publicPem, sig);
    expect(ok, name).toBe(true);
  }
});

test("normalizePem: a non-PEM, non-base64 value is returned untouched so signing fails loudly", () => {
  expect(normalizePem("not a key")).toBe("not a key");
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
// installationToken: reinstall recovery
// ---------------------------------------------------------------------------

test("installationToken: a mint failure evicts the stale installation id so a reinstall recovers", async () => {
  let installationLookups = 0;
  let mintOk = false;
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    const u = String(url);
    if (u.endsWith("/installation")) {
      installationLookups++;
      // A reinstall would mint a new id; the id value itself doesn't matter here.
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ id: 100 + installationLookups }) } as Response);
    }
    if (u.endsWith("/access_tokens")) {
      return Promise.resolve(
        mintOk
          ? ({ status: 201, ok: true, json: () => Promise.resolve({ token: "tok" }) } as Response)
          : ({ status: 404, ok: false, json: () => Promise.resolve({}) } as Response),
      );
    }
    throw new Error(`unexpected url in test stub: ${u}`);
  };

  // App "uninstalled": the cached id's mint 404s → null, and the stale id is evicted.
  expect(await installationToken("o/r")).toBeNull();
  // App reinstalled: mint now succeeds. Because the stale id was evicted, the next
  // call re-runs the installation lookup instead of retrying the dead id.
  mintOk = true;
  expect(await installationToken("o/r")).toBe("tok");
  expect(installationLookups).toBe(2);
});

// ---------------------------------------------------------------------------
// appInstallUrl
// ---------------------------------------------------------------------------

test("appInstallUrl: GET /app slug -> install URL, cached across calls", async () => {
  let calls = 0;
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    calls++;
    expect(String(url)).toBe("https://api.github.com/app");
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ slug: "redlens-preview" }) } as Response);
  };
  expect(await appInstallUrl()).toBe("https://github.com/apps/redlens-preview/installations/new");
  // Second call is served from cache — no extra /app fetch.
  expect(await appInstallUrl()).toBe("https://github.com/apps/redlens-preview/installations/new");
  expect(calls).toBe(1);
});

test("appInstallUrl: failed /app -> null, not cached (retries next call)", async () => {
  let calls = 0;
  // @ts-expect-error stub
  globalThis.fetch = () => {
    calls++;
    // First call fails (5xx), second returns the slug.
    if (calls === 1) return Promise.resolve({ status: 500, ok: false, json: () => Promise.resolve({}) } as Response);
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ slug: "later" }) } as Response);
  };
  expect(await appInstallUrl()).toBeNull(); // failure is not cached
  expect(await appInstallUrl()).toBe("https://github.com/apps/later/installations/new");
  expect(calls).toBe(2);
});

test("appInstallUrl: unconfigured app -> null without any fetch", async () => {
  config.githubAppId = "";
  let calls = 0;
  // @ts-expect-error stub
  globalThis.fetch = () => {
    calls++;
    throw new Error("should not fetch when unconfigured");
  };
  expect(await appInstallUrl()).toBeNull();
  expect(calls).toBe(0);
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
