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
import { rebuildFromDisk, getIndexes, setIndexes, type AtlasNode } from "../retrieval/indexes.ts";
import { snapshotFromSrcDir } from "./snapshot.ts";
import { __resetForkPointCacheForTest } from "./fork-point.ts";

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
    prBase: { repo: "sky-ecosystem/next-gen-atlas", ref: "develop", sha: "tipsha" },
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
  expect(baseMeta({ ...resolved, kind: "branch", defaultBranch: "develop" }, "d", 1, 0).defaultBranch).toBe("develop");
  // Only repo/ref persist (never `sha` — a pinned-sha rebuild re-resolves the tip).
  expect(m.prBase).toEqual({ repo: "sky-ecosystem/next-gen-atlas", ref: "develop" });
});

test("baseMeta leaves headCommitAt undefined when GitHub returned no date", () => {
  const resolved: Resolved = { repo: "o/r", sha: "abc", kind: "branch", ref: "feat/x" };
  expect(baseMeta(resolved, "abc", 1, 0).headCommitAt).toBeUndefined();
});

test("baseMeta leaves prBase undefined when the resolved ref carries none (a plain branch preview)", () => {
  const resolved: Resolved = { repo: "o/r", sha: "abc", kind: "branch", ref: "feat/x" };
  expect(baseMeta(resolved, "abc", 1, 0).prBase).toBeUndefined();
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
  config.githubToken = ""; // empty → startCandidates short-circuits to the live-main stub (no network)
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

test("public build: a fresh sha over the fork-gate's daily quota fails as quota-exceeded (canonical/PR pool, not the private one)", async () => {
  const sha = "pub00003";
  builtShas.push(sha);
  const resolved: Resolved = { repo: "someone/atlas-fork", sha, kind: "branch", ref: "wip", private: false };
  let countCalled = false;
  const ev = await __runBuildForTest(resolved, {
    isBlockedSha: async () => false,
    isKnownSha: async () => false, // not a known sha → quota applies
    forkGate: async () => ({
      tier: "known",
      count: async () => {
        countCalled = true;
        return 7; // at the cap
      },
      quota: 7,
    }),
    spawnBuild: fakeSpawn(),
    upsertPreview: async () => {},
  });
  expect(ev.phase).toBe("failed");
  expect(ev.code).toBe("quota-exceeded");
  expect(countCalled).toBe(true);
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

// ---------------------------------------------------------------------------
// Fork meta-shaping + the diff refinements layered on top of the plain
// added/changed split: forkOwner/aheadBy/behindBy in meta, plus the
// renumbered / reused-slot / identity-swap fields of diff.json. The two
// doc-level diff tests below cover added-vs-changed itself; this one covers
// the FORK path into it, which they don't — every other test in this file
// either leaves config.githubToken empty (wantCompare short-circuits false)
// or is private (never compared at all), so none of them reach a successful
// fork build with `filesR.ok` true.
//
// The merge base is pinned to the LIVE atlas commit, which makes
// loadBaseSnapshot short-circuit to the real in-memory main snapshot instead
// of fetching a base tree — so the renumber and reused-slot cases are checked
// against real doc shapes rather than a synthetic two-document fixture.
// ---------------------------------------------------------------------------

test("fork build: forkOwner/aheadBy/behindBy land in meta, and diff.json captures a renumber + a reused-slot addition", async () => {
  const sha = "f".repeat(40);
  builtShas.push(sha);

  // Real main indexes (already built per CLAUDE.md — never rebuilt here), force-
  // read fresh so this test doesn't depend on what an earlier file left cached in
  // the process-global singleton (see retrieval/indexes.test.ts's own comment on
  // the same hazard). Only ever installs REAL data, so nothing to restore after.
  rebuildFromDisk();
  const mainDocs = getIndexes().docMap;
  // Pinning the merge base to the live atlas commit is what lets
  // loadBaseSnapshot return the in-memory main snapshot directly (see its
  // `live.atlasCommit === mergeBase` short-circuit) rather than fetching and
  // parsing a base tree over the network.
  const liveCommit = getIndexes().meta.atlasCommit;
  let mainDoc: AtlasNode | undefined;
  for (const n of mainDocs.values()) {
    if (/^[A-Z](\.\d+){1,4}$/.test(n.doc_no) && (n.content ?? "").length > 20) {
      mainDoc = n;
      break;
    }
  }
  if (!mainDoc) throw new Error("no suitable doc found in the real atlas for this test's fixtures");
  const realId = mainDoc.id;
  // Same uuid, renumbered to a new slot — an ordinary edit-and-move, same title
  // (so detectIdentitySwaps must NOT flag it — that's a distinct code path).
  const newDocNo = `${mainDoc.doc_no}.9`;
  // A brand-new uuid lands in the OLD slot mainDoc vacated — the "reused slot"
  // case, where the old occupant's move and the new doc's arrival have to be
  // told apart rather than rendered as one document being edited away.
  const newId = "99999999-8888-7777-6666-555555555555";

  config.githubToken = "test-token"; // non-empty → startCandidates attempts a real compare (no priv, no empty-token short-circuit)
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    // The sky candidate's compare base is the SERVED atlas commit (liveCommit,
    // from rebuildFromDisk() below), not a literal "main" — this fork branch
    // has no prBase/defaultBranch, so it's the only compare made.
    if (u.includes("/compare/")) {
      // merge_base_commit is what gates the doc-level diff block; without it
      // runBuild logs "no merge base" and writes no diff.json at all.
      return Response.json({
        ahead_by: 5,
        behind_by: 2,
        merge_base_commit: { sha: liveCommit },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  // runBuild warns its way through the fork path (trust tier, quota); muting
  // keeps a passing run's output readable, which is what makes a real CI
  // failure findable.
  const origWarn = console.warn;
  console.warn = () => {};

  try {
    const ev = await __runBuildForTest(
      { repo: "someone/next-gen-atlas", sha, kind: "branch", ref: "feature", private: false },
      {
        isBlockedSha: async () => false,
        isKnownSha: async () => true, // known sha → free rebuild, no quota round-trip
        forkGate: async () => ({ tier: "known", count: async () => 0, quota: 10 }),
        fetchAndExtract: async () => ({ srcDir: previewPaths(sha).srcDir, docCount: 2 }),
        spawnBuild: async (args, env) => {
          const out = env.ATLAS_OUT_DIR!;
          fs.mkdirSync(out, { recursive: true });
          if (args[0].includes("build-index")) {
            const nodes = {
              [realId]: { ...mainDoc, doc_no: newDocNo, content: `${mainDoc.content ?? ""} EDITED-AND-MOVED` },
              [newId]: {
                id: newId,
                doc_no: mainDoc.doc_no,
                title: "Brand New Doc",
                type: "Core",
                depth: mainDoc.depth,
                parentId: mainDoc.parentId,
                order: 999,
                content: "totally new content that did not exist before",
                contentHash: "x",
              },
            };
            fs.writeFileSync(path.join(out, "docs.json"), JSON.stringify({ atlasCommit: env.ATLAS_COMMIT, nodes }));
          }
          fs.writeFileSync(path.join(out, "addresses.atlas.json"), JSON.stringify({ atlasCommit: env.ATLAS_COMMIT, addresses: {} }));
          return { code: 0, stderr: "" };
        },
        upsertPreview: async () => {},
      },
    );
    expect(ev.phase).toBe("ready");

    const meta = readMeta(sha);
    expect(meta?.forkOwner).toBe("someone");
    expect(meta?.aheadBy).toBe(5);
    expect(meta?.behindBy).toBe(2);

    const diffJson = JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.json"), "utf8"));
    expect(diffJson.added).toEqual([newId]);
    expect(diffJson.changed).toEqual([realId]);
    expect(diffJson.renumbered).toEqual({ [realId]: [mainDoc.doc_no, newDocNo] });
    expect(diffJson.reusedSlot[newId]).toMatchObject({ title: mainDoc.title, movedTo: newDocNo });
    // Same title on both sides of the renumber → not an identity swap.
    expect(diffJson.identitySwap).toEqual({});

    // Patches are computed locally from the two snapshots (contentDiff), not
    // taken from GitHub's per-path patch strings: the added doc renders as pure
    // additions, the changed one as this uuid's content vs the live atlas.
    const patches = JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "patches.json"), "utf8"));
    expect(Object.keys(patches).sort()).toEqual([realId, newId].sort());
  } finally {
    globalThis.fetch = origFetch;
    console.warn = origWarn;
  }
});

// ---------------------------------------------------------------------------
// The doc-level diff block: which documents a preview adds/changes, decided by
// DOCUMENT IDENTITY against the merge base rather than by changed filename.
// Filenames stopped identifying documents when the atlas consolidated ~11k
// document.md files into ~16 composed ones (upstream #294).
//
// This drives the real wiring — resolveCandidates (via a stubbed fetch),
// snapshotFromDocsJson over the built bundle, loadBaseSnapshot through the
// injected fetcher, and diff.json/patches.json on disk.
// ---------------------------------------------------------------------------

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A spawnBuild stub whose docs.json is a real atlas node map. */
function spawnWithDocs(nodes: Record<string, unknown>): BuildDeps["spawnBuild"] {
  return async (_args, env) => {
    const out = env.ATLAS_OUT_DIR;
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, "docs.json"), JSON.stringify({ nodes }));
      fs.writeFileSync(path.join(out, "addresses.atlas.json"), JSON.stringify({ atlasCommit: env.ATLAS_COMMIT, addresses: {} }));
    }
    return { code: 0, stderr: "" };
  };
}

/** Stub GitHub so the sky candidate's compare resolves with (or without) a merge base. */
function stubGitHub(mergeBase: string | null): void {
  // Every caller below resolves a plain canonical branch (no prBase, no
  // defaultBranch), so the ONLY call made is the sky candidate's own compare —
  // everything else 404s harmlessly.
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    const u = String(url);
    const body = mergeBase ? { merge_base_commit: { sha: mergeBase } } : {};
    if (!u.includes("/compare/")) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) } as Response);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  };
}

