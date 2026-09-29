// A preview's vectors: the ones it needs that the live store does not hold.
//
// Two readers share them. Preview semantic search reads the live store for
// every row the preview left untouched and this file for the rest. That reader
// is not built yet: today the file is written and nothing reads it. The
// identity gate (identity.ts) compares a retitled document's old and new
// vector. Making one vector serve both is why the gate was measured on the
// text search stores, not on the bare body — see REPLACE_MAX_COSINE.
//
// Like every other preview artifact the file lives in the bundle
// (<sha>/out/embeddings.json), never in Postgres. It is the one artifact that
// costs a network call to rebuild, so only text the live store has no vector
// for is embedded: rows are matched by content hash, which makes a renumbering
// or a preview of an unchanged branch cost nothing.
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
import { encodeVector, realVectorDeps, resolve, type PreviewEmbeddingsJson, type PreviewVectors, type VectorDeps } from "./embeddings-store.ts";

export { decodeVector, encodeVector, realVectorDeps } from "./embeddings-store.ts";
export type { PreviewEmbeddingsJson, PreviewVectorRow, PreviewVectors, VectorDeps } from "./embeddings-store.ts";
export { bodySimilarity } from "./embeddings-similarity.ts";

export const EMBEDDINGS_FILE = "embeddings.json";
// A preview that shares no text with the live atlas would embed all of it.
// Past this many texts the rest are left out, nearest the top of the atlas
// first; search on that preview is then partial, and the file says by how much.
const MAX_TEXTS = 2000;
// The whole lane, lookups included. A preview build has five minutes in all.
const BUDGET_MS = 60_000;

/**
 * Embed what the preview changed and write <outDir>/embeddings.json. Resolves
 * to null — and writes nothing — when no vectors could be made. `outDir` must
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

    const written = need
      .filter((r) => pv.byHash.has(r.hash))
      .map((r) => ({ id: r.id, hash: r.hash, memberIds: r.memberIds, attributionOnly: r.attributionOnly, vector: encodeVector(pv.byHash.get(r.hash)!) }));
    const out: PreviewEmbeddingsJson = { model: config.embedModel, dim: EMBED_DIM, policy, rows: written, missing: need.length - written.length };
    fs.writeFileSync(path.join(outDir, EMBEDDINGS_FILE), JSON.stringify(out));
    console.log(`[preview] embeddings: ${need.length} rows differ from the live store, ${written.length} written${out.missing ? `, ${out.missing} missing` : ""}`);
    return pv;
  } catch (e) {
    console.warn(`[preview] embeddings skipped (${(e as Error).message}) — the identity gate judges by lines and words`);
    return null;
  }
}
