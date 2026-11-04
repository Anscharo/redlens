/**
 * The read-through disk cache of verified-source lookups, one JSON file per
 * address at .cache/etherscan/<chainid>/<addr>.json. It is committed, and the
 * worker image ships it, because the PAU key namers read every entry.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeEntry, type SourceEntry } from "./explorer-source.ts";

const CACHE_DIR = fileURLToPath(new URL("../../.cache/etherscan", import.meta.url));

// A miss (no provider serves the chain or holds the contract) is cached with a
// date after which it is asked again: until then the address costs no request
// and no warning, and a provider added later (a paid key) still gets asked.
const MISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export type CachedSource = SourceEntry & { retryAfter?: string };

function cachePath(chainid: number, addr: string): string {
  return path.join(CACHE_DIR, String(chainid), `${addr}.json`);
}

/** The cached entry, or null when there is none or it is a miss past its retryAfter, so every reader asks again. */
export async function readCache(chainid: number, addr: string): Promise<CachedSource | null> {
  try {
    const entry = JSON.parse(await fs.readFile(cachePath(chainid, addr), "utf8")) as CachedSource;
    return entry.retryAfter && Date.now() >= Date.parse(entry.retryAfter) ? null : entry;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeCache(chainid: number, addr: string, entry: CachedSource): Promise<void> {
  const p = cachePath(chainid, addr);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(entry, null, 2));
}

/** Caches a miss from every source (a SourceMiss) as an empty entry until MISS_RETRY_MS from now. */
export async function cacheMiss(chainid: number, addr: string, err: Error): Promise<CachedSource> {
  const entry = { ...makeEntry(chainid, addr, {}), retryAfter: new Date(Date.now() + MISS_RETRY_MS).toISOString() };
  await writeCache(chainid, addr, entry);
  console.log(`  · ${chainid}/${addr}: no source anywhere (${err.message}); asked again after ${entry.retryAfter.slice(0, 10)}`);
  return entry;
}
