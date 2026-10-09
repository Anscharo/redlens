// Where `pnpm census:pau` reads the PAU snapshots: production's GET /api/pau
// by default, because CI has no database and the endpoint serves the worker's
// rows as the reader sees them; or a file or URL named with --snapshots.
// A source that cannot be read, or serves no deployments, comes back as a
// problem and no snapshots, never as an empty list, so a broken source cannot
// read as every disagreement resolved. Snapshots older than MAX_AGE_HOURS come
// back with a problem too: they still compare, but are not accepted.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { StoredPauSnapshot } from "../../src/lib/pau.ts";
import { politeFetch } from "../../src/lib/upstreamBackoff.ts";

export const PRODUCTION_PAU = "https://atlas.redline.support/api/pau";

/** Six worker refresh intervals (PAU_REFRESH_SECONDS defaults to an hour): the worker's pau step has stopped. */
const MAX_AGE_HOURS = 6;
const TIMEOUT_MS = 60_000;
const RETRY_AFTER_MS = 5_000;

export interface SnapshotRead {
  snaps: StoredPauSnapshot[] | null;
  problem: string | null;
}

const isUrl = (source: string) => /^https?:\/\//.test(source);

async function fetchJson(url: string): Promise<unknown> {
  const res = await politeFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** A URL is fetched with one retry, so a single network blip does not read as an outage. */
async function readBody(source: string): Promise<unknown> {
  if (!isUrl(source)) return JSON.parse(fs.readFileSync(source, "utf8"));
  try {
    return await fetchJson(source);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
    return fetchJson(source);
  }
}

export async function readSnapshots(source: string, now = Date.now()): Promise<SnapshotRead> {
  let body: unknown;
  try {
    body = await readBody(source);
  } catch (e) {
    return { snaps: null, problem: `${source} could not be read (${(e as Error).message})` };
  }
  const snaps = (body as { deployments?: StoredPauSnapshot[] } | null)?.deployments;
  if (!Array.isArray(snaps) || snaps.length === 0) return { snaps: null, problem: `${source} served no deployments` };
  const newest = Math.max(...snaps.map((s) => Date.parse(s.fetchedAt)));
  if (!Number.isFinite(newest)) return { snaps, problem: `${source} served snapshots without a read time` };
  const hours = (now - newest) / 3_600_000;
  return { snaps, problem: hours > MAX_AGE_HOURS ? `the newest snapshot from ${source} is ${Math.floor(hours)} hours old; the worker's pau step may have stopped` : null };
}

/**
 * The atlas the server probed against beside the one checked out. They differ
 * by a bump or so; a value only the checkout states reads as not yet compared.
 */
export async function atlasSkew(source: string, root: string): Promise<string | null> {
  if (!isUrl(source)) return null;
  const local = spawnSync("git", ["-C", path.join(root, "vendor/next-gen-atlas"), "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() ?? "";
  try {
    const served = ((await fetchJson(new URL("/api/health", source).href)) as { atlas_sha?: string }).atlas_sha ?? "";
    return served === local ? null : `pau-census: the server's atlas is ${served.slice(0, 7) || "unknown"}, the checkout's is ${local.slice(0, 7) || "unknown"}`;
  } catch {
    return "pau-census: the server's atlas commit could not be read";
  }
}
