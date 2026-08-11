// Regression test for the countNewAddresses silent-degrade bug: a torn/corrupt
// read of main's addresses.atlas.json used to be indistinguishable from
// "genuinely zero new addresses", hiding the swapped-payment-address banner.
// It now retries once, then returns undefined (not 0) so callers can tell
// "checked, zero" apart from "couldn't check".
import { afterAll, afterEach, test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { countNewAddresses, baseMeta, __runBuildForTest, type BuildDeps } from "./build.ts";
import { previewPaths, readMeta } from "./cache.ts";
import { config } from "../config.ts";
import { CANONICAL_REPO, type Resolved } from "./resolve.ts";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pv-build-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// The two negative-path tests below drive countNewAddresses into its
// documented "couldn't check" branch, which console.errors the underlying
// SyntaxError/ENOENT with a full stack. That's correct in production and pure
// noise in a passing test run — and multi-line stacks interleaved into the
// suite output are exactly what makes a genuine CI failure hard to find. Mute
// it for the duration of those two tests only.
async function withoutErrorLogging<T>(fn: () => Promise<T>): Promise<T> {
  const realError = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = realError;
  }
}

function writeAddrs(dir: string, addresses: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, "addresses.atlas.json"), JSON.stringify({ atlasCommit: "x", addresses }));
}

test("counts addresses present in preview but absent from main", async () => {
  const previewDir = mkTmp();
  const mainDir = mkTmp();
  writeAddrs(previewDir, { "0xaaa": {}, "0xbbb": {}, "0xccc": {} });
  writeAddrs(mainDir, { "0xaaa": {} });
  expect(await countNewAddresses(previewDir, mainDir)).toBe(2);
});

test("returns 0 (not undefined) when main's file is well-formed and there's genuinely nothing new", async () => {
  const previewDir = mkTmp();
  const mainDir = mkTmp();
  writeAddrs(previewDir, { "0xaaa": {} });
  writeAddrs(mainDir, { "0xaaa": {} });
  expect(await countNewAddresses(previewDir, mainDir)).toBe(0);
});

test("a torn/corrupt main read returns undefined, not a false 0 (the bug)", async () => {
  const previewDir = mkTmp();
  const mainDir = mkTmp();
  writeAddrs(previewDir, { "0xaaa": {} });
  // Simulate a mid-rewrite torn read: truncated JSON.
  fs.writeFileSync(path.join(mainDir, "addresses.atlas.json"), '{"atlasCommit":"x","addresse');
  const result = await withoutErrorLogging(() => countNewAddresses(previewDir, mainDir));
  expect(result).toBeUndefined();
});

test("a missing preview file also returns undefined rather than 0", async () => {
  const previewDir = mkTmp(); // no addresses.atlas.json written
  const mainDir = mkTmp();
  writeAddrs(mainDir, { "0xaaa": {} });
  expect(await withoutErrorLogging(() => countNewAddresses(previewDir, mainDir))).toBeUndefined();
});

test("baseMeta maps the resolved ref onto PreviewMeta, incl. headCommitAt from the head-commit date", () => {
  const resolved: Resolved = {
    repo: "sky-ecosystem/next-gen-atlas",
    sha: "deadbeef",
    kind: "pr",
    ref: "pull-211",
    pr: { number: 211, title: "History tab", author: "anscharo", state: "open" },
    date: "2026-07-29T08:29:55Z",
  };
  const m = baseMeta(resolved, "deadbeef", 42, 0);
  expect(m.headCommitAt).toBe("2026-07-29T08:29:55Z");
  expect(m.sha).toBe("deadbeef");
  expect(m.repo).toBe("sky-ecosystem/next-gen-atlas");
  expect(m.kind).toBe("pr");
  expect(m.prNumber).toBe(211);
  expect(m.prTitle).toBe("History tab");
  expect(m.docCount).toBe(42);
  expect(typeof m.resolvedAt).toBe("string");
});

test("baseMeta leaves headCommitAt undefined when GitHub returned no date", () => {
  const resolved: Resolved = { repo: "o/r", sha: "abc", kind: "branch", ref: "feat/x" };
  expect(baseMeta(resolved, "abc", 1, 0).headCommitAt).toBeUndefined();
});

// ---------------------------------------------------------------------------
// runBuild orchestration (via the __runBuildForTest DI seam). These drive the
// private/public build branches — trust/quota gate, installation-token
// acquisition, app-not-installed, and the private meta shaping — hermetically:
// no real subprocess, GitHub round-trip, or Postgres. Each build writes into the
// real preview store under a unique sha, cleaned up afterEach.
// ---------------------------------------------------------------------------

const builtShas: string[] = [];
const origGithubToken = config.githubToken;

afterEach(() => {
  for (const sha of builtShas.splice(0)) {
    fs.rmSync(previewPaths(sha).dir, { recursive: true, force: true });
  }
  config.githubToken = origGithubToken;
});

// A spawnBuild stub that "succeeds" and lays down the two artifacts runBuild /
// the bundle store care about: docs.json (the bundleReady core — without it
// evictLru sweeps the dir as an interrupted build) and addresses.atlas.json (the
// swapped-address local compare). The real pipeline writes far more; the build
// orchestration under test only needs these to exist.
function fakeSpawn(addresses: Record<string, unknown> = {}): BuildDeps["spawnBuild"] {
  return async (_args, env) => {
    const out = env.ATLAS_OUT_DIR;
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      if (!fs.existsSync(path.join(out, "docs.json"))) fs.writeFileSync(path.join(out, "docs.json"), JSON.stringify({ nodes: {} }));
      fs.writeFileSync(path.join(out, "addresses.atlas.json"), JSON.stringify({ atlasCommit: env.ATLAS_COMMIT, addresses }));
    }
    return { code: 0, stderr: "" };
  };
}

