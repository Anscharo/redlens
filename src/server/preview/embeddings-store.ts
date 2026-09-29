// Where a preview's vectors come from, and the shape they are stored in:
// the row format of embeddings.json, the live store and the provider behind
// one injectable interface, and the lookup that tries memory, then the live
// store, then the provider. See embeddings.ts for what the lane is for.

import { sql } from "../db.ts";
import { config } from "../config.ts";
import { embedBatch } from "../retrieval/embed.ts";

const BATCH = 64;
const PARALLEL = 4;

/** One row of the file — the same fields as an atlas_doc_embeddings row. */
export interface PreviewVectorRow {
  id: string;
  hash: string;
  memberIds: string[];
  attributionOnly: boolean;
  /** The vector as base64 of its little-endian float32 values — see
   *  decodeVector. As JSON numbers 520 rows came to 11.3 MB; this is 2.9 MB. */
  vector: string;
}

export function encodeVector(v: number[]): string {
  return Buffer.from(new Float32Array(v).buffer).toString("base64");
}

export function decodeVector(s: string): number[] {
  const b = Buffer.from(s, "base64");
  return [...new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)];
}

export interface PreviewEmbeddingsJson {
  model: string;
  dim: number;
  policy: string;
  rows: PreviewVectorRow[];
  /** Rows that needed a vector and did not get one (over MAX_TEXTS, or a failed batch). */
  missing: number;
}

export interface VectorDeps {
  /** False when no vector can be made at all (no API key). */
  enabled: boolean;
  /** doc_id → content_hash, for every row of the live store. */
  liveHashes: () => Promise<Map<string, string>>;
  /** The live vectors whose content hash is one of these, keyed by hash. */
  liveVectors: (hashes: string[]) => Promise<Map<string, number[]>>;
  embedBatch: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
}

export const realVectorDeps: VectorDeps = {
  get enabled() {
    return !!config.openrouterApiKey;
  },
  liveHashes: async () => {
    const rows = (await sql`SELECT doc_id, content_hash FROM atlas_doc_embeddings`) as { doc_id: string; content_hash: string }[];
    return new Map(rows.map((r) => [r.doc_id, r.content_hash]));
  },
  liveVectors: async (hashes) => {
    if (!hashes.length) return new Map();
    // The RAW array with a ::jsonb cast — see pg-array.ts. pgvector's text form
    // is a JSON array, so it parses as one.
    const rows = (await sql`
      SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS v
        FROM atlas_doc_embeddings
       WHERE content_hash IN (SELECT jsonb_array_elements_text(${hashes}::jsonb))
    `) as { content_hash: string; v: string }[];
    return new Map(rows.map((r) => [r.content_hash, JSON.parse(r.v) as number[]]));
  },
  embedBatch,
};

/** What the rest of the build keeps in memory after the file is written. */
export interface PreviewVectors {
  /** Every vector this build resolved, by content hash. Grows as the gate
   *  resolves old-side texts. */
  byHash: Map<string, number[]>;
  /** Documents the preview stores as THEMSELVES — title and body, not a folded
   *  group or a breadcrumbed record. Only these have a vector the gate can use. */
  plain: Set<string>;
  deps: VectorDeps;
  /** Aborted when the build lane ran out of time or the build ended. Once it
   *  is, no further text is sent to the provider. */
  signal: AbortSignal;
}

/** A controller that aborts after `ms`, or as soon as `outer` does. The
 *  caller clears `timer` when its work is done. */
export function deadline(ms: number, outer?: AbortSignal): { abort: AbortController; timer: ReturnType<typeof setTimeout> } {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  if (outer?.aborted) abort.abort();
  else outer?.addEventListener("abort", () => abort.abort(), { once: true });
  return { abort, timer };
}

/** Vectors for texts by hash: memory, then the live store, then the provider. */
export async function resolve(texts: Map<string, string>, pv: Pick<PreviewVectors, "byHash" | "deps">, signal: AbortSignal, max = Infinity): Promise<void> {
  const wanted = [...texts.keys()].filter((h) => !pv.byHash.has(h));
  if (!wanted.length) return;
  for (const [h, v] of await pv.deps.liveVectors(wanted)) pv.byHash.set(h, v);
  const todo = wanted.filter((h) => !pv.byHash.has(h)).slice(0, max);
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  const worker = async () => {
    for (let batch = batches.shift(); batch && !signal.aborted; batch = batches.shift()) {
      try {
        const out = await pv.deps.embedBatch(batch.map((h) => texts.get(h)!), signal);
        batch.forEach((h, j) => pv.byHash.set(h, out[j]));
      } catch (e) {
        // One failed batch costs its own rows, not the file.
        console.warn(`[preview] embedding batch of ${batch.length} failed: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