// A private preview DOES compare now (startCandidates → resolveCandidates →
// the private path's commit-list walk in fork-point.ts), so these two replace
// the old single "no GitHub compare is made" test — split on whether that walk
// finds a fork point, each with a deterministic stub (no real network call).
const LIVE_SHA = "live00000000000000000000000000000000000f";

function stubForkPointWalk(opts: { found: boolean; aheadBy?: number; behindBy?: number }): void {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/commits?sha=")) return Response.json(opts.found ? [{ sha: LIVE_SHA }] : []);
    if (u.includes("/compare/")) {
      // The canonical-side compare (behindBy) and the repo-side compare
      // (aheadBy) share this stub — tell them apart by which repo's URL it is.
      const isCanonicalSide = u.includes(`/repos/${CANONICAL_REPO}/compare/`);
      return Response.json({ ahead_by: isCanonicalSide ? (opts.behindBy ?? 0) : (opts.aheadBy ?? 0) });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

test("private build: fork point found → bases.auto is sky, diff.sky.json/diff.json identical, aheadBy/behindBy on meta", async () => {
  const sha = "privdiffA";
  builtShas.push(sha);
  __resetForkPointCacheForTest();

  let prevIndexes: unknown;
  try {
    prevIndexes = getIndexes();
  } catch {
    prevIndexes = undefined;
  }
  setIndexes({
    docMap: new Map([[U(1), { id: U(1), doc_no: "A.1", title: "One", content: "live" }]]),
    meta: { atlasCommit: LIVE_SHA },
  } as never);

  const origFetch = globalThis.fetch;
  stubForkPointWalk({ found: true, aheadBy: 4, behindBy: 1 });
  const origWarn = console.warn;
  console.warn = () => {};

  let fetchCalls = 0;
  try {
    const ev = await __runBuildForTest(privateResolved(sha), {
      isBlockedSha: async () => false,
      isKnownSha: async () => false,
      previewsTodayCountForRepo: async () => 0,
      installationToken: async () => "tok",
      fetchAndExtract: async () => {
        fetchCalls += 1;
        return { srcDir: previewPaths(sha).srcDir, docCount: 2 };
      },
      spawnBuild: spawnWithDocs({
        [U(1)]: { id: U(1), doc_no: "A.1", title: "One", content: "edited", contentHash: "h1" },
        [U(3)]: { id: U(3), doc_no: "A.3", title: "Three", content: "brand new", contentHash: "h3" },
      }),
      upsertPreview: async () => {},
    });
    expect(ev.phase).toBe("ready");

    // The found fork point IS the live commit, so loadBaseSnapshot's
    // live-shortcut fires — only the head tree is ever fetched via the
    // injected fetchAndExtract (the fork-point walk itself uses raw fetch).
    expect(fetchCalls).toBe(1);

    const meta = readMeta(sha);
    expect(meta?.bases?.auto).toBe("sky");
    expect(meta?.aheadBy).toBe(4);
    expect(meta?.behindBy).toBe(1);

    const diff = JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.json"), "utf8"));
    expect(diff.changed).toEqual([U(1)]);
    expect(diff.added).toEqual([U(3)]);
    const diffSky = fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.sky.json"), "utf8");
    expect(fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.json"), "utf8")).toBe(diffSky);

    const patches = JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "patches.json"), "utf8"));
    expect(patches[U(1)]).toBeDefined();
    expect(patches[U(1)].some((l: [string, ...unknown[]]) => l[0] === "-" || l[0] === "+" || l[0] === "~")).toBe(true);
  } finally {
    globalThis.fetch = origFetch;
    console.warn = origWarn;
    setIndexes(prevIndexes as never);
  }
});

