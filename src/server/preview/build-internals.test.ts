// Coverage for build.ts's internal seams that __runBuildForTest's DI can't reach
// on its own: DI lets a test SWAP OUT forkGate/spawnBuild, but the real
// implementations behind those swaps — and the inflight map's concurrency gate
// + SSE hub, which __runBuildForTest deliberately bypasses — need their own
// direct exercise. Run via `bun test`.

import { test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildErrorTail,
  spawnBuild,
  isForkPreview,
  forkGate,
  subscribeBuild,
  __getOrStartBuildForTest,
  type BuildDeps,
  type PreviewEvent,
} from "./build.ts";
import { previewPaths } from "./cache.ts";
import { config } from "../config.ts";
import { CANONICAL_REPO, type Resolved } from "./resolve.ts";

// ---------------------------------------------------------------------------
// buildErrorTail — pure stderr-trimming rules
// ---------------------------------------------------------------------------

test("buildErrorTail strips stack-trace noise and keeps the meaningful lines", () => {
  const stderr = [
    "error: parseTree invariant violated at A.2.2.8",
    "    at parseNode (parser.mjs:42:9)", // stack frame — stripped
    "42 | some source line", // numbered source excerpt — stripped
    "   ^", // caret marker under the excerpt — stripped
    "Bun v1.3.11 (abc123)", // version banner — stripped
    "", // blank — stripped
    "Cause: bad heading",
  ].join("\n");
  expect(buildErrorTail(stderr)).toBe("error: parseTree invariant violated at A.2.2.8\nCause: bad heading");
});

test("buildErrorTail returns undefined when stderr is pure noise or empty", () => {
  expect(buildErrorTail("    at x (y:1:1)\nBun v1.3.11\n")).toBeUndefined();
  expect(buildErrorTail("")).toBeUndefined();
});

test("buildErrorTail keeps only the LAST 6 meaningful lines, capped at 600 chars", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  expect(buildErrorTail(lines.join("\n"))!.split("\n")).toEqual(lines.slice(-6));

  const long = "x".repeat(1000);
  const tail = buildErrorTail(long)!;
  expect(tail.length).toBe(600);
  expect(tail).toBe("x".repeat(600)); // the LAST 600 chars, not the first
});

// ---------------------------------------------------------------------------
// spawnBuild — the real subprocess wrapper (DI only lets tests swap this out;
// this exercises the implementation DI is swapping). A trivial `bun -e` script
// stands in for the real build-index/build-graph/build-glossary scripts so this
// stays fast and has nothing to do with the atlas — only spawnBuild's own
// exit-code/stderr-capture/env-passthrough contract is under test.
// ---------------------------------------------------------------------------

// spawnBuild forwards the child's stderr to our own process.stderr as it comes
// in (so a live server still logs a failing build) — silence that forwarding
// here so a deliberately-failing child doesn't spam this suite's output.
async function withoutStderrForwarding<T>(fn: () => Promise<T>): Promise<T> {
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    return await fn();
  } finally {
    process.stderr.write = orig;
  }
}

test("spawnBuild resolves with the child's real exit code and captured stderr", async () => {
  await withoutStderrForwarding(async () => {
    const ok = await spawnBuild(["-e", "process.exit(0)"], {});
    expect(ok).toEqual({ code: 0, stderr: "" });

    const failed = await spawnBuild(["-e", "console.error('boom: bad doc'); process.exit(1)"], {});
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("boom: bad doc");
  });
});

test("spawnBuild passes env overrides through to the child (the ATLAS_* wiring runBuild depends on)", async () => {
  await withoutStderrForwarding(async () => {
    const r = await spawnBuild(["-e", "console.error(process.env.ATLAS_COMMIT ?? 'MISSING')"], { ATLAS_COMMIT: "deadbeef" });
    expect(r.code).toBe(0);
    expect(r.stderr.trim()).toBe("deadbeef");
  });
});

