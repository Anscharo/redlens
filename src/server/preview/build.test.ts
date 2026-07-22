// Regression test for the countNewAddresses silent-degrade bug: a torn/corrupt
// read of main's addresses.atlas.json used to be indistinguishable from
// "genuinely zero new addresses", hiding the swapped-payment-address banner.
// It now retries once, then returns undefined (not 0) so callers can tell
// "checked, zero" apart from "couldn't check".
import { test, expect, describe, it, mock, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { countNewAddresses, inflightShas, subscribeBuild, getOrStartBuild } from "./build.ts";
import { previewPaths } from "./cache.ts";
import { CapExceededError, SourceGoneError } from "./tarball.ts";
import type { Resolved } from "./resolve.ts";

// Captured at module-evaluation time (bun's test-collection sweep imports every
// test file before any test body runs), so these are guaranteed pristine even
// if another file's test body mocks these same modules and leaves it dangling —
// a `mock.module` call inside a test body can only run once test bodies start
// executing, which is strictly after every file's top-level code has run.
const REAL_CONFIG = (await import("../config.ts")).config;
const REAL_INDEXES = { ...(await import("../indexes.ts")) };
const REAL_DB = { ...(await import("./db.ts")) };
const REAL_TARBALL = { ...(await import("./tarball.ts")) };
const REAL_TRUST = { ...(await import("./trust.ts")) };
const REAL_PR_DIFF = { ...(await import("./pr-diff.ts")) };
const REAL_CHILD_PROCESS = { ...(await import("node:child_process")) };

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pv-build-"));
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
  const result = await countNewAddresses(previewDir, mainDir);
  expect(result).toBeUndefined();
});

test("a missing preview file also returns undefined rather than 0", async () => {
  const previewDir = mkTmp(); // no addresses.atlas.json written
  const mainDir = mkTmp();
  writeAddrs(mainDir, { "0xaaa": {} });
  expect(await countNewAddresses(previewDir, mainDir)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// runBuild / getOrStartBuild orchestration — heavily mocked (no real network,
// no real subprocess, no real DB): "bun" spawns are faked to write just enough
// of an out/ dir (docs.json [+ addresses.atlas.json]) for the bundle to read
// back as ready, so the real cache.ts/bundle-store.ts machinery runs for real
// against /tmp/previews/<sha>.
// ---------------------------------------------------------------------------

function sha(tag: number): string {
  return tag.toString(16).padStart(4, "0").repeat(10).slice(0, 40);
}

async function mockSpawn(codes: number[] = [0, 0, 0], opts: { writeAddresses?: boolean } = {}) {
  const queue = [...codes];
  const writeAddresses = opts.writeAddresses ?? true;
  await mock.module("node:child_process", () => ({
    spawn: (_cmd: string, args: string[], spawnOpts: any) => {
      const child = new EventEmitter() as any;
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        const code = queue.length ? queue.shift()! : 0;
        const outDir = spawnOpts?.env?.ATLAS_OUT_DIR;
        if (code === 0 && outDir) {
          if (String(args[0]).includes("build-index")) {
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, "docs.json"), JSON.stringify({ atlasCommit: "preview-sha", nodes: {} }));
          }
          if (writeAddresses && String(args[0]).includes("build-graph")) {
            fs.writeFileSync(path.join(outDir, "addresses.atlas.json"), JSON.stringify({ atlasCommit: "preview-sha", addresses: {} }));
          }
        } else if (code !== 0) {
          child.stderr.emit("data", Buffer.from("fake build error: something invalid\n"));
        }
        child.emit("close", code);
      });
      return child;
    },
  }));
}

interface MockDepsOpts {
  githubToken?: string;
  isBlockedSha?: boolean;
  isKnownSha?: boolean;
  countInPool?: number;
  quota?: number;
  computeTrustTier?: "trusted" | "known" | "unknown" | "refused";
  fetchPreviewFiles?: () => Promise<unknown>;
  fetchAndExtractImpl?: () => Promise<{ srcDir: string; docCount: number }>;
}