test("private build: no fork point found → bases.auto is live-main, warns 'no fork point found'", async () => {
  const sha = "privdiffB";
  builtShas.push(sha);
  __resetForkPointCacheForTest();

  let prevIndexes: unknown;
  try {
    prevIndexes = getIndexes();
  } catch {
    prevIndexes = undefined;
  }
  setIndexes({
    docMap: new Map([[U(1), { id: U(1), doc_no: "A.1", title: "One", content: "live" }]]),
    meta: { atlasCommit: "live-sha-b" },
  } as never);

  const origFetch = globalThis.fetch;
  stubForkPointWalk({ found: false });
  const origWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(String(msg));

  try {
    const ev = await __runBuildForTest(privateResolved(sha), {
      isBlockedSha: async () => false,
      isKnownSha: async () => false,
      previewsTodayCountForRepo: async () => 0,
      installationToken: async () => "tok",
      fetchAndExtract: async () => ({ srcDir: previewPaths(sha).srcDir, docCount: 1 }),
      spawnBuild: spawnWithDocs({
        [U(3)]: { id: U(3), doc_no: "A.3", title: "Three", content: "brand new", contentHash: "h3" },
      }),
      upsertPreview: async () => {},
    });
    expect(ev.phase).toBe("ready");

    const meta = readMeta(sha);
    expect(meta?.bases?.auto).toBe("live-main");
    expect(warnings.some((w) => w.includes("no fork point found"))).toBe(true);
    expect(fs.existsSync(path.join(previewPaths(sha).outDir, "diff.json"))).toBe(true);
    expect(fs.existsSync(path.join(previewPaths(sha).outDir, "diff.sky.json"))).toBe(false);
  } finally {
    globalThis.fetch = origFetch;
    console.warn = origWarn;
    setIndexes(prevIndexes as never);
  }
});

