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
import { sql } from "../db.ts";
import { config } from "../config.ts";
import { embedBatch, EMBED_DIM } from "../retrieval/embed.ts";
import { planEmbedRows, shippedPolicy } from "../retrieval/embed-rows.ts";
import { buildEmbedText, contentHash } from "../retrieval/embed-text.ts";
import type { AtlasNode } from "../../types.ts";
import { wantsSimilarity, type BodySimilarity } from "./identity.ts";
import type { Snapshot, SnapshotDoc } from "./snapshot.ts";

export const EMBEDDINGS_FILE = "embeddings.json";
// A preview that shares no text with the live atlas would embed all of it.
// Past this many texts the rest are left out, nearest the top of the atlas
// first; search on that preview is then partial, and the file says by how much.
export const MAX_TEXTS = 2000;
// The whole lane, lookups included. A preview build has five minutes in all.
export const BUDGET_MS = 60_000;
// The identity gate's own lookups, per reference snapshot. They run after the
// budget above has ended, on the build's critical path, and the provider
// client has no timeout of its own.
export const SIMILARITY_BUDGET_MS = 20_000;
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
function deadline(ms: number, outer?: AbortSignal): { abort: AbortController; timer: ReturnType<typeof setTimeout> } {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  if (outer?.aborted) abort.abort();
  else outer?.addEventListener("abort", () => abort.abort(), { once: true });
  return { abort, timer };
}

/** Vectors for texts by hash: memory, then the live store, then the provider. */
async function resolve(texts: Map<string, string>, pv: Pick<PreviewVectors, "byHash" | "deps">, signal: AbortSignal, max = Infinity): Promise<void> {
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

/**
 * Embed what the preview changed and write <outDir>/embeddings.json. Resolves
 * to null — and writes nothing — when no vectors could be made. `outDir` must
 * already hold the preview's docs.json. `outer` is the build's own signal: a
 * build that has ended stops the lane and leaves no file.
 */
export async function buildPreviewEmbeddings(outDir: string, deps: VectorDeps = realVectorDeps, outer?: AbortSignal): Promise<PreviewVectors | null> {
  if (!deps.enabled || outer?.aborted) return null;
  const { abort, timer } = deadline(BUDGET_MS, outer);
  try {
    const nodes = Object.values(JSON.parse(fs.readFileSync(path.join(outDir, "docs.json"), "utf8")).nodes) as AtlasNode[];
    const policy = shippedPolicy();
    const { rows } = planEmbedRows(nodes, policy);
    const byId = new Map(nodes.map((n) => [n.id, n]));

    const live = await deps.liveHashes();
    const need = rows
      .filter((r) => live.get(r.id) !== r.hash)
      .sort((a, b) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true }));
    const pv: PreviewVectors = {
      byHash: new Map(),
      plain: new Set(rows.filter((r) => r.hash === contentHash(byId.get(r.id)!)).map((r) => r.id)),
      deps,
      signal: abort.signal,
    };
    await resolve(new Map(need.map((r) => [r.hash, r.text])), pv, abort.signal, MAX_TEXTS);
    if (outer?.aborted) return null;

    const out: PreviewEmbeddingsJson = {
      model: config.embedModel,
      dim: EMBED_DIM,
      policy,
      rows: need
        .filter((r) => pv.byHash.has(r.hash))
        .map((r) => ({ id: r.id, hash: r.hash, memberIds: r.memberIds, attributionOnly: r.attributionOnly, vector: encodeVector(pv.byHash.get(r.hash)!) })),
      missing: 0,
    };
    out.missing = need.length - out.rows.length;
    fs.writeFileSync(path.join(outDir, EMBEDDINGS_FILE), JSON.stringify(out));
    console.log(`[preview] embeddings: ${need.length} rows differ from the live store, ${out.rows.length} written${out.missing ? `, ${out.missing} missing` : ""}`);
    return pv;
  } catch (e) {
    console.warn(`[preview] embeddings skipped (${(e as Error).message}) — the identity gate judges by lines and words`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const embedText = (d: SnapshotDoc) => buildEmbedText({ title: d.title ?? "", content: d.content ?? "" });

function cosine(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i]; // both are unit vectors
  return d;
}

/**
 * The identity gate's similarity for one (reference, head) pair of snapshots:
 * for each retitled document the gate would judge by meaning, the cosine of
 * its old and new vector. Resolves to undefined when there is nothing to
 * score or the vectors cannot be had.
 *
 * The NEW side is a row this build already embedded. The OLD side is found in
 * the live store by content hash; a base that is behind live main holds text
 * the store has moved past, and those few documents are embedded here.
 */
export async function bodySimilarity(reference: Snapshot, head: Snapshot, pv: PreviewVectors): Promise<BodySimilarity | undefined> {
  // Its own deadline: the build lane's timer was cleared when that lane
  // returned, so pv.signal alone would let a stalled provider hold the build.
  const { abort, timer } = deadline(SIMILARITY_BUDGET_MS, pv.signal);
  try {
    const pairs: { id: string; oldHash: string; newHash: string }[] = [];
    const texts = new Map<string, string>();
    for (const [id, now] of head) {
      const was = reference.get(id);
      // A document stored as a group has no vector of its own to compare.
      if (!was || !pv.plain.has(id) || !wantsSimilarity(was, now)) continue;
      const oldText = embedText(was), newText = embedText(now);
      const pair = { id, oldHash: contentHash({ title: was.title ?? "", content: was.content ?? "" }), newHash: contentHash({ title: now.title ?? "", content: now.content ?? "" }) };
      texts.set(pair.oldHash, oldText).set(pair.newHash, newText);
      pairs.push(pair);
    }
    if (!pairs.length) return undefined;
    await resolve(texts, pv, abort.signal);
    const scores = new Map<string, number>();
    for (const p of pairs) {
      const a = pv.byHash.get(p.oldHash), b = pv.byHash.get(p.newHash);
      if (a && b) scores.set(p.id, cosine(a, b));
    }
    return scores.size ? (id) => scores.get(id) : undefined;
  } catch (e) {
    console.warn(`[preview] identity similarity skipped (${(e as Error).message})`);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
