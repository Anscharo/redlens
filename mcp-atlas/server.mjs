#!/usr/bin/env node
// Local MCP server exposing the Sky Atlas as queryable tools.
//
// Tools:
//   atlas_search(query, k?, type?)   semantic vector search over the atlas
//   atlas_get(id)                     fetch one node by UUID or doc_no
//   atlas_neighbors(id, window?)      parent + siblings ±N + children
//
// Transport: stdio, line-delimited JSON-RPC 2.0 (the MCP stdio convention).
// stdout is reserved for protocol messages — all logs go to stderr.
//
// Wired up via .mcp.json at the repo root.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAG_DIR = resolve(ROOT, ".cache/atlas-rag");
const DOCS_PATH = resolve(ROOT, "public/docs.json");
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

// ── Logging ───────────────────────────────────────────────────────────────
const log = (...args) => process.stderr.write("[mcp-atlas] " + args.join(" ") + "\n");

// ── Load atlas + RAG index ────────────────────────────────────────────────
log("loading docs.json…");
const docs = JSON.parse(readFileSync(DOCS_PATH, "utf8"));
log(`  ${Object.keys(docs).length} nodes`);

log("loading vector index…");
const meta = JSON.parse(readFileSync(resolve(RAG_DIR, "meta.json"), "utf8"));
const chunks = JSON.parse(readFileSync(resolve(RAG_DIR, "chunks.json"), "utf8"));
const vbuf = readFileSync(resolve(RAG_DIR, "vectors.bin"));
const vectors = new Float32Array(vbuf.buffer, vbuf.byteOffset, vbuf.byteLength / 4);
log(`  ${chunks.length} chunks · ${meta.dim}d · model=${meta.model}`);

// Indices for fast lookup
const byDocNo = new Map();
const byParent = new Map();
for (const node of Object.values(docs)) {
  byDocNo.set(node.doc_no, node);
  const key = node.parentId;
  let bucket = byParent.get(key);
  if (!bucket) { bucket = []; byParent.set(key, bucket); }
  bucket.push(node);
}
for (const bucket of byParent.values()) bucket.sort((a, b) => a.order - b.order);

// Map chunk index → atlas node id (chunks are emitted in doc_no sort order)
// so we can resolve hits back to the source node.

// ── Resolve id (UUID or doc_no) → node ────────────────────────────────────
function resolveNode(id) {
  if (!id) return null;
  return docs[id] ?? byDocNo.get(id) ?? null;
}

// ── Project a node to a serializable shape for tool output ────────────────
function projectNode(node, { includeContent = true } = {}) {
  if (!node) return null;
  const parent = node.parentId ? docs[node.parentId] : null;
  const out = {
    id: node.id,
    doc_no: node.doc_no,
    title: node.title,
    type: node.type,
    depth: node.depth,
    parent_doc_no: parent?.doc_no ?? null,
    parent_title: parent?.title ?? null,
  };
  if (includeContent) out.content = (node.content ?? "").trim();
  if (node.addressRefs?.length) out.address_refs = node.addressRefs;
  return out;
}

// ── Embed query via Ollama ────────────────────────────────────────────────
async function embedQuery(q) {
  const r = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: meta.model, input: q }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const v = j.embeddings[0];
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

// ── Brute-force top-k cosine over normalized vectors ──────────────────────
function searchVectors(qv, k, typeFilter) {
  const DIM = meta.dim;
  const scores = new Float32Array(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    if (typeFilter && chunks[i].type !== typeFilter) {
      scores[i] = -Infinity;
      continue;
    }
    let dot = 0;
    const off = i * DIM;
    for (let j = 0; j < DIM; j++) dot += qv[j] * vectors[off + j];
    scores[i] = dot;
  }
  const order = Array.from({ length: chunks.length }, (_, i) => i);
  order.sort((a, b) => scores[b] - scores[a]);
  return order.slice(0, k).map((idx) => ({ idx, score: scores[idx] }));
}

// ── Tool implementations ──────────────────────────────────────────────────
async function toolAtlasSearch({ query, k = 10, type } = {}) {
  if (!query || typeof query !== "string") throw new Error("query (string) is required");
  if (k < 1 || k > 50) throw new Error("k must be between 1 and 50");

  const qv = await embedQuery(query);
  const hits = searchVectors(qv, k, type);

  const results = hits
    .filter((h) => h.score > -Infinity)
    .map((h) => {
      const chunk = chunks[h.idx];
      const node = docs[chunk.id];
      const content = (node?.content ?? "").trim();
      return {
        score: Number(h.score.toFixed(4)),
        id: chunk.id,
        doc_no: chunk.doc_no,
        title: chunk.title,
        type: chunk.type,
        parent_doc_no: chunk.parentDocNo,
        parent_title: chunk.parentTitle,
        snippet: content.length > 400 ? content.slice(0, 400) + "…" : content,
      };
    });

  return { query, count: results.length, results };
}

