#!/usr/bin/env node
// Build a local vector index over the Sky Atlas for RAG.
//
// Reads:  public/docs.json
// Writes: .cache/atlas-rag/{vectors.bin, chunks.json, meta.json}
//
// Strategy: one chunk per atlas node. Each chunk's embed text is augmented
// with hierarchy context (parent chain) so that tiny one-line nodes — which
// are 31% of the corpus — still have enough semantics to be retrievable.
//
// Embeddings via local Ollama (default model: nomic-embed-text, 768 dim).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_PATH = resolve(ROOT, "public/docs.json");
const OUT_DIR = resolve(ROOT, ".cache/atlas-rag");

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.RAG_MODEL ?? "nomic-embed-text";
const BATCH = Number(process.env.RAG_BATCH ?? 64);
// nomic-embed-text in Ollama (0.20.x) has a hard 2048-token limit. Both the
// `options.num_ctx` request override and `PARAMETER num_ctx` in a Modelfile
// are silently ignored — verified empirically. We must truncate inputs.
//
// Worst chars/token ratio observed in this corpus is ~2.68 (code-heavy nodes).
// 2048 × 2.68 ≈ 5488, so 5000 chars is a safe cap with headroom. At this cap,
// only 3 nodes get truncated; all are large data tables/lists where the head
// is representative of the whole.
const MAX_CHARS = Number(process.env.RAG_MAX_CHARS ?? 5000);

// ── Build embed text for one node ─────────────────────────────────────────
// Includes the node's own header line plus a parent chain (up to 3 levels)
// so that retrieval has enough context to disambiguate short nodes.
function buildEmbedText(node, docs) {
  const header = `${node.doc_no} - ${node.title} [${node.type}]`;

  const chain = [];
  let cur = node.parentId ? docs[node.parentId] : null;
  let hops = 0;
  while (cur && hops < 3) {
    chain.push(`${cur.doc_no} - ${cur.title} [${cur.type}]`);
    cur = cur.parentId ? docs[cur.parentId] : null;
    hops++;
  }

  const ancestry = chain.length > 0 ? `in: ${chain.join(" ← ")}` : "";
  const content = (node.content ?? "").trim();

  const text = [header, ancestry, "", content].filter(Boolean).join("\n").trim();
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

// ── Ollama batch embed ────────────────────────────────────────────────────
async function embedBatch(inputs) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const j = await res.json();
  if (!Array.isArray(j.embeddings) || j.embeddings.length !== inputs.length) {
    throw new Error(`embed count mismatch: got ${j.embeddings?.length}, expected ${inputs.length}`);
  }
  return j.embeddings;
}

async function embedBatchWithRetry(inputs, attempt = 0) {
  try {
    return await embedBatch(inputs);
  } catch (err) {
    if (attempt >= 3) {
      const longest = inputs.reduce((a, b) => (b.length > a.length ? b : a), "");
      console.error(`  failed batch of ${inputs.length}, max input ${longest.length} chars`);
      console.error(`  longest input starts with: ${longest.slice(0, 200)}`);
      throw err;
    }
    const wait = 500 * Math.pow(2, attempt);
    console.warn(`  retry ${attempt + 1} after ${wait}ms: ${err.message}`);
    await new Promise((r) => setTimeout(r, wait));
    return embedBatchWithRetry(inputs, attempt + 1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`reading ${DOCS_PATH}`);
  const docs = JSON.parse(readFileSync(DOCS_PATH, "utf8"));
  const nodes = Object.values(docs);
  console.log(`  ${nodes.length} nodes`);

  // Stable order — sort by doc_no so vectors.bin is reproducible across runs.
  nodes.sort((a, b) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true }));

  // Build embed texts and metadata up front.
  const chunks = nodes.map((n) => {
    const parent = n.parentId ? docs[n.parentId] : null;
    return {
      id: n.id,
      doc_no: n.doc_no,
      title: n.title,
      type: n.type,
      depth: n.depth,
      parentId: n.parentId,
      parentDocNo: parent?.doc_no ?? null,
      parentTitle: parent?.title ?? null,
      embedText: buildEmbedText(n, docs),
    };
  });

  const truncated = chunks.filter((c) => c.embedText.length === MAX_CHARS).length;
  if (truncated > 0) console.log(`  ${truncated} chunks truncated to ${MAX_CHARS} chars`);

  console.log(`embedding via ${MODEL} @ ${OLLAMA_URL}, batch=${BATCH}`);

  // Probe dimension with a single call.
  const probe = await embedBatchWithRetry([chunks[0].embedText]);
  const DIM = probe[0].length;
  console.log(`  dimension: ${DIM}`);

  // Allocate one big Float32Array for all vectors.
  const vectors = new Float32Array(chunks.length * DIM);
  // Stash the probe result we already paid for.
  vectors.set(probe[0], 0);

  const t0 = Date.now();
  let done = 1;
  for (let i = 1; i < chunks.length; i += BATCH) {
    const end = Math.min(i + BATCH, chunks.length);
    const batch = chunks.slice(i, end).map((c) => c.embedText);
    const embs = await embedBatchWithRetry(batch);
    for (let k = 0; k < embs.length; k++) {
      if (embs[k].length !== DIM) {
        throw new Error(`dim mismatch at chunk ${i + k}: got ${embs[k].length}, expected ${DIM}`);
      }
      vectors.set(embs[k], (i + k) * DIM);
    }
    done += embs.length;
    if (done % (BATCH * 8) < BATCH || done === chunks.length) {
      const pct = ((done / chunks.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const rate = (done / ((Date.now() - t0) / 1000)).toFixed(1);
      console.log(`  ${done}/${chunks.length} (${pct}%) — ${elapsed}s — ${rate}/s`);
    }
  }

  // L2-normalize each vector so retrieval can use a single dot product
  // instead of cosine similarity at query time.
  for (let i = 0; i < chunks.length; i++) {
    let sum = 0;
    for (let k = 0; k < DIM; k++) sum += vectors[i * DIM + k] ** 2;
    const norm = Math.sqrt(sum);
    if (norm > 0) {
      for (let k = 0; k < DIM; k++) vectors[i * DIM + k] /= norm;
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "vectors.bin"), Buffer.from(vectors.buffer));
  writeFileSync(resolve(OUT_DIR, "chunks.json"), JSON.stringify(chunks));
  writeFileSync(
    resolve(OUT_DIR, "meta.json"),
    JSON.stringify(
      {
        model: MODEL,
        dim: DIM,
        count: chunks.length,
        normalized: true,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`done in ${totalSec}s`);
  console.log(`  vectors.bin: ${(vectors.byteLength / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  chunks.json: ${chunks.length} chunks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
