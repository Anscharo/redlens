// The link from atlas changes to their pull requests and the spells those name
// (src/server/history/pr-spells.ts): once per atlas commit, every stored change
// whose commit names a PR it was stored without, from the atlas git log; then a
// few PR records a tick, from the committed cache where it holds them, else
// fetched with `gh` (fetchPr), the first that cannot be fetched ending the tick.
// Under --no-fetch only the cache is read; a PR environment skips the step,
// since its image holds no cache.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PRS_PER_TICK = 30;


/** The cached record of one PR, without fetching; null when the cache lacks it. */
async function cachedPr(pr: number): Promise<import("../../../src/server/history/pr-spells.ts").PrRecord | null> {
  const { PR_CACHE_DIR } = await import("../github-pr-cache.mjs");
  const file = path.join(PR_CACHE_DIR, `${pr}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

/** Short sha → the PR its subject names, for every commit of the atlas checkout; empty when git cannot read it. */
async function prsByCommit(): Promise<Map<string, number>> {
  const { extractPrNumber } = await import("../github-pr-cache.mjs");
  const { config } = await import("../../../src/server/config.ts");
  try {
    const out = execFileSync("git", ["log", "--format=%H %s"], { cwd: path.join(config.root, "vendor/next-gen-atlas"), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 50 * 1024 * 1024 });
    const pairs = out.split("\n").map((l) => [l.slice(0, 7), extractPrNumber(l.slice(41))] as const);
    return new Map(pairs.filter((p): p is readonly [string, number] => p[1] !== null));
  } catch {
    return new Map();
  }
}

export default {
  id: "pr-spells",
  phase: "tick" as const,
  label: "atlas PR spells step",
  skipWhenInert: "atlas PR spells skipped (PR environment) — its image holds no PR records",
  async run({ db, noFetch }: { db: unknown; noFetch: boolean }): Promise<string> {
    const { backfillPrNumbers, fillPrSpells, markPrBackfill, prBackfillDue } = await import("../../../src/server/history/pr-spells.ts");
    const { fetchPr } = await import("../github-pr-cache.mjs");
    const sql = db as Parameters<typeof fillPrSpells>[0];
    const due = await prBackfillDue(sql);
    const linked = due ? await backfillPrNumbers(sql, await prsByCommit()) : 0;
    if (due) await markPrBackfill(sql, due);
    const record = noFetch ? cachedPr : async (pr: number) => (await fetchPr(pr)) as Awaited<ReturnType<typeof cachedPr>>;
    const r = await fillPrSpells(sql, record, PRS_PER_TICK, !noFetch);
    return `atlas PR spells: ${linked} changes given their PR, ${r.read} PRs read (${r.named} name a spell), ${r.missing} without a record`;
  },
};
