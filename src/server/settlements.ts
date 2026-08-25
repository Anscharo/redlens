// Load baked settlements.json for server-side chat/MCP views.
// Same artifact Radar fetches from BASE_URL — not atlas-SHA keyed.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EMPTY_SETTLEMENTS, type SettlementsBundle } from "../lib/settlements.ts";
import { config } from "./config.ts";

const ROOT = resolve(import.meta.dir, "../..");

let cached: SettlementsBundle | null = null;
let cachedPath: string | null = null;

function candidatePaths(): string[] {
  return [resolve(ROOT, "public/settlements.json"), resolve(config.distDir, "settlements.json")];
}

export function settlementsJsonPath(): string | null {
  return candidatePaths().find((p) => existsSync(p)) ?? null;
}

// Load-once per resolved path. settlements.json is baked at image build and
// refreshed by dev-preflight before the server boots, so it never changes under
// a running process — no SHA/drift invalidation to do. A miss (no file yet)
// caches EMPTY against a null path, so the next call re-resolves and picks the
// file up if it appears.
export async function loadSettlementsFromDisk(): Promise<SettlementsBundle> {
  const path = settlementsJsonPath();
  if (cached && cachedPath === path) return cached;
  if (!path) {
    cached = EMPTY_SETTLEMENTS;
    cachedPath = null;
    return cached;
  }
  const file = Bun.file(path);
  try {
    cached = (await file.json()) as SettlementsBundle;
    cachedPath = path;
    return cached;
  } catch {
    cached = EMPTY_SETTLEMENTS;
    cachedPath = path;
    return cached;
  }
}
