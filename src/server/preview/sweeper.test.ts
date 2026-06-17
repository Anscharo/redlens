import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sweepPreviewBundles } from "./sweeper.ts";
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
});
