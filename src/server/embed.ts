// OpenRouter embeddings client. ONE path for both document and query embedding
// (a mismatch would silently wreck rankings). Qwen3-embedding-8b's native dim is
// 4096; we request `dimensions` and also slice + L2-renormalize client-side so
// we always end up with an exactly-embedDim unit vector regardless of whether
// the server honors the param. HNSW caps indexed vectors at 2000 dims — 1024 is
// safe and load-bearing.
import { config } from "./config.ts";

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

export async function embedBatch(texts: string[], attempt = 0): Promise<number[][]> {
  if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY is not set");
  try {
    const res = await fetch(`${config.openrouterBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openrouterApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: config.embedModel, input: texts, dimensions: config.embedDim }),
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
    for (const d of json.data) out[d.index] = sliceNormalize(d.embedding, config.embedDim);
    return out;
  } catch (err) {
    if (attempt >= 4) throw err;
    const wait = 1000 * 2 ** attempt;
    console.warn(`  embed retry ${attempt + 1} in ${wait}ms: ${(err as Error).message}`);
    await Bun.sleep(wait);
    return embedBatch(texts, attempt + 1);
  }
}

export async function embedQuery(text: string): Promise<number[]> {
  return (await embedBatch([text]))[0];
}