test("doc-level diff: added/changed split by uuid against the merge base, not by filename", async () => {
  const sha = "diff0001";
  builtShas.push(sha);
  config.githubToken = "tok"; // enables the compare round-trip
  stubGitHub("base-sha");

  // The merge-base tree the injected fetcher hands back.
  const baseSrc = mkTmp();
  fs.mkdirSync(path.join(baseSrc, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(baseSrc, "content", "A.0 - Base.md"),
    [
      `# A.1 - One [Core]  <!-- UUID: ${U(1)} -->`, "", "original", "",
      `# A.2 - Two [Core]  <!-- UUID: ${U(2)} -->`, "", "same", "",
    ].join("\n"),
  );
  const prevMin = process.env.ATLAS_MIN_NODES;
  process.env.ATLAS_MIN_NODES = "0"; // 2-document fixture, not the real ~11k

  // The preview's own atlas: A.1 edited, A.3 brand new, A.2 untouched. A.2 keeps
  // the hash the parser produces for the base tree — what a real build emits for
  // a document nobody touched, and the only way "unchanged" is testable at all.
  const baseParsed = snapshotFromSrcDir(baseSrc);
  const spawn = spawnWithDocs({
    [U(1)]: { id: U(1), doc_no: "A.1", title: "One", content: "edited", contentHash: "h1-new" },
    [U(2)]: { id: U(2), doc_no: "A.2", title: "Two", content: "same", contentHash: baseParsed.get(U(2))!.contentHash },
    [U(3)]: { id: U(3), doc_no: "A.3", title: "Three", content: "brand new", contentHash: "h3" },
  });

  // The diff block reads getIndexes() for the LIVE atlas (the side the rendered
  // redline is against). Unset, it throws and the outer catch silently skips the
  // whole block — so seed a minimal one. atlasCommit deliberately differs from
  // the merge base, which is what forces the base tree to be fetched.
  //
  // `bun test` shares module state across every file in the run, so this MUST be
  // restored: leaving a 1-document atlas installed globally breaks any later
  // file that reads getIndexes() (it broke 31 chat/verify tests). Captured here
  // rather than at module scope so it doesn't depend on file execution order.
  let prevIndexes: unknown;
  try {
    prevIndexes = getIndexes();
  } catch {
    prevIndexes = undefined; // nothing loaded yet — restore that same condition
  }
  setIndexes({
    docMap: new Map([[U(1), { id: U(1), doc_no: "A.1", title: "One", content: "live" }]]),
    meta: { atlasCommit: "live-sha" },
  } as never);

  let baseFetches = 0;
  try {
    const resolved: Resolved = { repo: CANONICAL_REPO, sha, kind: "branch", ref: "spark", private: false };
    const ev = await __runBuildForTest(resolved, {
      isBlockedSha: async () => false,
      isKnownSha: async () => true,
      forkGate: async () => ({ tier: undefined, count: async () => 0, quota: 10 }),
      fetchAndExtract: async (_repo, s) => {
        if (s !== sha) baseFetches += 1; // the merge-base tree, not the head
        return { srcDir: baseSrc, docCount: 2 };
      },
      spawnBuild: spawn,
      upsertPreview: async () => {},
    });
    expect(ev.phase).toBe("ready");

    // The base snapshot came through the INJECTED fetcher — the same one, token
    // and tarball route the head build used. Importing fetchAndExtract directly
    // here would have made a real network call and 404'd on a private repo.
    expect(baseFetches).toBe(1);

    const diff = JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.json"), "utf8"));
    expect(diff.changed).toEqual([U(1)]); // content differs vs the merge base
    expect(diff.added).toEqual([U(3)]); // uuid absent from the merge base
    expect(diff.changed).not.toContain(U(2)); // untouched doc stays out of the redline

    // An added doc has no prior content anywhere, so its patch is pure additions
    // (DiffLine is a tuple: ["+" | "-" | "=" | "~" | "…", …]).
    const patches = JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "patches.json"), "utf8"));
    expect(patches[U(3)].every((l: [string, ...unknown[]]) => l[0] === "+")).toBe(true);
    expect(patches[U(3)].map((l: [string, string]) => l[1])).toContain("brand new");
  } finally {
    setIndexes(prevIndexes as never);
    if (prevMin === undefined) delete process.env.ATLAS_MIN_NODES;
    else process.env.ATLAS_MIN_NODES = prevMin;
  }
});

