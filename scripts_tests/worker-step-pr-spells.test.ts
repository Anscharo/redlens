// The pr-spells tick step: history rows get their PR numbers once per atlas
// commit, from the atlas git log, and PR records are read from the cache under
// --no-fetch and fetched otherwise, the first miss ending a fetching tick.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-spells-"));
fs.writeFileSync(path.join(cacheDir, "369.json"), JSON.stringify({ title: "Spell 2026-01-15", body: "" }));

const execFileSync = vi.fn();
vi.mock("node:child_process", () => ({ execFileSync }));
vi.mock("../src/server/config.ts", () => ({ config: { root: "/repo" } }));
const fetchPr = vi.fn();
vi.mock("../scripts/lib/github-pr-cache.mjs", () => ({
  PR_CACHE_DIR: cacheDir,
  fetchPr,
  extractPrNumber: (s: string) => (/\(#(\d+)\)\s*$/.exec(s) ? Number(/\(#(\d+)\)\s*$/.exec(s)![1]) : null),
}));
const prBackfillDue = vi.fn();
const backfillPrNumbers = vi.fn();
const markPrBackfill = vi.fn();
const fillPrSpells = vi.fn();
vi.mock("../src/server/history/pr-spells.ts", () => ({ prBackfillDue, backfillPrNumbers, markPrBackfill, fillPrSpells }));

const { WORKER_STEPS } = await import("../scripts/lib/worker-steps/index.mjs");
const step = WORKER_STEPS.find((s) => s.id === "pr-spells")!;

const db = {};
const ctx = (noFetch: boolean) => ({ db, full: false, noFetch, inert: false, env: {}, runAsync: async () => {}, log: () => {}, warn: () => {} });
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

beforeEach(() => {
  vi.clearAllMocks();
  fillPrSpells.mockResolvedValue({ read: 2, named: 1, missing: 0 });
});

describe("pr-spells worker step", () => {
  it("gives history rows their PR numbers from the atlas git log when the atlas has moved", async () => {
    prBackfillDue.mockResolvedValue("abc1234");
    backfillPrNumbers.mockResolvedValue(3);
    execFileSync.mockReturnValue(`${SHA_A} Add Keel limits (#369)\n${SHA_B} Fix a typo\n`);
    expect(await step.run(ctx(false))).toBe("atlas PR spells: 3 changes given their PR, 2 PRs read (1 name a spell), 0 without a record");
    expect(execFileSync.mock.calls[0][2]).toMatchObject({ cwd: path.join("/repo", "vendor/next-gen-atlas") });
    expect(backfillPrNumbers).toHaveBeenCalledWith(db, new Map([["aaaaaaa", 369]]));
    expect(markPrBackfill).toHaveBeenCalledWith(db, "abc1234");
  });

  it("reads no git log when the atlas has not moved", async () => {
    prBackfillDue.mockResolvedValue(null);
    expect(await step.run(ctx(false))).toMatch(/^atlas PR spells: 0 changes given their PR/);
    expect(execFileSync).not.toHaveBeenCalled();
    expect(markPrBackfill).not.toHaveBeenCalled();
  });

  it("backfills nothing when git cannot read the checkout, and still marks the commit", async () => {
    prBackfillDue.mockResolvedValue("abc1234");
    backfillPrNumbers.mockResolvedValue(0);
    execFileSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });
    await step.run(ctx(false));
    expect(backfillPrNumbers).toHaveBeenCalledWith(db, new Map());
    expect(markPrBackfill).toHaveBeenCalledWith(db, "abc1234");
  });

  it("fetches records and stops at the first miss", async () => {
    prBackfillDue.mockResolvedValue(null);
    fetchPr.mockResolvedValue({ title: "t", body: "b" });
    await step.run(ctx(false));
    const [, record, limit, stopOnMiss] = fillPrSpells.mock.calls[0];
    expect([limit, stopOnMiss]).toEqual([30, true]);
    expect(await record(7)).toEqual({ title: "t", body: "b" });
    expect(fetchPr).toHaveBeenCalledWith(7);
  });

  it("reads only the cache under --no-fetch, a missing record being null", async () => {
    prBackfillDue.mockResolvedValue(null);
    await step.run(ctx(true));
    const [, record, , stopOnMiss] = fillPrSpells.mock.calls[0];
    expect(stopOnMiss).toBe(false);
    expect(await record(369)).toEqual({ title: "Spell 2026-01-15", body: "" });
    expect(await record(1)).toBeNull();
    expect(fetchPr).not.toHaveBeenCalled();
  });
});
