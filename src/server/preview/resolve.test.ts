// Private-preview branch of resolve.ts: resolvePrivacy + the resolveRef routing
// it feeds. Mocks ./github-app.ts (installationIdForRepo, installationToken) —
// same mock.module-before-import pattern as access.test.ts. config.ts is a
// plain object export; privatePreviewsEnabled is toggled directly (same
// pattern auth.test.ts uses for other config flags) and restored after.
import { test, expect, beforeEach, afterEach } from "bun:test";
import crypto from "node:crypto";

// We do NOT mock.module("./github-app.ts"): Bun's mock.module is process-global,
// so a partial stub here would win for the sibling github-app.test.ts (which
// links the REAL module) in the shared `bun test src/server` run. Instead the
// real github-app runs and its installation-lookup / token-mint calls are driven
// through a stubbed global fetch (installedId / mintedToken below). config.ts is
// a plain object; privatePreviewsEnabled is toggled directly, restored per test.
import { resolveRef, resolvePrivacy, decodeId } from "./resolve.ts";
import { __resetCachesForTest } from "./github-app.ts";
import { config } from "../config.ts";

function fakeGh(map: Record<string, { ok?: boolean; status?: number; json: any }>): any {
  return {
    async fetchJson(p: string) {
      const r = map[p];
      if (!r) return { ok: false, status: 404, json: null };
      return { ok: r.ok ?? true, status: r.status ?? 200, json: r.json };
    },
  };
}

const realFetch = globalThis.fetch;
const origPrivate = config.privatePreviewsEnabled;

// Real RSA key so the real appJwt() can sign; the stubbed fetch ignores the JWT.
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
config.githubAppId = "1";
config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

// Drives the REAL installationIdForRepo/installationToken plus the installation-
// token branch lookup: GET …/installation → installedId (404 when null); POST
// …/access_tokens → mintedToken (500 when null); GET …/branches/<ref> → branchJson
// (404 when null). lastBranchReq captures the branch call for URL/auth assertions.
let installedId: number | null = null;
let mintedToken: string | null = null;
let branchJson: any = null;
let lastBranchReq: { url: string; headers: any } | null = null;
function installFetch(): void {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/installation")) return installedId == null ? new Response("no", { status: 404 }) : Response.json({ id: installedId });
    if (u.endsWith("/access_tokens")) return mintedToken == null ? new Response("no", { status: 500 }) : Response.json({ token: mintedToken });
    if (u.includes("/branches/")) {
      lastBranchReq = { url: u, headers: init?.headers };
      return branchJson == null ? new Response("no", { status: 404 }) : Response.json(branchJson);
    }
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  __resetCachesForTest();
  installedId = null;
  mintedToken = null;
  branchJson = null;
  lastBranchReq = null;
  config.privatePreviewsEnabled = false;
  installFetch();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.privatePreviewsEnabled = origPrivate;
});

// ---------------------------------------------------------------------------
// resolvePrivacy (pure-ish, only touches the mocked github-app + passed gh)
// ---------------------------------------------------------------------------

test("resolvePrivacy: repo visible + private:false -> public", async () => {
  const gh = fakeGh({ "/repos/acme/atlas-fork": { json: { private: false } } });
  expect(await resolvePrivacy("acme/atlas-fork", gh)).toBe("public");
});

test("resolvePrivacy: repo visible + private:true -> private", async () => {
  const gh = fakeGh({ "/repos/acme/atlas-fork": { json: { private: true } } });
  expect(await resolvePrivacy("acme/atlas-fork", gh)).toBe("private");
});

test("resolvePrivacy: 404 + App installed -> private", async () => {
  installedId = 555;
  const gh = fakeGh({}); // 404 (not in map)
  expect(await resolvePrivacy("acme/secret-atlas", gh)).toBe("private");
});

test("resolvePrivacy: 404 + App not installed -> app-not-installed", async () => {
  installedId = null;
  const gh = fakeGh({});
  expect(await resolvePrivacy("acme/secret-atlas", gh)).toBe("app-not-installed");
});