test("doc-level diff: no merge base from GitHub → diffs against live main, both artifacts still written", async () => {
  // No trustworthy merge base — the build no longer skips the diff, it widens
  // to diffing against live main (same as the private-preview path).
  const sha = "diff0002";
  builtShas.push(sha);
  config.githubToken = "tok";
  stubGitHub(null);

  let prevIndexes: unknown;
  try {
    prevIndexes = getIndexes();
  } catch {
    prevIndexes = undefined;
  }
  setIndexes({ docMap: new Map(), meta: { atlasCommit: "live-sha" } } as never);

  const origWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(String(msg));

  try {
    const resolved: Resolved = { repo: CANONICAL_REPO, sha, kind: "branch", ref: "spark", private: false };
    const ev = await __runBuildForTest(resolved, {
      isBlockedSha: async () => false,
      isKnownSha: async () => true,
      forkGate: async () => ({ tier: undefined, count: async () => 0, quota: 10 }),
      fetchAndExtract: async () => ({ srcDir: previewPaths(sha).srcDir, docCount: 1 }),
      spawnBuild: fakeSpawn(),
      upsertPreview: async () => {},
    });
    expect(ev.phase).toBe("ready");
    expect(fs.existsSync(path.join(previewPaths(sha).outDir, "diff.json"))).toBe(true);
    expect(fs.existsSync(path.join(previewPaths(sha).outDir, "patches.json"))).toBe(true);
    expect(warnings.some((w) => w.includes("no merge base — diffing against live main"))).toBe(true);
  } finally {
    console.warn = origWarn;
    setIndexes(prevIndexes as never);
  }
});

test("doc-level diff: base tree fetch throws → falls back to live main, still ready", async () => {
  const sha = "diff0003";
  builtShas.push(sha);
  config.githubToken = "tok";
  stubGitHub("base-sha-that-will-fail");

  let prevIndexes: unknown;
  try {
    prevIndexes = getIndexes();
  } catch {
    prevIndexes = undefined;
  }
  // atlasCommit deliberately differs from the merge base so loadBaseSnapshot
  // can't short-circuit to the live snapshot — it must call the (throwing)
  // fetcher instead.
  setIndexes({
    docMap: new Map([[U(1), { id: U(1), doc_no: "A.1", title: "One", content: "live" }]]),
    meta: { atlasCommit: "live-sha" },
  } as never);

  const origWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(String(msg));

  try {
    const resolved: Resolved = { repo: CANONICAL_REPO, sha, kind: "branch", ref: "spark", private: false };
    const ev = await __runBuildForTest(resolved, {
      isBlockedSha: async () => false,
      isKnownSha: async () => true,
      forkGate: async () => ({ tier: undefined, count: async () => 0, quota: 10 }),
      fetchAndExtract: async (_repo, s) => {
        if (s !== sha) throw new Error("base tree fetch exploded");
        return { srcDir: previewPaths(sha).srcDir, docCount: 1 };
      },
      spawnBuild: spawnWithDocs({
        [U(1)]: { id: U(1), doc_no: "A.1", title: "One", content: "edited", contentHash: "h1" },
      }),
      upsertPreview: async () => {},
    });
    expect(ev.phase).toBe("ready");
    expect(fs.existsSync(path.join(previewPaths(sha).outDir, "patches.json"))).toBe(true);
    expect(warnings.some((w) => w.includes("base") && w.includes("unavailable") && w.includes("diffing against live main"))).toBe(
      true,
    );
  } finally {
    console.warn = origWarn;
    setIndexes(prevIndexes as never);
  }
});

