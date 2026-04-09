#!/usr/bin/env node
// Ad-hoc query CLI for the local atlas RAG index.
//
// Usage:
//   node scripts/query-rag.mjs "your question here"
//   node scripts/query-rag.mjs -k 5 "your question"
//   node scripts/query-rag.mjs --full "your question"   # print full content
//
// Reads .cache/atlas-rag/{vectors.bin,chunks.json,meta.json} and public/docs.json.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAG_DIR = resolve(ROOT, ".cache/atlas-rag");
const DOCS_PATH = resolve(ROOT, "public/docs.json");
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

// ── Parse args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let k = 8;
let full = false;
const queryParts = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-k") k = Number(args[++i]);
  else if (args[i] === "--full") full = true;
  else queryParts.push(args[i]);
}
const query = queryParts.join(" ").trim();
if (!query) {
  console.error("usage: node scripts/query-rag.mjs [-k N] [--full] <query>");
  process.exit(1);
}

// ── Load index ────────────────────────────────────────────────────────────
const meta = JSON.parse(readFileSync(resolve(RAG_DIR, "meta.json"), "utf8"));
const chunks = JSON.parse(readFileSync(resolve(RAG_DIR, "chunks.json"), "utf8"));
const buf = readFileSync(resolve(RAG_DIR, "vectors.bin"));
const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const docs = JSON.parse(readFileSync(DOCS_PATH, "utf8"));

if (vectors.length !== chunks.length * meta.dim) {
  console.error(`vector/chunk size mismatch: ${vectors.length} vs ${chunks.length}*${meta.dim}`);
  process.exit(1);
}

// ── Embed query ───────────────────────────────────────────────────────────
async function embedQuery(q) {
  const r = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: meta.model, input: q }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const v = j.embeddings[0];
  // L2 normalize so we can use a single dot product against the (already
  // normalized) corpus vectors.
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  return v.map((x) => x / n);
}

// ── Brute-force search ────────────────────────────────────────────────────
function search(qv) {
  const DIM = meta.dim;
  const scores = new Float32Array(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    let dot = 0;
    const off = i * DIM;
    for (let j = 0; j < DIM; j++) dot += qv[j] * vectors[off + j];
    scores[i] = dot;
  }
  // Partial top-k via index sort.
  const order = Array.from({ length: chunks.length }, (_, i) => i);
  order.sort((a, b) => scores[b] - scores[a]);
  return order.slice(0, k).map((idx) => ({ idx, score: scores[idx] }));
}

// ── Run ───────────────────────────────────────────────────────────────────
const t0 = Date.now();
const qv = await embedQuery(query);
const tEmbed = Date.now() - t0;
const t1 = Date.now();
const hits = search(qv);
const tSearch = Date.now() - t1;

console.log(`query: ${query}`);
console.log(`embed: ${tEmbed}ms · search: ${tSearch}ms · ${chunks.length} chunks · top ${k}\n`);

for (const h of hits) {
  const c = chunks[h.idx];
  const node = docs[c.id];
  const content = (node?.content ?? "").trim();
  const snippet = full ? content : content.slice(0, 280) + (content.length > 280 ? "…" : "");
  console.log(`[${h.score.toFixed(3)}] ${c.doc_no} ${c.title} [${c.type}]`);
  if (c.parentDocNo) console.log(`        in: ${c.parentDocNo} ${c.parentTitle}`);
  if (snippet) {
    const indented = snippet.split("\n").map((l) => "        " + l).join("\n");
    console.log(indented);
  }
  console.log();
}
