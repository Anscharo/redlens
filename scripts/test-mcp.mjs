#!/usr/bin/env node
// Smoke test for the local atlas MCP server. Spawns mcp-atlas/server.mjs,
// drives it over stdio, and prints a human-readable report.
//
// Usage:  node scripts/test-mcp.mjs
// Exits 0 on success, 1 on any failure.

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = resolve(ROOT, "mcp-atlas/server.mjs");

// ── Spawn the server ──────────────────────────────────────────────────────
const proc = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
proc.stderr.on("data", (d) => process.stderr.write("\x1b[2m" + d + "\x1b[0m"));

// ── JSON-RPC framing over stdio ───────────────────────────────────────────
const pending = new Map();
let nextId = 1;
let buf = "";

proc.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve: r, reject: rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`${msg.error.code}: ${msg.error.message}`));
      else r(msg.result);
    }
  }
});

function call(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((r, rej) => {
    pending.set(id, { resolve: r, reject: rej });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error(`timeout: ${method}`));
      }
    }, 30000);
  });
}

function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

// ── Test runner ───────────────────────────────────────────────────────────
const results = [];
async function check(name, fn) {
  try {
    const out = await fn();
    results.push({ name, ok: true });
    console.log(`\x1b[32m✓\x1b[0m ${name}`);
    if (out) for (const line of out.split("\n")) console.log("    " + line);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`\x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message}`);
  }
}

function parseToolText(result) {
  const text = result?.content?.[0]?.text;
  if (!text) throw new Error("no content in tool response");
  if (result.isError) throw new Error("tool returned error: " + text);
  return JSON.parse(text);
}

// Wait for the server to finish loading before sending the first request.
await new Promise((r) => setTimeout(r, 1500));

try {
  await check("initialize", async () => {
    const r = await call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-mcp", version: "0" },
    });
    notify("notifications/initialized");
    return `server: ${r.serverInfo.name} v${r.serverInfo.version}`;
  });

  await check("tools/list", async () => {
    const r = await call("tools/list");
    const names = r.tools.map((t) => t.name);
    if (names.length !== 3) throw new Error(`expected 3 tools, got ${names.length}`);
    return `tools: ${names.join(", ")}`;
  });

  await check("atlas_search('how are facilitator disputes resolved')", async () => {
    const r = await call("tools/call", {
      name: "atlas_search",
      arguments: { query: "how are facilitator disputes resolved", k: 5 },
    });
    const data = parseToolText(r);
    if (data.results.length === 0) throw new Error("no results");
    return data.results
      .map((x) => `${x.score.toFixed(3)}  ${x.doc_no.padEnd(28)} ${x.title}`)
      .join("\n");
  });

  await check("atlas_search with type filter (Annotation)", async () => {
    const r = await call("tools/call", {
      name: "atlas_search",
      arguments: { query: "governance attack", k: 3, type: "Annotation" },
    });
    const data = parseToolText(r);
    if (data.results.some((x) => x.type !== "Annotation")) {
      throw new Error("type filter not honored");
    }
    return data.results
      .map((x) => `${x.score.toFixed(3)}  ${x.doc_no.padEnd(28)} ${x.title}`)
      .join("\n");
  });

  await check("atlas_get('A.0.1.1.1')", async () => {
    const r = await call("tools/call", {
      name: "atlas_get",
      arguments: { id: "A.0.1.1.1" },
    });
    const data = parseToolText(r);
    if (data.doc_no !== "A.0.1.1.1") throw new Error(`wrong doc_no: ${data.doc_no}`);
    if (!data.content) throw new Error("no content");
    return `${data.doc_no} ${data.title} [${data.type}] · ${data.content.length} chars`;
  });

  await check("atlas_get by UUID", async () => {
    // First find a uuid to fetch via search.
    const s = await call("tools/call", {
      name: "atlas_search",
      arguments: { query: "universal alignment", k: 1 },
    });
    const top = parseToolText(s).results[0];
    const r = await call("tools/call", {
      name: "atlas_get",
      arguments: { id: top.id },
    });
    const data = parseToolText(r);
    if (data.id !== top.id) throw new Error(`wrong id: ${data.id} vs ${top.id}`);
    return `${data.doc_no} ${data.title} (resolved by UUID)`;
  });

  await check("atlas_neighbors('A.1.1', window=4)", async () => {
    const r = await call("tools/call", {
      name: "atlas_neighbors",
      arguments: { id: "A.1.1", window: 4 },
    });
    const data = parseToolText(r);
    return [
      `target:   ${data.target.doc_no} ${data.target.title}`,
      `parent:   ${data.parent?.doc_no ?? "(none)"}`,
      `above:    [${data.above.map((n) => n.doc_no).join(", ")}]`,
      `below:    [${data.below.map((n) => n.doc_no).join(", ")}]`,
      `children: [${data.children.map((n) => n.doc_no).join(", ")}]`,
    ].join("\n");
  });

  await check("atlas_get('does-not-exist') returns error", async () => {
    const r = await call("tools/call", {
      name: "atlas_get",
      arguments: { id: "does-not-exist" },
    });
    if (!r.isError) throw new Error("expected isError=true");
    return "got expected error";
  });
} finally {
  proc.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