test("doc-level diff: indexes not loaded → artifacts skipped, build still ready (never fails the preview)", async () => {
  const sha = "diff0004";
  builtShas.push(sha);
  config.githubToken = "tok";
  stubGitHub("base-sha");

  let prevIndexes: unknown;
  try {
    prevIndexes = getIndexes();
  } catch {
    prevIndexes = undefined;
  }
  setIndexes(undefined as never); // makes getIndexes() throw

  const origWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(String(msg));

  try {
    const resolved: Resolved = { repo: CANONICAL_REPO, sha, kind: "branch", ref: "spark", private: false };
    const ev = await __runBuildForTest(resolved, {
      isBlockedSha: async () => false,
      isKnownSha: async () => true,
      forkGate: async () => ({ tier: undefined, count: async () => 0, quota: 10 }),
      fetchAndExtract: async () => ({ srcDir: previewPaths(sha).srcDir, docCount: 1 }),
      spawnBuild: fakeSpawn(),
      upsertPreview: async () => {},
    });
    expect(ev.phase).toBe("ready");
    expect(fs.existsSync(path.join(previewPaths(sha).outDir, "diff.json"))).toBe(false);
    expect(warnings.some((w) => w.includes("diff artifacts skipped"))).toBe(true);
  } finally {
    console.warn = origWarn;
    setIndexes(prevIndexes as never);
  }
});

// ---------------------------------------------------------------------------
// A PR whose declared base is NOT sky main: bases.auto is "repo" (no switch
// compare needed — pickAuto forces "repo" for any PR whenever one resolved),
// the repo pair's REFERENCE is its own base (not live main, see
// diff-artifacts.ts's header) so upstream drift never leaks into the rendered
// patch, drift is measured for the repo candidate, and the merge-base tarball
// is fetched from the HEAD repo while the drift TIP tarball is fetched from
// the base's own repo (they differ here on purpose: this PR's head is a fork).
// ---------------------------------------------------------------------------

