// The off-chain artifacts `pnpm dev` refreshes before boot: the Soter
// settlement workbooks and the Sky vote record.
//
// Both files are gitignored and deliberately OFF the `pnpm build` chain (that
// build is offline + deterministic under REPRO=1, and these fetch from GitHub
// and vote.sky.money), so without this step a fresh checkout has neither — and
// the miss is silent: Vite's SPA fallback answers the missing path with 200
// text/html, the browser loader swallows the parse error, and the page just
// hides what the file feeds. Prod gets both from the Dockerfile's post-build bake.
//
// Failure is never fatal — each script only writes on success, so an offline
// boot keeps the file that is already on disk. The workbooks refresh on every
// boot (all 36 fetch and parse in ~2s); the vote record costs two repository
// downloads and a dozen portal pages, and executives land weekly, so it
// refreshes only when missing or older than its maxAgeMs.
import { existsSync, statSync } from "node:fs";
import process from "node:process";

export const OFF_CHAIN_ARTIFACTS = [
  {
    path: "public/settlements.json",
    script: "settlements:parse",
    // Read literally, so the env registry test (src/server/env/env.test.ts) sees it.
    skipFlag: () => process.env.DEV_NO_SETTLEMENTS,
    label: "Soter settlement workbooks",
    withoutIt: "Radar's Monthly settlement section will be hidden.",
    maxAgeMs: 0,
  },
  {
    path: "public/votes.json",
    script: "votes:sync",
    skipFlag: () => process.env.DEV_NO_VOTES,
    label: "the Sky vote record",
    withoutIt: "Stale Dates will show no vote evidence.",
    maxAgeMs: 6 * 60 * 60 * 1000,
  },
];

interface PreflightIO {
  log: (m: string) => void;
  warn: (m: string) => void;
  run: (cmd: string, args: string[]) => { status: number | null };
  truthy: (v: string | undefined) => boolean;
}

/** Refreshes each artifact through its pnpm script (so the runner stays declared in package.json). */
export function ensureOffChainArtifacts({ log, warn, run, truthy }: PreflightIO): void {
  if (truthy(process.env.DEV_NO_BUILD)) return;
  for (const a of OFF_CHAIN_ARTIFACTS) {
    if (truthy(a.skipFlag())) continue;
    if (a.maxAgeMs && existsSync(a.path) && Date.now() - statSync(a.path).mtimeMs < a.maxAgeMs) continue;
    log(`Refreshing ${a.label} (${a.path})…`);
    if (run("pnpm", [a.script, "--quiet"]).status === 0) continue;
    warn(`${a.script} failed — ${existsSync(a.path) ? `keeping the ${a.path} already on disk.` : a.withoutIt}`);
  }
}