// ---------------------------------------------------------------------------
// isForkPreview — pure predicate
// ---------------------------------------------------------------------------

test("isForkPreview: true only for a bare branch/sha preview of a non-canonical repo — never a PR", () => {
  expect(isForkPreview({ repo: "someone/fork", sha: "x", kind: "branch", ref: "y" })).toBe(true);
  expect(isForkPreview({ repo: CANONICAL_REPO, sha: "x", kind: "branch", ref: "y" })).toBe(false);
  // PRs are publicly proposed against canonical, so they're never fork-treated —
  // even though a PR's head repo usually IS a fork.
  expect(
    isForkPreview({
      repo: "someone/fork",
      sha: "x",
      kind: "pr",
      ref: "pull-1",
      pr: { number: 1, title: "t", author: "a", state: "open" },
    }),
  ).toBe(false);
});

// ---------------------------------------------------------------------------
// forkGate — the real trust/quota gate. It's already a BuildDeps field, so
// runBuild's tests can swap it out, but that never exercises ITS OWN branches —
// only a direct call does. It builds its own GitHub client from config, so
// computeTrust's calls are driven by stubbing globalThis.fetch (same technique
// handler.test.ts's G7 case uses), restored after every test. Unique
// owner/author logins per case dodge trust.ts's 24h in-memory cache.
// ---------------------------------------------------------------------------

const origFetch = globalThis.fetch;
function stubTrustFetch(opts: { orgMerged?: number; atlasMerged?: number; createdAt?: string }): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/search/issues")) {
      const q = decodeURIComponent(u.split("q=")[1]?.split("&")[0] ?? "");
      const isAtlas = q.includes(`repo:${CANONICAL_REPO}`);
      return Response.json({ total_count: isAtlas ? (opts.atlasMerged ?? 0) : (opts.orgMerged ?? 0) });
    }
    if (u.includes("/users/")) return Response.json({ created_at: opts.createdAt ?? new Date(0).toISOString() });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = origFetch;
}

test("forkGate: a canonical branch (no PR, no fork) skips trust scoring entirely — no network — and draws the canonical pool", async () => {
  let called = false;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    called = true;
    return origFetch(...args);
  }) as typeof fetch;
  try {
    const gate = await forkGate({ repo: CANONICAL_REPO, sha: "x", kind: "branch", ref: "main", private: false });
    expect(gate).not.toBe("fork-not-trusted");
    if (gate === "fork-not-trusted") throw new Error("unreachable");
    expect(gate.tier).toBeUndefined();
    expect(gate.quota).toBe(config.previewDailyQuota);
    expect(called).toBe(false); // an author-less canonical branch has nothing to score
  } finally {
    restoreFetch();
  }
});

test("forkGate: PR trust tiers — trusted (atlas-merged), known (org-merged only), refused-effective-unknown (PR-ness un-refuses)", async () => {
  try {
    globalThis.fetch = stubTrustFetch({ atlasMerged: 2 });
    const trusted = await forkGate({
      repo: "someone/fork",
      sha: "x",
      kind: "pr",
      ref: "pull-1",
      pr: { number: 1, title: "t", author: "pr-trusted-author", state: "open" },
      private: false,
    });
    expect(trusted).toMatchObject({ tier: "trusted", quota: config.previewDailyQuota });

    globalThis.fetch = stubTrustFetch({ orgMerged: 3 });
    const known = await forkGate({
      repo: "someone/fork",
      sha: "x",
      kind: "pr",
      ref: "pull-2",
      pr: { number: 2, title: "t", author: "pr-known-author", state: "open" },
      private: false,
    });
    expect(known).toMatchObject({ tier: "known", quota: config.previewForkDailyQuota });

    // A fresh account with no merged history would tier "refused" for a bare fork
    // branch, but PR-ness only un-refuses (never upgrades) — a legitimate
    // newcomer can still preview via a draft PR, just with unknown-tier warnings.
    globalThis.fetch = stubTrustFetch({ createdAt: new Date().toISOString() });
    const refused = await forkGate({
      repo: "someone/fork",
      sha: "x",
      kind: "pr",
      ref: "pull-3",
      pr: { number: 3, title: "t", author: "pr-refused-author", state: "open" },
      private: false,
    });
    expect(refused).toMatchObject({ tier: "unknown", quota: config.previewUnknownForkDailyQuota });
  } finally {
    restoreFetch();
  }
});