async function mockDeps(opts: MockDepsOpts = {}) {
  await mock.module("../config.ts", () => ({
    config: {
      ...REAL_CONFIG,
      githubToken: opts.githubToken ?? "",
      previewMaxConcurrentBuilds: 5,
      previewDailyQuota: opts.quota ?? 100,
      previewForkDailyQuota: opts.quota ?? 100,
      previewUnknownForkDailyQuota: opts.quota ?? 100,
      previewTrustedForkDailyQuota: opts.quota ?? 100,
    },
  }));
  await mock.module("../indexes.ts", () => ({
    getIndexes: () => ({ meta: { atlasCommit: "livesha" }, docMap: new Map() }),
  }));
  await mock.module("./db.ts", () => ({
    isBlockedSha: async () => opts.isBlockedSha ?? false,
    isKnownSha: async () => opts.isKnownSha ?? false,
    previewsTodayCount: async () => opts.countInPool ?? 0,
    previewsTodayCountForOwner: async () => opts.countInPool ?? 0,
    upsertPreview: async () => {},
  }));
  await mock.module("./tarball.ts", () => ({
    ...REAL_TARBALL,
    fetchAndExtract: opts.fetchAndExtractImpl ?? (async () => ({ srcDir: "/tmp/fake-src-unused", docCount: 3 })),
  }));
  if (opts.computeTrustTier) {
    await mock.module("./trust.ts", () => ({
      ...REAL_TRUST,
      computeTrust: async () => ({ tier: opts.computeTrustTier, orgMerged: 0, atlasMerged: 0, accountAgeDays: 999 }),
    }));
  }
  if (opts.fetchPreviewFiles) {
    await mock.module("./pr-diff.ts", () => ({ ...REAL_PR_DIFF, fetchPreviewFiles: opts.fetchPreviewFiles }));
  }
}

function cleanup(s: string) {
  fs.rmSync(previewPaths(s).dir, { recursive: true, force: true });
}

function readMetaFile(s: string): any {
  return JSON.parse(fs.readFileSync(previewPaths(s).metaPath, "utf8"));
}

async function restoreRealModules() {
  await mock.restore();
  // Belt-and-suspenders on top of mock.restore(): explicitly re-pin every module
  // this suite mocks back to its real (module-load-time-captured) implementation,
  // so a leaked mock can never survive past this file's own tests regardless of
  // what mock.restore() actually reverts.
  await mock.module("../config.ts", () => ({ config: REAL_CONFIG }));
  await mock.module("../indexes.ts", () => ({ ...REAL_INDEXES }));
  await mock.module("./db.ts", () => REAL_DB);
  await mock.module("./tarball.ts", () => REAL_TARBALL);
  await mock.module("./trust.ts", () => REAL_TRUST);
  await mock.module("./pr-diff.ts", () => REAL_PR_DIFF);
  await mock.module("node:child_process", () => ({ ...REAL_CHILD_PROCESS }));
}

