// A preview's vectors: the ones it needs that the live store does not hold.
//
// Two readers share them. The identity gate compares a retitled document's old
// and new vector (embeddings-similarity.ts). Preview semantic search — not
// built yet — will read the live store for every row the preview left
// untouched and these for the rest. Making one vector serve both is why the
// gate was measured on the text search stores, not on the bare body — see
// REPLACE_MAX_COSINE.
//
// The vectors are KEPT ONCE, in preview_vectors (vector-cache.ts), keyed by
// content hash. The bundle holds only a list of which rows need which hash,
// embeddings-index.json. A bundle is removed often and rebuilt on the next
// visit; the vectors outlive it, so a rebuild asks the provider for nothing
// (measured: 0.4 seconds against 17).
//
// Best effort throughout. No API key, a provider error or a slow response
// leaves the preview without vectors, and the gate then judges by lines and
// words as it did before. Nothing here can change a build's outcome.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { EMBED_DIM } from "../retrieval/embed.ts";
import { byDocNo, planEmbedRows, shippedPolicy } from "../retrieval/embed-rows.ts";
import { withDeadline } from "../jev.ts";
import type { AtlasNode } from "../../types.ts";
import { realVectorDeps, resolve, type PreviewEmbeddingsIndex, type PreviewVectors, type VectorDeps } from "./embeddings-store.ts";

export { realVectorDeps } from "./embeddings-store.ts";
export type { PreviewEmbeddingsIndex, PreviewIndexRow, PreviewVectors, VectorDeps } from "./embeddings-store.ts";
export { bodySimilarity } from "./embeddings-similarity.ts";

export const EMBEDDINGS_INDEX_FILE = "embeddings-index.json";
// A preview that shares no text with the live atlas would embed all of it.
// Past this many texts the rest are left out, nearest the top of the atlas
// first; search on that preview is then partial, and the index says by how much.
const MAX_TEXTS = 2000;
// The whole lane, lookups included. A preview build has five minutes in all.
const BUDGET_MS = 60_000;

/**
 * Make the vectors the preview needs, keep them, and write
 * <outDir>/embeddings-index.json. Resolves to null — and writes nothing — when
 * no vectors could be had. `outDir` must
 * already hold the preview's docs.json. `outer` is the build's own signal: a
 * build that has ended stops the lane and leaves no file.
 */
export async function buildPreviewEmbeddings(outDir: string, deps: VectorDeps = realVectorDeps, outer?: AbortSignal): Promise<PreviewVectors | null> {
  if (!deps.enabled || outer?.aborted) return null;
  const signal = withDeadline(BUDGET_MS, outer);
  try {
    const nodes = Object.values(JSON.parse(fs.readFileSync(path.join(outDir, "docs.json"), "utf8")).nodes) as AtlasNode[];
    const policy = shippedPolicy();
    const { rows } = planEmbedRows(nodes, policy);

    const live = await deps.liveHashes();
    const need = rows.filter((r) => live.get(r.id) !== r.hash).sort(byDocNo);
    const pv: PreviewVectors = {
      byHash: new Map(),
      plain: new Set(rows.filter((r) => r.plain).map((r) => r.id)),
      deps,
      outer,
      spent: false,
    };
    await resolve(new Map(need.map((r) => [r.hash, r.text])), pv, signal, MAX_TEXTS);
    if (outer?.aborted) return null;
    pv.spent = signal.aborted;

    const held = need.filter((r) => pv.byHash.has(r.hash));
    const index: PreviewEmbeddingsIndex = {
      model: config.embedModel,
      dim: EMBED_DIM,
      policy,
      rows: held.map((r) => ({ id: r.id, hash: r.hash, memberIds: r.memberIds, attributionOnly: r.attributionOnly })),
      missing: need.length - held.length,
    };
    fs.writeFileSync(path.join(outDir, EMBEDDINGS_INDEX_FILE), JSON.stringify(index));
    console.log(`[preview] embeddings: ${need.length} rows differ from the live store, ${held.length} have a vector${index.missing ? `, ${index.missing} missing` : ""}`);
    return pv;
  } catch (e) {
    console.warn(`[preview] embeddings skipped (${(e as Error).message}) — the identity gate judges by lines and words`);
    return null;
  }
}
