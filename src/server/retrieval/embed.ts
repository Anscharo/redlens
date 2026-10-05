// OpenRouter embeddings client. ONE path for both document and query embedding
// (a mismatch would silently wreck rankings). Qwen3-embedding-8b's native dim is
// 4096; we request `dimensions` and also slice + L2-renormalize client-side so
// we always end up with an exactly-EMBED_DIM unit vector regardless of whether
// the server honors the param. HNSW caps indexed vectors at 2000 dims — 1024 is
// safe and load-bearing.
import { config } from "../config.ts";
import { captureAiCall } from "../ai-telemetry.ts";
import { openrouterAttributionHeaders } from "../openrouter-attribution.ts";

// Embedding dimension. A CODE CONSTANT, not env-configurable: it MUST equal the
// `vector(N)` in migrations/001_init_atlas.sql and the built HNSW index. Changing
// it requires a new migration that rebuilds the column + index — not a flag.
// sync-embeddings.ts guards that the live column matches this value.
export const EMBED_DIM = 1024;

interface EmbedResponse {
  data: { embedding: number[]; index: number }[];
  usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number };
}

function sliceNormalize(vec: number[], dim: number): number[] {
  const v = vec.length > dim ? vec.slice(0, dim) : vec;
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

// `signal` lets a caller cancel the request AND its retry loop (the query path
// races it against a timeout — see search.ts). Without it a timed-out embed
// would keep fetching/retrying against OpenRouter in the background for ~15s.
/**
 * Somewhere to record what the provider ACTUALLY said, so a caller racing this
 * against a deadline can report the cause instead of the stopwatch.
 *
 * The retry schedule sleeps 1+2+4+8 = 15s, which outlives every caller's
 * budget (`semanticEmbedTimeoutMs` is 10s). So a plain 403, 429 or 500 fails on
 * the first attempt, disappears into the backoff, and the timeout fires first —
 * the caller's `Promise.race` settles on "timed out" and the real error is
 * discarded with the abandoned promise. That made "embed timed out after
 * 10000ms" the one message the UI could show and the one least likely to be
 * true. Recorded here, it survives the race.
 */
export interface EmbedDiag {
  /** The last error the provider itself returned, across all attempts. */
  lastError?: string;
}

// `surface` is only the PostHog label (embed-query from embedQuery, else the
// generic embed-batch) so query-time and sync-time embedding spend separate.
export async function embedBatch(
  texts: string[],
  signal?: AbortSignal,
  attempt = 0,
  diag?: EmbedDiag,
  surface = "embed-batch",
): Promise<number[][]> {
  if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const t0 = Date.now();
  try {
    const res = await fetch(`${config.openrouterBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openrouterApiKey}`,
        "content-type": "application/json",
        ...openrouterAttributionHeaders(),
      },
      body: JSON.stringify({ model: config.embedModel, input: texts, dimensions: EMBED_DIM }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`embeddings ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    }
    const json = (await res.json()) as EmbedResponse;
    if (!Array.isArray(json.data) || json.data.length !== texts.length) {
      throw new Error(`embed count mismatch: got ${json.data?.length}, want ${texts.length}`);
    }
    // Map by the response `index` field, not array position.
    const out = new Array<number[]>(texts.length);
    for (const d of json.data) out[d.index] = sliceNormalize(d.embedding, EMBED_DIM);
    captureAiCall({
      kind: "embedding",
      surface,
      model: config.embedModel,
      inputTokens: json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0,
      costUsd: json.usage?.cost,
      latencyMs: Date.now() - t0,
    });
    return out;
  } catch (err) {
    // Recorded BEFORE the give-up checks, so the cause survives however this
    // attempt ends — including the abort a racing timeout triggers.
    if (diag) diag.lastError = (err as Error).message;
    // Aborted (caller gave up / timed out) or out of retries → stop now; don't
    // sleep+retry against a request nobody is waiting for.
    if (signal?.aborted || attempt >= 4) throw err;
    const wait = 1000 * 2 ** attempt;
    console.warn(`  embed retry ${attempt + 1} in ${wait}ms: ${(err as Error).message}`);
    await Bun.sleep(wait);
    if (signal?.aborted) throw err;
    return embedBatch(texts, signal, attempt + 1, diag, surface);
  }
}

// In-process LRU of query-string → embedding. Only the single-query path uses
// it (embedQuery); doc batches are already cached in Postgres by content_hash.
// A Map preserves insertion order, so the oldest key is always first — we delete
// on hit and re-insert to bump recency, and evict the head when over capacity.
// Keyed on model+dim+text so a config swap (different model or an EMBED_DIM
// change) can't return a stale vector for the new regime.
const queryEmbedCache = new Map<string, number[]>();

function cacheKey(text: string): string {
  return `${config.embedModel}:${EMBED_DIM}:${text}`;
}

// Exposed for tests (assert cache behavior without hitting the network).
export function _clearQueryEmbedCache(): void {
  queryEmbedCache.clear();
}

/**
 * Embed a QUERY — the asymmetric half of the pair.
 *
 * `config.embedQueryPrefix` is applied here and NOWHERE else: documents are
 * embedded raw by sync-embeddings.ts, which is exactly what an instruct-tuned
 * embedding model asks for. Applying it to documents too would collapse the
 * asymmetry the model was trained with.
 *
 * The prefix is part of the cache key (via cacheKey → config.embedModel is
 * already there, and the prefixed text is what gets hashed), so flipping
 * EMBED_QUERY_PREFIX cannot serve a vector embedded under the other setting.
 */
/**
 * Embed SEVERAL queries in one round trip, cache included.
 *
 * The cost of an embed here is the round trip, not the payload: two texts in one
 * call measure the same ~2.3s p50 as one. So anything that needs a second query
 * vector asks for it HERE, alongside the first, rather than in its own call —
 * see `runSemantic`, which takes the residual its leaf attribution scores
 * members against this way instead of paying a second 2.3s for it.
 *
 * Per-text LRU semantics are preserved: cached texts are served without touching
 * the network, and only the misses go into the batch.
 */
export async function embedQueries(texts: string[], signal?: AbortSignal, diag?: EmbedDiag): Promise<number[][]> {
  const out = new Array<number[] | undefined>(texts.length);
  const missIndexes: number[] = [];
  const cap = config.queryEmbedCacheSize;
  texts.forEach((t, i) => {
    const key = cacheKey(config.embedQueryPrefix + t);
    const hit = cap > 0 ? queryEmbedCache.get(key) : undefined;
    if (hit) {
      queryEmbedCache.delete(key);
      queryEmbedCache.set(key, hit); // bump recency, like embedQuery
      out[i] = hit;
    } else missIndexes.push(i);
  });
  if (missIndexes.length > 0) {
    const vecs = await embedBatch(
      missIndexes.map((i) => config.embedQueryPrefix + texts[i]!),
      signal,
      0,
      diag,
      "embed-query",
    );
    missIndexes.forEach((i, j) => {
      const v = vecs[j]!;
      out[i] = v;
      if (cap > 0) {
        queryEmbedCache.set(cacheKey(config.embedQueryPrefix + texts[i]!), v);
        while (queryEmbedCache.size > cap) {
          const oldest = queryEmbedCache.keys().next().value;
          if (oldest === undefined) break;
          queryEmbedCache.delete(oldest);
        }
      }
    });
  }
  return out as number[][];
}

export async function embedQuery(text: string, signal?: AbortSignal, diag?: EmbedDiag): Promise<number[]> {
  const prefixed = config.embedQueryPrefix + text;
  const cap = config.queryEmbedCacheSize;
  if (cap <= 0) return (await embedBatch([prefixed], signal, 0, diag, "embed-query"))[0];

  const key = cacheKey(prefixed);
  const hit = queryEmbedCache.get(key);
  if (hit) {
    // Bump recency: delete + re-insert moves it to the tail.
    queryEmbedCache.delete(key);
    queryEmbedCache.set(key, hit);
    return hit;
  }

  const vec = (await embedBatch([prefixed], signal, 0, diag, "embed-query"))[0];
  queryEmbedCache.set(key, vec);
  // Evict least-recently-used entries (Map iteration is insertion order).
  while (queryEmbedCache.size > cap) {
    const oldest = queryEmbedCache.keys().next().value;
    if (oldest === undefined) break;
    queryEmbedCache.delete(oldest);
  }
  return vec;
}
