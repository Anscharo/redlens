// Background bundle sweeper. Builds only clean up after themselves
// (post-build evictLru) — nothing on a timer. This closes the three gaps:
//
//   blocked — a takedown (`UPDATE previews SET blocked_at = now()`) previously
//             evicted the bundle only on the NEXT request for it; now it lands
//             within one sweep interval.
//   stale   — diff.json/markers are computed against main AT BUILD TIME; when
//             the in-process updater hot-swaps main, every bundle keeps serving
//             redlines vs the OLD main. Swept once main moves past the bundle's
//             recorded baseline — except bundles touched within the grace
//             window, so an actively-browsed preview isn't yanked mid-session.
//             The next visit rebuilds against current main (quota-free).
//   lru     — orphan/interrupted dirs and the >KEEP overflow now also get
//             collected when no builds are happening.
//
// In-flight builds are never touched. Everything removed here regenerates from
// the previews row on next access — sweeping is always safe, never destructive.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { getIndexes } from "../indexes.ts";
import { PREVIEW_DIR, bundleReady, readMeta, remove, evictLru } from "./cache.ts";
import { blockedShas } from "./db.ts";
import { inflightShas } from "./build.ts";

const GRACE_MS = Number(process.env.PREVIEW_SWEEP_GRACE_MS ?? 600_000);

export interface SweepResult {
  blocked: number;
  stale: number;
  evicted: number;
}

export interface SweepOpts {
  root?: string;
  /** Overrides for tests; defaults query the DB / live indexes / build map. */
  blocked?: Set<string>;
  mainCommit?: string | null;
  skip?: Set<string>;
  graceMs?: number;
  now?: number;
}

export async function sweepPreviewBundles(opts: SweepOpts = {}): Promise<SweepResult> {
  const root = opts.root ?? PREVIEW_DIR;
  const res: SweepResult = { blocked: 0, stale: 0, evicted: 0 };
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return res; // no preview dir yet
  }
  const skip = opts.skip ?? inflightShas();
  const blocked = opts.blocked ?? (await blockedShas().catch(() => new Set<string>()));
  let mainCommit = opts.mainCommit;
  if (mainCommit === undefined) {
    try {
      mainCommit = getIndexes().meta.atlasCommit;
    } catch {
      mainCommit = null; // indexes not loaded — skip staleness, sweep the rest
    }
  }
  const graceMs = opts.graceMs ?? GRACE_MS;
  const now = opts.now ?? Date.now();

  for (const sha of entries) {
    // Unfinished dirs are evictLru's job below; in-flight builds are off-limits.
    if (skip.has(sha) || !bundleReady(sha, root)) continue;
    if (blocked.has(sha)) {
      remove(sha, root);
      res.blocked++;
      continue;
    }
    if (!mainCommit) continue;
    const meta = readMeta(sha, root);
    if (meta?.baseAtlasCommit === mainCommit) continue; // current — keep
    let mtime = 0;
    try {
      mtime = fs.statSync(path.join(root, sha)).mtimeMs;
    } catch {
      continue; // raced with another remover
    }
    if (now - mtime < graceMs) continue; // recently accessed — don't yank mid-session
    remove(sha, root);
    res.stale++;
  }
  res.evicted = evictLru(undefined, root, skip).length;
  return res;
}

/** Periodic sweep, started at boot when previews are enabled. Best-effort —
 *  a failed pass logs and waits for the next tick. Returns a stopper. */
export function startPreviewSweeper(intervalMs = config.previewSweepIntervalMs): () => void {
  const tick = async () => {
    try {
      const r = await sweepPreviewBundles();
      if (r.blocked || r.stale || r.evicted)
        console.log(`preview: sweep — ${r.blocked} blocked, ${r.stale} stale vs main, ${r.evicted} lru/orphan`);
    } catch (e) {
      console.warn(`preview: sweep failed: ${(e as Error).message}`);
    }
  };
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
