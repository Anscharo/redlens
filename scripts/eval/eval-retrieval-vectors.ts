// Embedding backends and the vector cache for eval-retrieval.ts. Module state lives
// in `vectorState` because an imported `let` cannot be reassigned by its importer.
import fs from "node:fs";
import path from "node:path";
import { config } from "../../src/server/config.ts";
import { embedBatch, embedQuery } from "../../src/server/retrieval/embed.ts";
import { unitHash } from "../../src/server/retrieval/embed-units.ts";
import { openVectorCache, type VectorCache } from "./eval-vector-cache.ts";
import { BACKEND, DOC_PREFIX, LOCAL, MODELS, OFFLINE, OLLAMA_HOST, ROOT } from "./eval-retrieval-flags.ts";

// Every neural embed goes through .cache/eval-vectors.{bin,idx.json}, keyed
// `${model}\0${sha256 of the exact text sent}`. Lookup order: the persistent
// cache, then --reuse-db's DB rows (copied into the cache on use, so a later
// --offline run needs no database), then the network. The in-memory cache also
// embeds an unchanged text once per run.
export const vectorState: { vecCache: VectorCache | null; cachedVectors: Map<string, number[]> | null; offlineMissing: number } = {
  vecCache: null,
  cachedVectors: null,
  offlineMissing: 0,
};
// The document prefix is part of the key: the same model embeds the same text to a
// different vector under a different prefix.
const vecKey = (model: string, hash: string) => `${model}${DOC_PREFIX ? `\u0001${DOC_PREFIX}` : ""}\u0000${hash}`;

function parseVecLiteral(s: string): number[] {
  return s.replace(/^\[|\]$/g, "").split(",").map(Number);
}

// Read-only: pull embeddings from DATABASE_URL keyed by content_hash. A unit
// whose embed TEXT is byte-identical to an already-embedded doc (same
// content_hash) reuses that vector instead of paying to re-embed it. For example
// the one_to_one baseline is almost fully covered by a prod/staging DB, and only
// the docs a grouping/breadcrumb policy rewrites are cache misses.
// Any change to buildEmbedText's definition invalidates the cache for the docs it
// alters: adding link-stripping took the baseline hit rate from 99.4% to 84.2%
// (1,730 one-time misses) against a DB embedded beforehand. Unchanged text still
// hits, so re-baseline once and it returns to ~99%. content_hash keys the text,
// NOT the model, so the DB must have been embedded with the SAME model as
// `--models` (mixing embedding spaces silently wrecks rankings), hence --reuse-db
// is single-model and never writes to the DB.
async function loadCachedVectors(): Promise<Map<string, number[]>> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("--reuse-db requires DATABASE_URL (a read-only embedding cache)");
  const { SQL } = await import("bun");
  const sql = new SQL({ url, max: 2 });
  const out = new Map<string, number[]>();
  try {
    // Only vectors the requested model made. A row with no marker predates
    // migration 038, when every vector came from qwen3-embedding-8b.
    const model = MODELS[0]!;
    const rows = (await sql`SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS embedding FROM atlas_doc_embeddings
      WHERE embed_model = ${model} OR (embed_model IS NULL AND ${model} = 'qwen/qwen3-embedding-8b')`) as {
      content_hash: string;
      embedding: string;
    }[];
    for (const r of rows) out.set(r.content_hash, parseVecLiteral(r.embedding));
  } finally {
    await sql.end();
  }
  return out;
}

// Opens the persistent cache for the chosen backend.
export function openVectorSources(): void {
  if (BACKEND === "openrouter") vectorState.vecCache = openVectorCache();
  if (LOCAL) {
    // One cache per local model: their dimensions differ (ternlight 384, nomic 768)
    // and a cache file holds one dimension.
    const dir = path.join(ROOT, ".cache", "eval-local", `${BACKEND}-${MODELS.join("+").replace(/[^\w.+-]/g, "_")}`);
    fs.mkdirSync(dir, { recursive: true });
    vectorState.vecCache = openVectorCache(dir);
  }
}

// --reuse-db: load the DB's vectors, keyed by content_hash, as a read-only cache.
export async function loadReuseDb(): Promise<void> {
  if (BACKEND !== "openrouter") {
    console.error("--reuse-db reuses neural vectors; pass --backend openrouter.");
    process.exit(1);
  }
  if (MODELS.length !== 1) {
    console.error("--reuse-db is single-model (the DB was embedded with one model); pass exactly one --models value matching it.");
    process.exit(1);
  }
  console.log(`loading cached embeddings from DATABASE_URL (read-only) — must be embedded with ${MODELS[0]}…`);
  vectorState.cachedVectors = await loadCachedVectors();
  console.log(`  cache: ${vectorState.cachedVectors.size} distinct content_hashes`);
}

