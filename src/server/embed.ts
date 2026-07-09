// OpenRouter embeddings client. ONE path for both document and query embedding
// (a mismatch would silently wreck rankings). Qwen3-embedding-8b's native dim is
// 4096; we request `dimensions` and also slice + L2-renormalize client-side so
// we always end up with an exactly-EMBED_DIM unit vector regardless of whether
// the server honors the param. HNSW caps indexed vectors at 2000 dims — 1024 is
// safe and load-bearing.
import { config } from "./config.ts";

// Embedding dimension. A CODE CONSTANT, not env-configurable: it MUST equal the
// `vector(N)` in migrations/001_init_atlas.sql and the built HNSW index. Changing
// it requires a new migration that rebuilds the column + index — not a flag.
// sync-embeddings.ts guards that the live column matches this value.
export const EMBED_DIM = 1024;

interface EmbedResponse {
  data: { embedding: number[]; index: number }[];
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
export async function embedBatch(texts: string[], signal?: AbortSignal, attempt = 0): Promise<number[][]> {
  if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY is not set");
  try {
    const res = await fetch(`${config.openrouterBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openrouterApiKey}`,
        "content-type": "application/json",
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
    return out;
  } catch (err) {
    // Aborted (caller gave up / timed out) or out of retries → stop now; don't
    // sleep+retry against a request nobody is waiting for.
    if (signal?.aborted || attempt >= 4) throw err;
    const wait = 1000 * 2 ** attempt;
    console.warn(`  embed retry ${attempt + 1} in ${wait}ms: ${(err as Error).message}`);
    await Bun.sleep(wait);
    if (signal?.aborted) throw err;
    return embedBatch(texts, signal, attempt + 1);
  }
}

export async function embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
  return (await embedBatch([text], signal))[0];
}
