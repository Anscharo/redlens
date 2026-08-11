import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { sweepPreviewBundles, startPreviewSweeper, type SweepResult } from "./sweeper.ts";
import { bundleReady } from "./cache.ts";

const MAIN = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
const OLD = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-sweep-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function makeBundle(sha: string, opts: { base?: string; ageMs?: number; unfinished?: boolean } = {}): void {
  const dir = path.join(root, sha);
  fs.mkdirSync(path.join(dir, "out"), { recursive: true });
  if (!opts.unfinished) {
    const meta: Record<string, unknown> = { sha, repo: "r/r", ref: "x", kind: "branch" };
    if (opts.base) meta.baseAtlasCommit = opts.base;
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, "out", "docs.json"), "{}");
  }
  if (opts.ageMs) {
    const t = new Date(Date.now() - opts.ageMs);
    fs.utimesSync(dir, t, t);
  }
}

const has = (sha: string) => bundleReady(sha, root);
const base = { mainCommit: MAIN, blocked: new Set<string>(), skip: new Set<string>(), graceMs: 60_000 };

describe("sweepPreviewBundles", () => {
  test("blocked bundle is removed immediately, even inside the grace window", async () => {
    makeBundle("s1", { base: MAIN });
    const r = await sweepPreviewBundles({ ...base, root, blocked: new Set(["s1"]) });
    expect(r.blocked).toBe(1);
    expect(has("s1")).toBe(false);
  });

  test("stale baseline past the grace window is removed; current baseline stays", async () => {
    makeBundle("stale", { base: OLD, ageMs: 120_000 });
    makeBundle("current", { base: MAIN, ageMs: 120_000 });
    const r = await sweepPreviewBundles({ ...base, root });
    expect(r.stale).toBe(1);
    expect(has("stale")).toBe(false);
    expect(has("current")).toBe(true);
  });

  test("stale baseline inside the grace window survives (active session)", async () => {
    makeBundle("active", { base: OLD });
    const r = await sweepPreviewBundles({ ...base, root });
    expect(r.stale).toBe(0);
    expect(has("active")).toBe(true);
  });

  test("legacy meta without baseAtlasCommit counts as stale", async () => {
    makeBundle("legacy", { ageMs: 120_000 });
    const r = await sweepPreviewBundles({ ...base, root });
    expect(r.stale).toBe(1);
    expect(has("legacy")).toBe(false);
  });

  test("unknown main commit disables staleness sweeping only", async () => {
    makeBundle("stale", { base: OLD, ageMs: 120_000 });
    makeBundle("bad", { base: OLD, ageMs: 120_000 });
    const r = await sweepPreviewBundles({ ...base, root, mainCommit: null, blocked: new Set(["bad"]) });
    expect(r).toEqual({ blocked: 1, stale: 0, evicted: 0 });
    expect(has("stale")).toBe(true);
  });

  test("in-flight shas are untouchable; orphan dirs are collected", async () => {
    makeBundle("building", { unfinished: true });
    makeBundle("orphan", { unfinished: true });
    const r = await sweepPreviewBundles({ ...base, root, skip: new Set(["building"]) });
    expect(r.evicted).toBe(1);
    expect(fs.existsSync(path.join(root, "building"))).toBe(true);
    expect(fs.existsSync(path.join(root, "orphan"))).toBe(false);
  });

  test("missing preview dir is a no-op", async () => {
    const r = await sweepPreviewBundles({ ...base, root: path.join(root, "nope") });
    expect(r).toEqual({ blocked: 0, stale: 0, evicted: 0 });
  });

  // Every test above passes `mainCommit` explicitly (via `base`), so none of them
  // ever exercise the real default: sweepPreviewBundles() is called with no
  // `mainCommit` key at all from startPreviewSweeper's tick. That default reads
  // the live indexes, which can throw if nothing has loaded them yet.
  test("mainCommit falls back to getIndexes().meta.atlasCommit when the caller omits it (indexes already loaded)", async () => {
    const { rebuildFromDisk, getIndexes } = await import("../retrieval/indexes.ts");
    // Force a fresh real read regardless of what an earlier test file left
    // cached in the process-global singleton — only ever installs REAL on-disk
    // data (CLAUDE.md: already built, never rebuilt here), so nothing to
    // restore afterward; see retrieval/indexes.test.ts's identical hazard note.
    rebuildFromDisk();
    const live = getIndexes().meta.atlasCommit;
    expect(typeof live).toBe("string"); // sanity: real artifacts are present in this env

    makeBundle("live-baseline", { base: live!, ageMs: 120_000 });
    const r = await sweepPreviewBundles({ root, blocked: new Set(), skip: new Set(), graceMs: 60_000 }); // no mainCommit key
    expect(r.stale).toBe(0);
    expect(has("live-baseline")).toBe(true);
  });

  test("mainCommit falls back to null (staleness sweep skipped, not misread as 'sweep everything') when indexes were never loaded", () => {
    // The only way to observe getIndexes()'s "not loaded" throw deterministically:
    // within THIS process, some earlier test/file may already have loaded real
    // indexes (module state is a process-global singleton — see the test above).
    // A cold Bun subprocess that never calls loadIndexes()/setIndexes() sidesteps
    // that entirely. Mirrors retrieval/indexes.test.ts's own cold-boot pattern.
    const COLD = `
      const fs = require("node:fs");
      const path = require("node:path");
      const os = require("node:os");
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pv-cold-"));
      const dir = path.join(tmpRoot, "stale");
      fs.mkdirSync(path.join(dir, "out"), { recursive: true });
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ sha: "stale", repo: "r/r", ref: "x", kind: "branch", baseAtlasCommit: "someoldsha" }));
      fs.writeFileSync(path.join(dir, "out", "docs.json"), "{}");
      const past = new Date(Date.now() - 120000);
      fs.utimesSync(dir, past, past);
      const m = await import(${JSON.stringify(new URL("./sweeper.ts", import.meta.url).href)});
      const r = await m.sweepPreviewBundles({ root: tmpRoot, blocked: new Set(), skip: new Set(), graceMs: 60000 });
      console.log(JSON.stringify({ result: r, staleDirSurvived: fs.existsSync(dir) }));
    `;
    const r = spawnSync(process.execPath, ["-e", COLD], { encoding: "utf8" });
    // Surface the child's stderr on failure rather than asserting it's empty —
    // matches retrieval/indexes.test.ts's own cold-boot assertion style.
    if (r.status !== 0) throw new Error(`cold-boot child exited ${r.status}:\n${r.stderr}`);
    const out = JSON.parse(r.stdout.trim());
    expect(out.result).toEqual({ blocked: 0, stale: 0, evicted: 0 });
    expect(out.staleDirSurvived).toBe(true); // never evaluated for staleness — mainCommit fell back to null, not to "sweep everything"
  });

  test("a bundle dir removed by a concurrent remover between the readdir snapshot and the staleness statSync is skipped, not crashed on", async () => {
    // TOCTOU: entries came from one fs.readdirSync() snapshot at the top of
    // sweepPreviewBundles; by the time THIS iteration reaches fs.statSync, another
    // process (a second sweep tick, or a request handler's own remove()) may have
    // already deleted the dir. Simulated by making statSync throw ENOENT for this
    // one path — sweeper.ts's `import fs from "node:fs"` resolves to the same
    // module-namespace object this file imports, so the stub is visible there too.
    makeBundle("racy", { base: OLD }); // baseAtlasCommit !== MAIN → looks stale, would normally be removed
    const dir = path.join(root, "racy");
    // fs's default-export namespace is read-only in TS's types (though mutable
    // at runtime, which is what makes the stub visible from sweeper.ts's own
    // `import fs from "node:fs"`) — cast to assign/restore its statSync member.
    const fsMut = fs as unknown as { statSync: typeof fs.statSync };
    const origStatSync = fsMut.statSync;
    fsMut.statSync = ((p: fs.PathLike, opts?: unknown) => {
      if (p === dir) {
        const err = new Error("ENOENT: no such file or directory, stat 'racy'") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return (origStatSync as (p: fs.PathLike, opts?: unknown) => fs.Stats)(p, opts);
    }) as typeof fs.statSync;
    try {
      const r = await sweepPreviewBundles({ ...base, root });
      expect(r.stale).toBe(0); // raced — not counted as swept
      expect(fs.existsSync(dir)).toBe(true); // and not removed a second time by this pass
    } finally {
      fsMut.statSync = origStatSync;
    }
  });
});

describe("startPreviewSweeper", () => {
  test("registers tick on the given interval; logs only on a non-empty result; a rejecting sweep warns instead of throwing; stop() clears the interval", async () => {
    // setInterval/clearInterval are mocked (not a short real interval) so this
    // test has zero wall-clock dependence: we drive `tick` by invoking the
    // captured callback directly, as many times as we want, with an injected
    // sweepFn instead of the real disk/DB-backed sweepPreviewBundles.
    const origSetInterval = globalThis.setInterval;
    const origClearInterval = globalThis.clearInterval;
    let capturedFn: (() => unknown) | undefined;
    let capturedMs: number | undefined;
    let clearedId: unknown;
    const fakeId = { __fakeTimer: true } as unknown as ReturnType<typeof setInterval>;
    globalThis.setInterval = ((fn: () => unknown, ms: number) => {
      capturedFn = fn;
      capturedMs = ms;
      return fakeId;
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: unknown) => {
      clearedId = id;
    }) as typeof clearInterval;

    const origLog = console.log;
    const origWarn = console.warn;
    const logCalls: unknown[][] = [];
    const warnCalls: unknown[][] = [];
    console.log = (...a: unknown[]) => {
      logCalls.push(a);
    };
    console.warn = (...a: unknown[]) => {
      warnCalls.push(a);
    };

    try {
      let sweepResult: SweepResult = { blocked: 0, stale: 0, evicted: 0 };
      let shouldReject = false;
      const stop = startPreviewSweeper(12345, async () => {
        if (shouldReject) throw new Error("disk unreachable");
        return sweepResult;
      });
      expect(capturedMs).toBe(12345);
      expect(typeof capturedFn).toBe("function");

      // All-zero result → nothing changed, nothing worth logging.
      await capturedFn!();
      expect(logCalls.length).toBe(0);

      // Non-zero result → the one-line summary fires.
      sweepResult = { blocked: 1, stale: 2, evicted: 3 };
      await capturedFn!();
      expect(logCalls.length).toBe(1);
      expect(String(logCalls[0][0])).toContain("1 blocked, 2 stale vs main, 3 lru/orphan");

      // A rejecting sweep is caught inside tick — warns and waits for the next
      // tick, never lets the rejection escape (which would otherwise surface as
      // an unhandled rejection with no interval callback to catch it).
      shouldReject = true;
      await expect(capturedFn!()).resolves.toBeUndefined();
      expect(warnCalls.length).toBe(1);
      expect(String(warnCalls[0][0])).toContain("disk unreachable");

      stop();
      expect(clearedId).toBe(fakeId);
    } finally {
      globalThis.setInterval = origSetInterval;
      globalThis.clearInterval = origClearInterval;
      console.log = origLog;
      console.warn = origWarn;
    }
  });
});