const normalized = (v: ArrayLike<number>): number[] => {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  const norm = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / norm);
};

// Embed on this machine. `texts` arrive with whatever prefix they need already on.
async function embedLocal(texts: string[], model: string): Promise<number[][]> {
  if (BACKEND === "ternlight") {
    const tl = await import("@ternlight/base");
    return texts.map((t) => normalized(tl.embed(t)));
  }
  const res = await fetch(`${OLLAMA_HOST}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: texts, truncate: true }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)} — is \`ollama serve\` running and \`${model}\` pulled?`);
  const json = (await res.json()) as { embeddings: number[][] };
  return json.embeddings.map(normalized);
}

export function lookupVector(model: string, hash: string): number[] | undefined {
  const key = vecKey(model, hash);
  const hit = vectorState.vecCache?.get(key);
  if (hit) return hit;
  const db = vectorState.cachedVectors?.get(hash);
  if (db) {
    vectorState.vecCache?.set(key, db);
    return db;
  }
  return undefined;
}

async function withModel<T>(model: string, fn: () => Promise<T>): Promise<T> {
  const prev = config.embedModel;
  config.embedModel = model;
  try {
    return await fn();
  } finally {
    config.embedModel = prev;
  }
}

// hash → text in, hash → vector out. Documents carry NO query prefix. Progress logs
// every batch since a big miss set is otherwise silent for minutes.
export async function resolveVectors(entries: Map<string, string>, model: string, what: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const miss: [string, string][] = [];
  for (const [hash, text] of entries) {
    const v = lookupVector(model, hash);
    if (v) out.set(hash, v);
    else miss.push([hash, text]);
  }
  if (OFFLINE) {
    vectorState.offlineMissing += miss.length;
  } else {
    for (let i = 0; i < miss.length; i += 50) {
      const slice = miss.slice(i, i + 50);
      const vecs = LOCAL
        ? await embedLocal(slice.map(([, text]) => DOC_PREFIX + text), model)
        : await withModel(model, () => embedBatch(slice.map(([, text]) => text)));
      slice.forEach(([hash], j) => {
        out.set(hash, vecs[j]!);
        vectorState.vecCache?.set(vecKey(model, hash), vecs[j]!);
      });
      console.log(`    embedded ${Math.min(i + 50, miss.length)}/${miss.length} distinct misses (${what})`);
    }
  }
  console.log(`  ${what}: reused ${entries.size - miss.length}/${entries.size}, ${OFFLINE ? "missing" : "embedded"} ${miss.length} with ${model}`);
  return out;
}

// One query vector, the prefix included in the cache key. null only when --offline
// and the vector is not cached (counted, and the run stops at the end of the arm).
export async function getQueryVector(text: string, model: string, timings: number[]): Promise<number[] | null> {
  const hash = unitHash(config.embedQueryPrefix + text);
  const hit = lookupVector(model, hash);
  if (hit) return hit;
  if (OFFLINE) {
    vectorState.offlineMissing++;
    return null;
  }
  const t0 = performance.now();
  const v = LOCAL ? (await embedLocal([config.embedQueryPrefix + text], model))[0]! : await withModel(model, () => embedQuery(text));
  timings.push(performance.now() - t0);
  vectorState.vecCache?.set(vecKey(model, hash), v);
  return v;
}

// Embed many query texts in batched requests, into the cache. getQueryVector costs
// one round trip per text (2-4 s each on OpenRouter), and an arm needs up to two
// per query: one briefing run spent 21 minutes on one arm that way. A query
// is embedded exactly as embedQuery does it (the prefix, then embedBatch), so
// these are the same vectors, 50 to a request.
export async function prefetchQueryVectors(texts: string[], model: string, what: string): Promise<void> {
  if (OFFLINE) return;
  const miss = [...new Set(texts)].filter((t) => !lookupVector(model, unitHash(config.embedQueryPrefix + t)));
  for (let i = 0; i < miss.length; i += 50) {
    const slice = miss.slice(i, i + 50).map((t) => config.embedQueryPrefix + t);
    const vecs = LOCAL ? await embedLocal(slice, model) : await withModel(model, () => embedBatch(slice));
    slice.forEach((t, j) => vectorState.vecCache?.set(vecKey(model, unitHash(t)), vecs[j]!));
  }
  if (miss.length) console.log(`  ${what}: embedded ${miss.length} in ${Math.ceil(miss.length / 50)} batched request(s)`);
}

export function failIfOfflineMissing(): void {
  if (vectorState.offlineMissing === 0) return;
  console.error(`--offline: ${vectorState.offlineMissing} vector(s) needed by this run are not in the vector cache. Run once without --offline (with an API key, or --reuse-db) to fill it.`);
  process.exit(1);
}