test("resolvePrivacy: other non-ok status -> not-found", async () => {
  const gh = fakeGh({ "/repos/acme/atlas-fork": { ok: false, status: 500, json: null } });
  expect(await resolvePrivacy("acme/atlas-fork", gh)).toBe("not-found");
});

// ---------------------------------------------------------------------------
// resolveRef: branch-path privacy routing
// ---------------------------------------------------------------------------

test("resolveRef: gate ON, private repo, App installed -> private:true via installation token", async () => {
  config.privatePreviewsEnabled = true;
  installedId = 42;
  mintedToken = "inst-tok";
  // resolveRef builds its own GhClient from the installation token (real
  // makeGhClient -> real fetch); installFetch serves the branch lookup.
  branchJson = { commit: { sha: "privtip", commit: { committer: { date: "2026-07-01T00:00:00Z" } } } };
  const gh = fakeGh({}); // service token can't see the repo -> 404

  const r = await resolveRef(decodeId("acme:secret-atlas:main")!, gh);
  expect(r).toMatchObject({
    repo: "acme/secret-atlas",
    sha: "privtip",
    kind: "branch",
    ref: "main",
    private: true,
    date: "2026-07-01T00:00:00Z",
  });
  // The branch lookup went through the installation token, to the right URL.
  expect(lastBranchReq?.url).toBe("https://api.github.com/repos/acme/secret-atlas/branches/main");
  expect((lastBranchReq?.headers as any)?.authorization).toBe("Bearer inst-tok");
});

test("resolveRef: gate ON, private repo, App not installed -> app-not-installed error", async () => {
  config.privatePreviewsEnabled = true;
  installedId = null; // App not installed
  const gh = fakeGh({}); // 404 on the service-token repo lookup
  const r = await resolveRef(decodeId("acme:secret-atlas:main")!, gh);
  expect(r).toEqual({ error: "app-not-installed" });
});

test("resolveRef: gate ON, private repo, App installed but token mint fails -> app-not-installed", async () => {
  config.privatePreviewsEnabled = true;
  installedId = 42;
  mintedToken = null; // mint failure
  const gh = fakeGh({}); // 404
  const r = await resolveRef(decodeId("acme:secret-atlas:main")!, gh);
  expect(r).toEqual({ error: "app-not-installed" });
});

test("resolveRef: gate ON, PUBLIC non-canonical repo falls through to the existing fork-lineage path unchanged", async () => {
  config.privatePreviewsEnabled = true;
  const gh = fakeGh({
    "/repos/blimpa/next-gen-atlas": { json: { private: false, fork: true, source: { full_name: "sky-ecosystem/next-gen-atlas" } } },
    "/repos/blimpa/next-gen-atlas/branches/spark": { json: { commit: { sha: "forktip" } } },
  });
  const r = await resolveRef(decodeId("blimpa:spark")!, gh);
  expect(r).toMatchObject({ repo: "blimpa/next-gen-atlas", sha: "forktip", kind: "branch", private: false });
});

test("resolveRef: gate OFF, a structurally-private repo still behaves exactly as before (not-found / not-a-fork)", async () => {
  config.privatePreviewsEnabled = false; // master gate off -> resolvePrivacy never runs
  // Service token 404s on the repo (as a real private repo would) -> checkForkLineage sees 404 -> not-found.
  const gh404 = fakeGh({});
  expect(await resolveRef(decodeId("acme:secret-atlas:main")!, gh404)).toEqual({ error: "not-found" });

  // Service token CAN see it (e.g. a public non-fork lookalike) -> not-a-fork, same as today.
  const ghVisible = fakeGh({ "/repos/acme/lookalike": { json: { fork: false } } });
  expect(await resolveRef(decodeId("acme:lookalike:main")!, ghVisible)).toEqual({ error: "not-a-fork" });
});

test("resolveRef: canonical branch always resolves with private:false", async () => {
  config.privatePreviewsEnabled = true;
  const gh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/branches/main": {
      json: { commit: { sha: "tip123" } },
    },
  });
  const r = await resolveRef(decodeId("main")!, gh);
  expect(r).toMatchObject({ sha: "tip123", private: false });
});