describe("runBuild / getOrStartBuild", () => {
  beforeEach(restoreRealModules);
  afterEach(restoreRealModules);

  it("canonical branch happy path reaches 'ready' and writes a plain (non-fork) meta", async () => {
    const s = sha(1);
    await mockDeps({});
    await mockSpawn([0, 0, 0]);
    const resolved: Resolved = { repo: "sky-ecosystem/next-gen-atlas", sha: s, kind: "branch", ref: "main" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    expect(f.current.phase).toBe("ready");
    const meta = readMetaFile(s);
    expect(meta.docCount).toBe(3);
    expect(meta.trustTier).toBeUndefined();
    expect(meta.forkOwner).toBeUndefined();
    cleanup(s);
  });

  it("fork branch: aheadBy/behindBy + a successful new-address count are recorded", async () => {
    const s = sha(2);
    await mockDeps({
      githubToken: "tok",
      computeTrustTier: "known",
      fetchPreviewFiles: async () => ({ files: [], aheadBy: 5, behindBy: 2 }),
    });
    await mockSpawn([0, 0, 0], { writeAddresses: true });
    const resolved: Resolved = { repo: "someuser/next-gen-atlas", sha: s, kind: "branch", ref: "feature" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    expect(f.current.phase).toBe("ready");
    const meta = readMetaFile(s);
    expect(meta.trustTier).toBe("known");
    expect(meta.forkOwner).toBe("someuser");
    expect(meta.aheadBy).toBe(5);
    expect(meta.behindBy).toBe(2);
    expect(meta.newAddresses).toBe(0); // preview's addresses.atlas.json is empty
    expect(meta.addressCheckFailed).toBeUndefined();
    expect(fs.existsSync(path.join(previewPaths(s).outDir, "diff.json"))).toBe(true);
    cleanup(s);
  });

  it("fork branch: truncated diff + an unreadable main address map fails the address check closed", async () => {
    const s = sha(3);
    await mockDeps({
      githubToken: "tok",
      computeTrustTier: "known",
      fetchPreviewFiles: async () => ({ files: [], aheadBy: 1, behindBy: 0, truncated: true }),
    });
    await mockSpawn([0, 0, 0], { writeAddresses: false }); // no addresses.atlas.json in outDir
    const resolved: Resolved = { repo: "someuser/next-gen-atlas", sha: s, kind: "branch", ref: "feature" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    const meta = readMetaFile(s);
    expect(meta.diffTruncated).toBe(true);
    expect(meta.addressCheckFailed).toBe(true);
    expect(meta.newAddresses).toBeUndefined();
    cleanup(s);
  });

  it("blocked sha fails with not-found and removes the preview dir", async () => {
    const s = sha(4);
    await mockDeps({ isBlockedSha: true });
    const resolved: Resolved = { repo: "sky-ecosystem/next-gen-atlas", sha: s, kind: "branch", ref: "main" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    expect(f.current).toMatchObject({ phase: "failed", sha: s, code: "not-found" });
    expect(fs.existsSync(previewPaths(s).dir)).toBe(false);
  });

  it("exceeding the daily quota fails with quota-exceeded", async () => {
    const s = sha(5);
    await mockDeps({ isKnownSha: false, countInPool: 50, quota: 10 });
    const resolved: Resolved = { repo: "sky-ecosystem/next-gen-atlas", sha: s, kind: "branch", ref: "main" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    expect(f.current).toMatchObject({ phase: "failed", sha: s, code: "quota-exceeded" });
  });

  it("an untrusted fork owner fails with fork-not-trusted (before any build starts)", async () => {
    const s = sha(6);
    await mockDeps({ computeTrustTier: "refused" });
    const resolved: Resolved = { repo: "someuser/next-gen-atlas", sha: s, kind: "branch", ref: "feature" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    expect(f.current).toMatchObject({ phase: "failed", sha: s, code: "fork-not-trusted" });
  });

  it("a failing build-index subprocess fails with build-failed and a trimmed stderr tail", async () => {
    const s = sha(7);
    await mockDeps({});
    await mockSpawn([1]);
    const resolved: Resolved = { repo: "sky-ecosystem/next-gen-atlas", sha: s, kind: "branch", ref: "main" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    expect(f.current).toMatchObject({ phase: "failed", sha: s, code: "build-failed" });
    expect((f.current as { message?: string }).message).toContain("fake build error");
    cleanup(s);
  });

  it("a CapExceededError from fetchAndExtract surfaces as cap-exceeded", async () => {
    const s = sha(8);
    await mockDeps({
      fetchAndExtractImpl: async () => {
        throw new CapExceededError("too big");
      },
    });
    const resolved: Resolved = { repo: "sky-ecosystem/next-gen-atlas", sha: s, kind: "branch", ref: "main" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    expect(f.current).toMatchObject({ phase: "failed", sha: s, code: "cap-exceeded" });
  });

  it("a SourceGoneError from fetchAndExtract surfaces as source-gone", async () => {
    const s = sha(9);
    await mockDeps({
      fetchAndExtractImpl: async () => {
        throw new SourceGoneError("archive 404");
      },
    });
    const resolved: Resolved = { repo: "sky-ecosystem/next-gen-atlas", sha: s, kind: "branch", ref: "main" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    expect(f.current).toMatchObject({ phase: "failed", sha: s, code: "source-gone" });
  });

  it("a fork whose compare-vs-main fails is rejected as not-derived (no shared history)", async () => {
    const s = sha(10);
    await mockDeps({
      githubToken: "tok",
      computeTrustTier: "known",
      fetchPreviewFiles: async () => {
        throw new Error("compare failed (404)");
      },
    });
    await mockSpawn([0, 0, 0]);
    const resolved: Resolved = { repo: "someuser/next-gen-atlas", sha: s, kind: "branch", ref: "feature" };
    const f = getOrStartBuild(resolved);
    await f.promise;
    expect(f.current).toMatchObject({ phase: "failed", sha: s, code: "not-derived" });
    cleanup(s);
  });

  it("dedups a second call for the same in-flight sha, and tracks/untracks it via inflightShas", async () => {
    const s = sha(11);
    await mockDeps({
      fetchAndExtractImpl: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { srcDir: "/tmp/fake-src-unused", docCount: 1 };
      },
    });
    await mockSpawn([0, 0, 0]);
    const resolved: Resolved = { repo: "sky-ecosystem/next-gen-atlas", sha: s, kind: "branch", ref: "main" };
    const f = getOrStartBuild(resolved);
    const f2 = getOrStartBuild(resolved); // same sha, still in flight → dedup
    expect(f2).toBe(f);
    expect(inflightShas().has(s)).toBe(true);

    const events: unknown[] = [];
    const unsub = subscribeBuild(s, (ev) => events.push(ev));
    expect(events.length).toBe(1); // current phase sent immediately on subscribe
    unsub();

    // Subscribing to a sha with no in-flight build is a harmless no-op.
    const unsub2 = subscribeBuild("no-such-sha-in-flight", () => {
      throw new Error("must not be called");
    });
    unsub2();

    await f.promise;
    expect(inflightShas().has(s)).toBe(false); // cleaned up once done
    cleanup(s);
  });
});
