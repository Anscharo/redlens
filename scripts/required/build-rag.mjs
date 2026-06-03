#!/usr/bin/env node
/**
 * Build a vector index over the Sky Atlas for semantic search.
 *
 * Reads:  public/docs.json
 * Writes: .cache/atlas-vectors/vectors.bin
 *         .cache/atlas-vectors/ids.json        (ordered UUIDs that index vectors.bin)
 *         .cache/atlas-vectors/meta.json        (model, dim, count, atlasCommit, …)
 *         .cache/atlas-vectors/text-hashes.json (uuid → sha256(embedText) for incremental builds)
 *
 * Incremental: on each run, the embed text for every node is hashed and
 * compared to the previous text-hashes.json. Only nodes whose embed text
 * changed (or that are new) are re-embedded; unchanged nodes reuse their
 * cached Float32 vectors directly. Reused vectors are already L2-normalized
 * and are copied as-is; only fresh embeddings are normalized.
 *
 * These are not part of the frontend bundle — they feed the hosted MCP
 * server's Vectorize index via redlens-mcp/sync-vectors.mjs.
 *
 * Embedder (auto-selected):
 *   CI:    CLOUDFLARE_API_TOKEN set → Workers AI @cf/baai/bge-base-en-v1.5
 *   Local: no token               → @huggingface/transformers Xenova/bge-base-en-v1.5
 *          (CoreML on Apple Silicon, CPU elsewhere)
 * Both use the same BAAI/bge-base-en-v1.5 weights; vectors are compatible.
 * Override with RAG_EMBEDDER=workersai|transformers.
 *
 * Embed text: title + content only. No doc_no or ancestry — those change on
 * atlas renumbering and would invalidate vectors without semantic change.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DOCS_PATH = resolve(ROOT, "public/docs.json");
const OUT_DIR   = resolve(ROOT, ".cache/atlas-vectors");

const HASHES_PATH  = resolve(OUT_DIR, "text-hashes.json");
const IDS_PATH     = resolve(OUT_DIR, "ids.json");
const VECTORS_PATH = resolve(OUT_DIR, "vectors.bin");

const DIM       = 768;
const MAX_CHARS = Number(process.env.RAG_MAX_CHARS ?? 2048);

// ── Backend selection ──────────────────────────────────────────────────────
const TOKEN   = process.env.CLOUDFLARE_API_TOKEN;
const BACKEND = process.env.RAG_EMBEDDER ?? (TOKEN ? "workersai" : "transformers");
const BATCH   = Number(process.env.RAG_BATCH ?? (BACKEND === "workersai" ? 96 : 32));

// ── Workers AI backend ─────────────────────────────────────────────────────
const WA_MODEL = "@cf/baai/bge-base-en-v1.5";
const WRANGLER_JSONC = resolve(ROOT, "redlens-mcp/wrangler.jsonc");

function readAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  if (existsSync(WRANGLER_JSONC)) {
    const m = readFileSync(WRANGLER_JSONC, "utf8").match(/"account_id"\s*:\s*"([0-9a-f]+)"/);
    if (m) return m[1];
  }
  throw new Error("CLOUDFLARE_ACCOUNT_ID required (or set account_id in redlens-mcp/wrangler.jsonc)");
}

async function embedBatchWorkersAI(inputs, attempt = 0) {
  const accountId = readAccountId();
  const endpoint  = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${WA_MODEL}`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ text: inputs }),
    });
    if (!res.ok) throw new Error(`workers-ai ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
    const j = await res.json();
    if (!j.success) throw new Error(`workers-ai error: ${JSON.stringify(j.errors).slice(0, 400)}`);
    const data = j.result?.data;
    if (!Array.isArray(data) || data.length !== inputs.length)
      throw new Error(`embed count mismatch: got ${data?.length}, expected ${inputs.length}`);
    return data;
  } catch (err) {
    if (attempt >= 4) throw err;
    const wait = 1000 * 2 ** attempt;
    console.warn(`  retry ${attempt + 1} in ${wait}ms: ${err.message}`);
    await new Promise((r) => setTimeout(r, wait));
    return embedBatchWorkersAI(inputs, attempt + 1);
  }
}

// ── Transformers.js backend ────────────────────────────────────────────────
const TF_MODEL = "Xenova/bge-base-en-v1.5";
const isAppleSilicon = process.platform === "darwin" && process.arch === "arm64";
const DEVICE = process.env.RAG_DEVICE ?? (isAppleSilicon ? "coreml" : "cpu");

let _embedder = null;
async function embedBatchTransformers(inputs) {
  if (!_embedder) {
    const { pipeline } = await import("@huggingface/transformers");
    console.log(`  loading model ${TF_MODEL} on ${DEVICE}…`);
    _embedder = await pipeline("feature-extraction", TF_MODEL, { device: DEVICE, dtype: "fp32" });
  }
  const output = await _embedder(inputs, { pooling: "mean", normalize: false });
  const data = output.tolist();
  if (data.length !== inputs.length)
    throw new Error(`embed count mismatch: got ${data.length}, expected ${inputs.length}`);
  return data;
}

// ── Unified dispatch ───────────────────────────────────────────────────────
const MODEL    = BACKEND === "workersai" ? WA_MODEL : TF_MODEL;
const embedBatch = BACKEND === "workersai" ? embedBatchWorkersAI : embedBatchTransformers;

// ── Embed text ─────────────────────────────────────────────────────────────
function buildEmbedText(node) {
  const content = (node.content ?? "").trim();
  const text = content ? `${node.title}\n\n${content}` : node.title;
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

async function main() {
  console.log(`reading ${DOCS_PATH}`);
  const docs = JSON.parse(readFileSync(DOCS_PATH, "utf8"));
  const nodes = Object.values(docs.nodes);
  console.log(`  ${nodes.length} nodes`);

  // Stable order — sort by doc_no so vectors.bin layout is reproducible.
  nodes.sort((a, b) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true }));

  const chunks = nodes.map((n) => ({
    id: n.id,
    embedText: buildEmbedText(n),
  }));

  const truncated = chunks.filter((c) => c.embedText.length === MAX_CHARS).length;
  if (truncated > 0) console.log(`  ${truncated} chunks truncated to ${MAX_CHARS} chars`);

  // ── Load previous cache ────────────────────────────────────────────────
  let prevHashes  = {};
  let prevVectors = new Map();

  if (existsSync(HASHES_PATH) && existsSync(IDS_PATH) && existsSync(VECTORS_PATH)) {
    try {
      prevHashes = JSON.parse(readFileSync(HASHES_PATH, "utf8"));
      const prevIds = JSON.parse(readFileSync(IDS_PATH, "utf8"));
      const buf = readFileSync(VECTORS_PATH);
      const f32 = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      for (let i = 0; i < prevIds.length; i++) {
        prevVectors.set(prevIds[i], f32.subarray(i * DIM, (i + 1) * DIM));
      }
      console.log(`  ${prevIds.length} cached vectors loaded`);
    } catch (e) {
      console.warn(`  cache load failed (${e.message}) — rebuilding all vectors`);
      prevHashes  = {};
      prevVectors = new Map();
    }
  }

  // ── Classify chunks ────────────────────────────────────────────────────
  const vectors   = new Float32Array(chunks.length * DIM);
  const newHashes = {};
  const toEmbed   = [];

  for (let i = 0; i < chunks.length; i++) {
    const { id, embedText } = chunks[i];
    const hash = createHash("sha256").update(embedText).digest("hex");
    newHashes[id] = hash;

    if (prevHashes[id] === hash && prevVectors.has(id)) {
      vectors.set(prevVectors.get(id), i * DIM);
    } else {
      toEmbed.push({ idx: i, embedText });
    }
  }

  const reused = chunks.length - toEmbed.length;
  console.log(`\nembedding via ${MODEL} (${BACKEND}), batch=${BATCH}`);
  console.log(`  ${toEmbed.length} to embed, ${reused} reused from cache`);

  // ── Embed changed / new chunks ─────────────────────────────────────────
  if (toEmbed.length === 0) {
    console.log("  all vectors reused — no API calls needed");
  } else {
    const t0 = Date.now();
    for (let b = 0; b < toEmbed.length; b += BATCH) {
      const slice = toEmbed.slice(b, b + BATCH);
      const embs  = await embedBatch(slice.map((x) => x.embedText));
      for (let k = 0; k < embs.length; k++) {
        const { idx } = slice[k];
        if (embs[k].length !== DIM)
          throw new Error(`dim mismatch at idx ${idx}: got ${embs[k].length}, expected ${DIM}`);
        vectors.set(embs[k], idx * DIM);
      }
      const done = b + slice.length;
      const pct  = ((done / toEmbed.length) * 100).toFixed(1);
      const sec  = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${done}/${toEmbed.length} embedded (${pct}%) — ${sec}s`);
    }
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // L2-normalize only newly embedded vectors. Reused vectors are already
    // normalized — re-normalizing causes float drift that breaks reproducibility.
    const newIdxSet = new Set(toEmbed.map((x) => x.idx));
    for (let i = 0; i < chunks.length; i++) {
      if (!newIdxSet.has(i)) continue;
      let sum = 0;
      for (let k = 0; k < DIM; k++) sum += vectors[i * DIM + k] ** 2;
      const norm = Math.sqrt(sum);
      if (norm > 0) for (let k = 0; k < DIM; k++) vectors[i * DIM + k] /= norm;
    }
  }

  // ── atlasCommit ────────────────────────────────────────────────────────
  const atlasCommit = (() => {
    try {
      const manifest = JSON.parse(readFileSync(resolve(ROOT, "public/manifest.json"), "utf8"));
      if (manifest.atlasCommit) return manifest.atlasCommit;
    } catch {}
    try {
      return execSync("git rev-parse HEAD", {
        cwd: resolve(ROOT, "vendor/next-gen-atlas"),
        encoding: "utf8",
      }).trim();
    } catch {
      return null;
    }
  })();

  // ── Write outputs ──────────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(VECTORS_PATH, Buffer.from(vectors.buffer));
  writeFileSync(IDS_PATH, JSON.stringify(chunks.map((c) => c.id)));
  writeFileSync(
    resolve(OUT_DIR, "meta.json"),
    JSON.stringify(
      { model: MODEL, dim: DIM, count: chunks.length, normalized: true, maxChars: MAX_CHARS, atlasCommit },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(HASHES_PATH, JSON.stringify(newHashes));

  console.log(`\n  vectors.bin: ${(vectors.byteLength / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  ids.json: ${chunks.length} ids`);
  console.log(`  atlas: ${atlasCommit?.slice(0, 12) ?? "unknown"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