test("PR against a non-main base: bases.auto is repo, reference is the base (no upstream drift in the patch), drift present, base fetched from the head repo", async () => {
  const sha = "prnonmain";
  builtShas.push(sha);
  config.githubToken = "tok";

  const HEAD_REPO = "someone/next-gen-atlas"; // this PR's head is a fork
  const REPO_MERGE_BASE = "repo-merge-base-sha";
  const DEVELOP_TIP = "develop-tip-sha";
  const LIVE_ATLAS_COMMIT = "live-sha-pr";

  // The PR's actual base (`develop`, not sky main): U(1) exists but this PR
  // never touches it; U(2) is what the PR actually edits.
  const repoBaseSrc = mkTmp();
  fs.mkdirSync(path.join(repoBaseSrc, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(repoBaseSrc, "content", "A.0 - Base.md"),
    [
      `# A.1 - One [Core]  <!-- UUID: ${U(1)} -->`, "", "shared, untouched by this PR", "",
      `# A.2 - Two [Core]  <!-- UUID: ${U(2)} -->`, "", "before PR edit", "",
    ].join("\n"),
  );
  const prevMin = process.env.ATLAS_MIN_NODES;
  process.env.ATLAS_MIN_NODES = "0"; // 2-document fixture, not the real ~11k
  const baseParsed = snapshotFromSrcDir(repoBaseSrc);

  // Live main: BOTH docs have since diverged independently of this PR — the
  // exact upstream drift a wrong reference snapshot would leak into the patch.
  let prevIndexes: unknown;
  try {
    prevIndexes = getIndexes();
  } catch {
    prevIndexes = undefined;
  }
  setIndexes({
    docMap: new Map([
      [U(1), { id: U(1), doc_no: "A.1", title: "One", content: "shared, untouched by this PR — UPSTREAM EDIT" }],
      [U(2), { id: U(2), doc_no: "A.2", title: "Two", content: "LIVE HAS A DIFFERENT UNRELATED EDIT OF TWO" }],
    ]),
    meta: { atlasCommit: LIVE_ATLAS_COMMIT },
  } as never);

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    // The sky candidate's own compare (against the served atlas commit) —
    // no merge base, so sky never resolves; only `repo` is in play.
    if (u.includes(`/compare/${LIVE_ATLAS_COMMIT}...`)) return Response.json({});
    // The repo candidate's compare against its declared base (`develop`).
    if (u.includes("/compare/develop...")) return Response.json({ merge_base_commit: { sha: REPO_MERGE_BASE }, ahead_by: 3, behind_by: 0 });
    // Base-drift's tip compare: the base branch's CURRENT tip vs served atlas.
    if (u.includes(`/compare/${DEVELOP_TIP}...`)) return Response.json({ merge_base_commit: { sha: "old-fork-point" }, ahead_by: 3, behind_by: 0 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  // Track write ORDER (meta.json must land after diff.json — bundleReady()
  // only checks meta.json) and which repo each base tarball fetch used.
  const writeOrder: string[] = [];
  const fsMut = fs as unknown as { writeFileSync: typeof fs.writeFileSync; copyFileSync: typeof fs.copyFileSync };
  const origWriteFileSync = fsMut.writeFileSync;
  const origCopyFileSync = fsMut.copyFileSync;
  fsMut.writeFileSync = ((p: fs.PathOrFileDescriptor, data: unknown, opts?: unknown) => {
    if (String(p).endsWith("meta.json")) writeOrder.push("meta");
    return (origWriteFileSync as (p: fs.PathOrFileDescriptor, data: unknown, opts?: unknown) => void)(p, data, opts);
  }) as typeof fs.writeFileSync;
  fsMut.copyFileSync = ((src: fs.PathLike, dest: fs.PathLike, mode?: number) => {
    if (String(dest).endsWith("diff.json")) writeOrder.push("diff");
    return (origCopyFileSync as (src: fs.PathLike, dest: fs.PathLike, mode?: number) => void)(src, dest, mode);
  }) as typeof fs.copyFileSync;

  let repoBaseFetches = 0;
  let repoBaseFetchRepo = "";
  let driftTipFetchRepo = "";
  const origWarn = console.warn;
  console.warn = () => {};

  try {
    const resolved: Resolved = {
      repo: HEAD_REPO,
      sha,
      kind: "pr",
      ref: "pull-900",
      pr: { number: 900, title: "t", author: "a", state: "open" },
      prBase: { repo: CANONICAL_REPO, ref: "develop", sha: DEVELOP_TIP },
      private: false,
    };
    const ev = await __runBuildForTest(resolved, {
      isBlockedSha: async () => false,
      isKnownSha: async () => true,
      forkGate: async () => ({ tier: undefined, count: async () => 0, quota: 10 }),
      fetchAndExtract: async (repo, s) => {
        if (s === REPO_MERGE_BASE) {
          repoBaseFetches += 1;
          repoBaseFetchRepo = repo;
          return { srcDir: repoBaseSrc, docCount: 2 };
        }
        if (s === DEVELOP_TIP) {
          driftTipFetchRepo = repo;
          throw new Error("no fixture for the base-drift tip tree"); // drift's docsDiffer degrades to undefined; drift itself still resolves
        }
        return { srcDir: previewPaths(sha).srcDir, docCount: 2 };
      },
      spawnBuild: spawnWithDocs({
        [U(1)]: { id: U(1), doc_no: "A.1", title: "One", content: "shared, untouched by this PR", contentHash: baseParsed.get(U(1))!.contentHash },
        [U(2)]: { id: U(2), doc_no: "A.2", title: "Two", content: "after PR edit", contentHash: "h2-edited-by-pr" },
      }),
      upsertPreview: async () => {},
    });
    expect(ev.phase).toBe("ready");

    const meta = readMeta(sha);
    expect(meta?.bases?.auto).toBe("repo");
    expect(meta?.bases?.sky).toBeUndefined(); // sky never resolved (no merge base)
    expect(meta?.bases?.repo?.drift).toBeDefined();

    // Merge-base tarball comes from the HEAD repo (an ancestor of the head
    // commit, reachable there); the drift tip comes from the BASE's own repo
    // (its current tip can be ahead of anything the head repo's history has).
    expect(repoBaseFetchRepo).toBe(HEAD_REPO);
    expect(driftTipFetchRepo).toBe(CANONICAL_REPO);
    expect(repoBaseFetches).toBe(1);

    const diffRepo = JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.repo.json"), "utf8"));
    expect(diffRepo.changed).toEqual([U(2)]); // U(1) untouched between base and head — no marker at all
    expect(diffRepo.added).toEqual([]);

    const patchesRepo = JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "patches.repo.json"), "utf8"));
    expect(patchesRepo[U(1)]).toBeUndefined(); // the upstream-only doc gets no patch
    expect(patchesRepo[U(2)]).toBeDefined();
    const rendered = JSON.stringify(patchesRepo[U(2)]);
    expect(rendered).toContain("before"); // reference = base ("before PR edit"), not live
    expect(rendered).not.toContain("UNRELATED EDIT"); // live's drift never leaks in

    // diff.json is the `auto` ("repo") pair, copied byte-for-byte.
    expect(fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.json"), "utf8")).toBe(
      fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.repo.json"), "utf8"),
    );

    expect(writeOrder.indexOf("diff")).toBeGreaterThanOrEqual(0);
    expect(writeOrder.indexOf("meta")).toBeGreaterThan(writeOrder.indexOf("diff"));
  } finally {
    globalThis.fetch = origFetch;
    fsMut.writeFileSync = origWriteFileSync;
    fsMut.copyFileSync = origCopyFileSync;
    console.warn = origWarn;
    setIndexes(prevIndexes as never);
    if (prevMin === undefined) delete process.env.ATLAS_MIN_NODES;
    else process.env.ATLAS_MIN_NODES = prevMin;
  }
});