function toolAtlasGet({ id } = {}) {
  if (!id) throw new Error("id (UUID or doc_no) is required");
  const node = resolveNode(id);
  if (!node) throw new Error(`node not found: ${id}`);
  return projectNode(node);
}

function toolAtlasNeighbors({ id, window = 8 } = {}) {
  if (!id) throw new Error("id (UUID or doc_no) is required");
  if (window < 0 || window > 32) throw new Error("window must be between 0 and 32");

  const target = resolveNode(id);
  if (!target) throw new Error(`node not found: ${id}`);

  const parent = target.parentId ? docs[target.parentId] : null;
  const siblings = byParent.get(target.parentId) ?? [];
  const idx = siblings.indexOf(target);
  const above = idx > 0 ? siblings.slice(Math.max(0, idx - window), idx) : [];
  const below = idx >= 0 ? siblings.slice(idx + 1, idx + 1 + window) : [];
  const children = (byParent.get(target.id) ?? []).slice(0, window);

  return {
    target: projectNode(target),
    parent: projectNode(parent, { includeContent: false }),
    above: above.map((n) => projectNode(n, { includeContent: false })),
    below: below.map((n) => projectNode(n, { includeContent: false })),
    children: children.map((n) => projectNode(n, { includeContent: false })),
  };
}

// ── Tool registry ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "atlas_search",
    description:
      "Semantic search over the Sky Atlas (9,825 nodes). Returns the top-k most relevant nodes for a natural-language query, ranked by vector similarity. Each result includes the node's doc number, title, type, parent context, and a content snippet. Use this to find atlas content by meaning rather than exact keywords.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language query." },
        k: { type: "integer", description: "Number of results to return (1-50, default 10).", default: 10 },
        type: {
          type: "string",
          description:
            "Optional Atlas document type filter. One of: Scope, Article, Section, Core, Type Specification, Active Data Controller, Annotation, Action Tenet, Scenario, Scenario Variation, Active Data, Needed Research.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "atlas_get",
    description:
      "Fetch a single Atlas node by UUID or document number (e.g. 'A.1.2.3'). Returns the node's full content, type, depth, and parent context. Use this when you have a specific node id from a search result or another tool.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Node UUID or doc number (e.g. 'A.1.2.3')." },
      },
      required: ["id"],
    },
  },
  {
    name: "atlas_neighbors",
    description:
      "Return the bounded hierarchical context around a node: its parent, the N preceding and following siblings, and its direct children. Use this to explore the structure around a search hit (e.g. to see what other nodes belong to the same section).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Node UUID or doc number." },
        window: {
          type: "integer",
          description: "How many siblings above/below and children to include (0-32, default 8).",
          default: 8,
        },
      },
      required: ["id"],
    },
  },
];

const HANDLERS = {
  atlas_search: toolAtlasSearch,
  atlas_get: toolAtlasGet,
  atlas_neighbors: toolAtlasNeighbors,
};

// ── JSON-RPC over stdio ───────────────────────────────────────────────────
const PROTOCOL_VERSION = "2024-11-05";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
}

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "atlas-rag", version: "0.1.0" },
    });
    return;
  }

  if (method === "initialized" || method === "notifications/initialized") {
    // Notification — no response.
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params ?? {};
    const handler = HANDLERS[name];
    if (!handler) {
      sendError(id, -32601, `unknown tool: ${name}`);
      return;
    }
    try {
      const result = await handler(args ?? {});
      sendResult(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      log(`tool ${name} error: ${err.message}`);
      sendResult(id, {
        content: [{ type: "text", text: `error: ${err.message}` }],
        isError: true,
      });
    }
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  sendError(id, -32601, `method not found: ${method}`);
}

// ── Main loop ─────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (err) {
    log(`parse error: ${err.message}`);
    return;
  }
  // Notifications have no id; ignore the response from those.
  Promise.resolve(handleRequest(req)).catch((err) => {
    log(`handler error: ${err.message}`);
    if (req.id != null) sendError(req.id, -32603, err.message);
  });
});

rl.on("close", () => process.exit(0));

log("ready");