test("forkGate: bare fork branch tiers — refused owner is rejected outright; trusted/known/unknown each get their own pool", async () => {
  try {
    globalThis.fetch = stubTrustFetch({ createdAt: new Date().toISOString() }); // no history, fresh account
    const refused = await forkGate({ repo: "branch-refused-owner/next-gen-atlas", sha: "x", kind: "branch", ref: "wip", private: false });
    expect(refused).toBe("fork-not-trusted");

    // Whitelisted owners skip computeTrust's network calls entirely (org-owned
    // forks score 0 by search, since the org itself never authors PRs).
    globalThis.fetch = (async () => {
      throw new Error("whitelisted owners must not hit the network");
    }) as unknown as typeof fetch;
    const whitelisted = await forkGate({ repo: "Endgame-Edge/next-gen-atlas", sha: "x", kind: "branch", ref: "wip", private: false });
    expect(whitelisted).toMatchObject({ tier: "trusted", quota: config.previewTrustedForkDailyQuota });

    globalThis.fetch = stubTrustFetch({ orgMerged: 1 });
    const known = await forkGate({ repo: "branch-known-owner/next-gen-atlas", sha: "x", kind: "branch", ref: "wip", private: false });
    expect(known).toMatchObject({ tier: "known", quota: config.previewForkDailyQuota });

    globalThis.fetch = stubTrustFetch({ createdAt: new Date(0).toISOString() }); // old account, no merged history
    const unknown = await forkGate({ repo: "branch-unknown-owner/next-gen-atlas", sha: "x", kind: "branch", ref: "wip", private: false });
    expect(unknown).toMatchObject({ tier: "unknown", quota: config.previewUnknownForkDailyQuota });
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// Concurrency gate (acquire/release/waiters) + the inflight map's SSE hub
// (emit's dedup/fan-out, subscribeBuild). __runBuildForTest bypasses the real
// inflight map, so none of this is reachable from build.test.ts — exercised
// here via __getOrStartBuildForTest, the DI-aware sibling of the real
// getOrStartBuild that the server itself uses.
// ---------------------------------------------------------------------------

const builtShas: string[] = [];
function cleanupBuilt(): void {
  for (const sha of builtShas.splice(0)) fs.rmSync(previewPaths(sha).dir, { recursive: true, force: true });
}

// Lays down just enough of a bundle for the build orchestration under test —
// see build.test.ts's fakeSpawn for the same minimal shape.
function fakeSpawn(): BuildDeps["spawnBuild"] {
  return async (_args, env) => {
    const out = env.ATLAS_OUT_DIR;
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      if (!fs.existsSync(path.join(out, "docs.json"))) fs.writeFileSync(path.join(out, "docs.json"), JSON.stringify({ nodes: {} }));
      fs.writeFileSync(path.join(out, "addresses.atlas.json"), JSON.stringify({ atlasCommit: env.ATLAS_COMMIT, addresses: {} }));
    }
    return { code: 0, stderr: "" };
  };
}

function branchResolved(sha: string, ref: string): Resolved {
  return { repo: CANONICAL_REPO, sha, kind: "branch", ref, private: false };
}

test("concurrency gate: a build queued past the cap doesn't start fetching until a slot frees, and a THROWING build still releases its slot", async () => {
  const origCap = config.previewMaxConcurrentBuilds;
  config.previewMaxConcurrentBuilds = 1;
  const shaA = "conc000a";
  const shaB = "conc000b";
  builtShas.push(shaA, shaB);
  const calls: string[] = [];
  let releaseA: () => void = () => {};
  const gateA = new Promise<void>((r) => {
    releaseA = r;
  });

  try {
    const fA = __getOrStartBuildForTest(branchResolved(shaA, "a"), {
      isBlockedSha: async () => false,
      isKnownSha: async () => true,
      forkGate: async () => ({ count: async () => 0, quota: 10 }),
      // Throws once released — proves release() runs from a `finally` even on
      // failure, so a crashing build can never wedge the waiters queue forever.
      fetchAndExtract: async () => {
        calls.push("A-fetch");
        await gateA;
        throw new Error("boom");
      },
      spawnBuild: fakeSpawn(),
      upsertPreview: async () => {},
    });
    const fB = __getOrStartBuildForTest(branchResolved(shaB, "b"), {
      isBlockedSha: async () => false,
      isKnownSha: async () => true,
      forkGate: async () => ({ count: async () => 0, quota: 10 }),
      fetchAndExtract: async () => {
        calls.push("B-fetch");
        return { srcDir: previewPaths(shaB).srcDir, docCount: 1 };
      },
      spawnBuild: fakeSpawn(),
      upsertPreview: async () => {},
    });

    // Pure microtask flush (no timers, no wall-clock dependence): let both
    // builds run every already-resolvable step. A's acquire() wins the only
    // slot (both reach acquire() in the same tick, A registered first), so B's
    // acquire() queues into `waiters` and B can't reach fetchAndExtract yet.
    for (let i = 0; i < 25; i++) await Promise.resolve();
    expect(calls).toEqual(["A-fetch"]);

    releaseA();
    await fA.promise;
    await fB.promise;

    expect(calls).toEqual(["A-fetch", "B-fetch"]); // B only started once A's slot freed
    expect(fA.current).toMatchObject({ phase: "failed", code: "build-failed", message: "boom" });
    expect(fB.current).toMatchObject({ phase: "ready" });
  } finally {
    config.previewMaxConcurrentBuilds = origCap;
    cleanupBuilt();
  }
});

test("emit + subscribeBuild: every live subscriber gets the full phase sequence even when another subscriber throws", async () => {
  const sha = "sub00001";
  builtShas.push(sha);
  let releaseFetch: () => void = () => {};
  const gate = new Promise<void>((r) => {
    releaseFetch = r;
  });

  const f = __getOrStartBuildForTest(branchResolved(sha, "x"), {
    isBlockedSha: async () => false,
    isKnownSha: async () => true,
    forkGate: async () => ({ count: async () => 0, quota: 10 }),
    fetchAndExtract: async () => {
      await gate;
      return { srcDir: previewPaths(sha).srcDir, docCount: 1 };
    },
    spawnBuild: fakeSpawn(),
    upsertPreview: async () => {},
  });

  try {
    // Subscribing mid-build sends the CURRENT phase immediately (the "fetching"
    // seed) and registers for future updates.
    let deadCalls = 0;
    const unsubDead = subscribeBuild(sha, () => {
      deadCalls++;
      if (deadCalls > 1) throw new Error("dead subscriber"); // let the initial sync send succeed
    });
    const received: PreviewEvent[] = [];
    const unsubLive = subscribeBuild(sha, (ev) => received.push(ev));
    expect(received).toEqual([{ phase: "fetching", sha }]);

    releaseFetch();
    await f.promise;

    // The dead subscriber's throw on "building" never stopped the live one from
    // getting every subsequent event, and the seeded "fetching" was never
    // rebroadcast as a duplicate (dedup).
    expect(received.map((e) => e.phase)).toEqual(["fetching", "building", "ready"]);
    unsubDead();
    unsubLive();
  } finally {
    cleanupBuilt();
  }
});

test("subscribeBuild against a sha with no in-flight build returns a harmless noop unsubscribe", () => {
  const unsub = subscribeBuild("not-actually-building", () => {
    throw new Error("must never be called — nothing is building");
  });
  expect(() => unsub()).not.toThrow();
});