// The most common production PR shape: a canonical `pull-N` declared against
// sky main itself. pr-diff-auto.ts's pickAuto collapses this to a single
// `sky` candidate (no separate `repo` pair, no switch, no drift) so it behaves
// exactly like today — this is the end-to-end proof of that collapse.
test("canonical PR against sky main collapses to a single sky candidate: bases.auto is sky, no repo candidate/diff, diff.json equals diff.sky.json", async () => {
  const sha = "canonicalpr";
  builtShas.push(sha);
  config.githubToken = "tok";
  const LIVE = "live-canonical-pr";

  let prevIndexes: unknown;
  try {
    prevIndexes = getIndexes();
  } catch {
    prevIndexes = undefined;
  }
  setIndexes({
    docMap: new Map([[U(1), { id: U(1), doc_no: "A.1", title: "One", content: "live" }]]),
    meta: { atlasCommit: LIVE },
  } as never);

  const origFetch = globalThis.fetch;
  // Both the sky candidate's own compare (vs the served atlas commit) and the
  // repo candidate's compare (vs the PR's declared base, "main") resolve to
  // the SAME merge base — pinned to LIVE so loadBaseSnapshot's live-shortcut
  // fires and no tarball fetch is needed.
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes(`/compare/${LIVE}...`) || u.includes("/compare/main...")) {
      return Response.json({ merge_base_commit: { sha: LIVE }, ahead_by: 2, behind_by: 1 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  const origWarn = console.warn;
  console.warn = () => {};

  try {
    const resolved: Resolved = {
      repo: CANONICAL_REPO,
      sha,
      kind: "pr",
      ref: "pull-500",
      pr: { number: 500, title: "t", author: "a", state: "open" },
      prBase: { repo: CANONICAL_REPO, ref: "main" },
      private: false,
    };
    const ev = await __runBuildForTest(resolved, {
      isBlockedSha: async () => false,
      isKnownSha: async () => true,
      forkGate: async () => ({ tier: undefined, count: async () => 0, quota: 10 }),
      fetchAndExtract: async () => ({ srcDir: previewPaths(sha).srcDir, docCount: 1 }),
      spawnBuild: spawnWithDocs({
        [U(1)]: { id: U(1), doc_no: "A.1", title: "One", content: "edited by PR", contentHash: "h1" },
      }),
      upsertPreview: async () => {},
    });
    expect(ev.phase).toBe("ready");

    const meta = readMeta(sha);
    expect(meta?.bases?.auto).toBe("sky");
    expect(meta?.bases?.repo).toBeUndefined();
    expect(meta?.aheadBy).toBe(2);
    expect(meta?.behindBy).toBe(1);

    expect(fs.existsSync(path.join(previewPaths(sha).outDir, "diff.repo.json"))).toBe(false);
    const diffSky = fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.sky.json"), "utf8");
    expect(fs.readFileSync(path.join(previewPaths(sha).outDir, "diff.json"), "utf8")).toBe(diffSky);
  } finally {
    globalThis.fetch = origFetch;
    console.warn = origWarn;
    setIndexes(prevIndexes as never);
  }
});