function privateResolved(sha: string): Resolved {
  return { repo: "acme/atlas-private", sha, kind: "branch", ref: "main", private: true, date: "2026-08-01T00:00:00Z" };
}

test("private build: installation-token path builds, writes meta.private, never touches fork/trust", async () => {
  const sha = "priv0001";
  builtShas.push(sha);
  let tokenRepo: string | undefined;
  const ev = await __runBuildForTest(privateResolved(sha), {
    isBlockedSha: async () => false,
    isKnownSha: async () => false,
    previewsTodayCountForRepo: async () => 0,
    forkGate: async () => {
      throw new Error("forkGate must not be called on the private path");
    },
    installationToken: async (repo) => {
      tokenRepo = repo;
      return "inst-tok";
    },
    fetchAndExtract: async () => ({ srcDir: previewPaths(sha).srcDir, docCount: 7 }),
    spawnBuild: fakeSpawn({ "0xabc": {} }),
    upsertPreview: async () => {},
  });
  expect(ev.phase).toBe("ready");
  expect(tokenRepo).toBe("acme/atlas-private");
  const meta = readMeta(sha);
  expect(meta?.private).toBe(true);
  expect(meta?.trustTier).toBeUndefined(); // private previews are never trust-screened
  expect(meta?.docCount).toBe(7);
});

test("private build: a null installation token fails as app-not-installed (no build)", async () => {
  const sha = "priv0002";
  builtShas.push(sha);
  let fetched = false;
  const ev = await __runBuildForTest(privateResolved(sha), {
    isBlockedSha: async () => false,
    isKnownSha: async () => false,
    previewsTodayCountForRepo: async () => 0,
    installationToken: async () => null, // App not installed on the repo
    fetchAndExtract: async () => {
      fetched = true;
      return { srcDir: previewPaths(sha).srcDir, docCount: 1 };
    },
    spawnBuild: fakeSpawn(),
    upsertPreview: async () => {},
  });
  expect(ev.phase).toBe("failed");
  expect(ev.code).toBe("app-not-installed");
  expect(fetched).toBe(false); // failed before acquiring a build slot / fetching
});

test("private build: a fresh sha over the per-repo daily quota fails as quota-exceeded", async () => {
  const sha = "priv0003";
  builtShas.push(sha);
  const ev = await __runBuildForTest(privateResolved(sha), {
    isBlockedSha: async () => false,
    isKnownSha: async () => false, // not a known sha → quota applies
    previewsTodayCountForRepo: async () => config.previewPrivateDailyQuota, // at the cap
    installationToken: async () => "inst-tok",
    spawnBuild: fakeSpawn(),
    upsertPreview: async () => {},
  });
  expect(ev.phase).toBe("failed");
  expect(ev.code).toBe("quota-exceeded");
});

test("public canonical build: forkGate path, service token, no private flag", async () => {
  const sha = "pub00001";
  builtShas.push(sha);
  config.githubToken = ""; // empty → skips the fetchPreviewFiles compare (no network)
  const resolved: Resolved = { repo: CANONICAL_REPO, sha, kind: "branch", ref: "develop", private: false };
  let installCalled = false;
  const ev = await __runBuildForTest(resolved, {
    isBlockedSha: async () => false,
    isKnownSha: async () => true, // known sha → free rebuild, gate.count() not consulted
    forkGate: async () => ({ tier: undefined, count: async () => 0, quota: 10 }),
    installationToken: async () => {
      installCalled = true;
      return "inst-tok";
    },
    fetchAndExtract: async () => ({ srcDir: previewPaths(sha).srcDir, docCount: 3 }),
    spawnBuild: fakeSpawn(),
    upsertPreview: async () => {},
  });
  expect(ev.phase).toBe("ready");
  expect(installCalled).toBe(false); // public path uses the service token, never the App
  const meta = readMeta(sha);
  expect(meta?.private).toBeUndefined();
});

test("public build: forkGate refusing an untrusted fork fails as fork-not-trusted", async () => {
  const sha = "pub00002";
  builtShas.push(sha);
  const resolved: Resolved = { repo: "someone/atlas-fork", sha, kind: "branch", ref: "wip", private: false };
  const ev = await __runBuildForTest(resolved, {
    isBlockedSha: async () => false,
    isKnownSha: async () => false,
    forkGate: async () => "fork-not-trusted",
    spawnBuild: fakeSpawn(),
    upsertPreview: async () => {},
  });
  expect(ev.phase).toBe("failed");
  expect(ev.code).toBe("fork-not-trusted");
});

test("build: a blocked sha never rebuilds (admin takedown → not-found)", async () => {
  const sha = "priv0004";
  builtShas.push(sha);
  const ev = await __runBuildForTest(privateResolved(sha), {
    isBlockedSha: async () => true,
    installationToken: async () => "inst-tok",
    spawnBuild: fakeSpawn(),
    upsertPreview: async () => {},
  });
  expect(ev.phase).toBe("failed");
  expect(ev.code).toBe("not-found");
});
