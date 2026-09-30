// Where a preview's vectors come from: the kept vectors, the live store and
// the provider, behind one injectable interface, and the lookup that tries
// memory, then what is kept, then the provider. See embeddings.ts for what the
// lane is for, and vector-cache.ts for where vectors are kept.

import { sql } from "../db.ts";
import { config } from "../config.ts";
import { embedBatch } from "../retrieval/embed.ts";
import { evictVectors, readVectors, saveVectors } from "./vector-cache.ts";

const BATCH = 64;
const PARALLEL = 4;

/** One row of embeddings-index.json: which vector a row of the preview needs.
 *  The same fields as an atlas_doc_embeddings row, with the vector left out —
 *  it is kept once, by `hash`, in preview_vectors (vector-cache.ts). */
export interface PreviewIndexRow {
  id: string;
  hash: string;
  memberIds: string[];
  attributionOnly: boolean;
}

export interface PreviewEmbeddingsIndex {
  model: string;
  dim: number;
  policy: string;
  rows: PreviewIndexRow[];
  /** Rows whose vector could not be had (over MAX_TEXTS, or a failed batch). */
  missing: number;
}

export interface VectorDeps {
  /** False when no vector can be made at all (no API key). */
  enabled: boolean;
  /** doc_id → content_hash, for every row of the live store. */
  liveHashes: () => Promise<Map<string, string>>;
  /** The vectors already held for these content hashes, keyed by hash: the
   *  ones kept from earlier previews and the live atlas's own. */
  knownVectors: (hashes: string[]) => Promise<Map<string, number[]>>;
  embedBatch: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
  /** Keep vectors the provider just made, so no rebuild asks for them again. */
  saveVectors: (entries: [hash: string, vector: number[]][]) => Promise<void>;
  /** Called once after a run that saved something. */
  evictVectors: () => Promise<unknown>;
}

export const realVectorDeps: VectorDeps = {
  get enabled() {
    return !!config.openrouterApiKey;
  },
  liveHashes: async () => {
    const rows = (await sql`SELECT doc_id, content_hash FROM atlas_doc_embeddings`) as { doc_id: string; content_hash: string }[];
    return new Map(rows.map((r) => [r.doc_id, r.content_hash]));
  },
  knownVectors: (hashes) => readVectors(hashes),
  embedBatch,
  saveVectors: (entries) => saveVectors(entries),
  evictVectors: () => evictVectors(),
};

/** What the rest of the build keeps in memory after the file is written. */
export interface PreviewVectors {
  /** Every vector this build resolved, by content hash. Grows as the gate
   *  resolves old-side texts. */
  byHash: Map<string, Float32Array>;
  /** Documents the preview stores as THEMSELVES — title and body, not a folded
   *  group or a breadcrumbed record. Only these have a vector the gate can use. */
  plain: Set<string>;
  deps: VectorDeps;
  /** The build's own signal: aborted when the build ends. */
  outer?: AbortSignal;
  /** A time budget ran out waiting on the provider. From then on no further
   *  text is sent to it: a provider that stalled once is not asked again, so a
   *  build pays for the stall one time, not once per diff base. */
  spent: boolean;
}

/** Vectors for texts by hash: memory, then what is kept, then the provider.
 *  What the provider makes is kept for the next build. */
export async function resolve(texts: Map<string, string>, pv: Pick<PreviewVectors, "byHash" | "deps">, signal: AbortSignal, max = Infinity): Promise<void> {
  const wanted = [...texts.keys()].filter((h) => !pv.byHash.has(h));
  if (!wanted.length) return;
  for (const [h, v] of await pv.deps.knownVectors(wanted)) pv.byHash.set(h, Float32Array.from(v));
  const todo = wanted.filter((h) => !pv.byHash.has(h)).slice(0, max);
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  let saved = false;
  const worker = async () => {
    for (let batch = batches.shift(); batch && !signal.aborted; batch = batches.shift()) {
      let out: number[][];
      try {
        out = await pv.deps.embedBatch(batch.map((h) => texts.get(h)!), signal);
      } catch (e) {
        // One failed batch costs its own rows, not the run.
        console.warn(`[preview] embedding batch of ${batch.length} failed: ${(e as Error).message}`);
        continue;
      }
      batch.forEach((h, j) => pv.byHash.set(h, Float32Array.from(out[j])));
      // Keeping them is a saving for next time, never a condition of this run.
      await pv.deps
        .saveVectors(batch.map((h, j) => [h, out[j]]))
        .then(() => (saved = true))
        .catch((e) => console.warn(`[preview] vectors not kept: ${(e as Error).message}`));
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (saved) await pv.deps.evictVectors().catch(() => {});
}
