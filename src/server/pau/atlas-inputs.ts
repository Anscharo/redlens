// The atlas artifacts a PAU rebuild reads: graph.json, for the RateLimitIDs the
// probe reads live (probe.ts), and addresses.atlas.json, for the addresses keys
// are derived from (key-derive.ts). The worker's tick steps run before its
// build, and its image builds nothing, so public/ holds neither on most ticks.
// They come from the set published for the sha sync_state points at
// (atlas_artifacts), written to a scratch directory; a name the store lacks
// keeps its public/ path, so a local run that built the atlas still reads it.
import os from "node:os";
import path from "node:path";
import { getArtifacts } from "../atlas-artifacts.ts";
import { writeStoredArtifacts } from "../bundle-store.ts";
import type { SqlTag } from "../sql-types.ts";

export const PAU_ATLAS_ARTIFACTS = ["graph.json", "addresses.atlas.json"] as const;
export type PauAtlasInputs = Record<(typeof PAU_ATLAS_ARTIFACTS)[number], string>;

/** Each artifact's public/ path. */
export const publicInputs = (publicDir = "public"): PauAtlasInputs =>
  Object.fromEntries(PAU_ATLAS_ARTIFACTS.map((n) => [n, path.join(publicDir, n)])) as PauAtlasInputs;

/** Each artifact's path: the published copy for sync_state's sha where the store has it, else public/. */
export async function pauAtlasInputs(db: SqlTag, { publicDir = "public", dir = path.join(os.tmpdir(), "pau-atlas") } = {}): Promise<PauAtlasInputs> {
  const [row] = (await db`SELECT atlas_sha FROM sync_state WHERE id = 1`) as { atlas_sha?: string | null }[];
  const items = row?.atlas_sha ? await getArtifacts(row.atlas_sha, PAU_ATLAS_ARTIFACTS, db) : [];
  if (items.length) await writeStoredArtifacts(dir, items);
  const stored = new Set(items.map((a) => a.name));
  const out = publicInputs(publicDir);
  for (const n of PAU_ATLAS_ARTIFACTS) if (stored.has(n)) out[n] = path.join(dir, n);
  return out;
}
