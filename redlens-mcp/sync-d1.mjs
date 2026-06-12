#!/usr/bin/env node
/**
 * sync-d1.mjs
 *
 * Reads the already-built graph artifacts and syncs them into D1.
 * Run build-graph.mjs first so the artifacts are up to date.
 *
 * Usage (from redlens-mcp/):
 *   node sync-d1.mjs           # sync to local D1
 *   node sync-d1.mjs --remote  # sync to remote D1
 *
 * Reads:
 *   public/docs.json
 *   public/graph.json
 *   public/addresses.atlas.json
 *   public/addresses.json      (optional)
 *   public/chain-state.json
 *
 * Writes: D1 tables: docs, entities, addresses, edges
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import { slugify } from "../scripts/lib/graph-patterns.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MCP_DIR = __dirname;
const REMOTE = process.argv.includes("--remote");
const FLAG = REMOTE ? "--remote" : "--local";
const DB = "redlens-atlas";
const SCHEMA = path.join(MCP_DIR, "schema.sql");
const BATCH = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s) {
  if (s == null) return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function runFile(filePath) {
  execSync(`npx wrangler@latest d1 execute ${DB} ${FLAG} --file="${filePath}"`, {
    stdio: "inherit",
    cwd: MCP_DIR,
  });
}

async function writeBatched(filePath, tableName, cols, rows) {
  const out = fs.createWriteStream(filePath);
  let i = 0;
  for (const row of rows) {
    if (i % BATCH === 0) {
      if (i > 0) out.write(";\n");
      out.write(`INSERT OR REPLACE INTO ${tableName} (${cols.join(",")}) VALUES\n`);
    } else {
      out.write(",\n");
    }
    out.write("(" + cols.map((c) => esc(row[c])).join(",") + ")");
    i++;
  }
  if (i > 0) out.write(";\n");
  out.end();
  return new Promise((r) => out.on("finish", r));
}

// Incremental upsert: only writes rows where a content field changed.
// pkCols:         columns forming the conflict target (and excluded from SET)
// contentCols:    columns checked in the DO UPDATE WHERE clause
// conflictTarget: raw SQL expression for ON CONFLICT(...) — defaults to pkCols.join(",")
//                 use when the unique index is on an expression e.g. COALESCE(col, '')
// IS NOT is used throughout: safe for both nullable and non-nullable columns in SQLite.
async function writeUpsert(filePath, tableName, cols, pkCols, contentCols, rows, conflictTarget) {
  const setCols = cols.filter((c) => !pkCols.includes(c));
  const setClause = setCols.map((c) => `${c}=excluded.${c}`).join(",");
  const whereClause = contentCols
    .map((c) => `excluded.${c} IS NOT ${tableName}.${c}`)
    .join(" OR ");
  const target = conflictTarget ?? pkCols.join(",");
  const conflict =
    `ON CONFLICT(${target}) DO UPDATE SET ${setClause} WHERE ${whereClause}`;
  const out = fs.createWriteStream(filePath);
  let i = 0;
  for (const row of rows) {
    if (i % BATCH === 0) {
      if (i > 0) out.write(`\n${conflict};\n`);
      out.write(`INSERT INTO ${tableName} (${cols.join(",")}) VALUES\n`);
    } else {
      out.write(",\n");
    }
    out.write("(" + cols.map((c) => esc(row[c])).join(",") + ")");
    i++;
  }
  if (i > 0) out.write(`\n${conflict};\n`);
  out.end();
  return new Promise((r) => out.on("finish", r));
}

function d1Query(sql) {
  try {
    const out = execSync(
      `npx wrangler@latest d1 execute ${DB} ${FLAG} --json --command "${sql}"`,
      { stdio: "pipe", cwd: MCP_DIR },
    );
    return (JSON.parse(out.toString())[0]?.results ?? []);
  } catch {
    return null;
  }
}

// Each returns null on failure (first sync / D1 unreachable) — stale cleanup is skipped.
const fetchCurrentDocIds     = () => d1Query("SELECT id FROM docs")?.map((r) => r.id) ?? null;
const fetchCurrentEntityIds  = () => d1Query("SELECT id FROM entities")?.map((r) => r.id) ?? null;
const fetchCurrentAddrKeys   = () => d1Query("SELECT address,chain FROM addresses")
  ?.map((r) => `${r.address}|${r.chain}`) ?? null;
// Edge natural key: from_id|to_id|edge_type|meta (COALESCE handles NULL meta).
// Includes cites/mentions so stale content-derived edges are caught even when
// neither endpoint doc was removed.
const fetchCurrentEdgeKeys   = () =>
  d1Query("SELECT from_id,to_id,edge_type,COALESCE(meta,'') AS m FROM edges")
    ?.map((r) => `${r.from_id}|${r.to_id}|${r.edge_type}|${r.m}`) ?? null;

// ---------------------------------------------------------------------------
// Load artifacts
// ---------------------------------------------------------------------------

console.log("Loading docs.json…");
const rawDocs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8"));
const allDocs = Object.values(rawDocs);
console.log(`  ${allDocs.length} docs`);

console.log("Loading graph.json…");
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, "public/graph.json"), "utf8"));
const entityRows = graph.entities;
const edgeRows = graph.edges;
console.log(`  ${entityRows.length} entities, ${edgeRows.length} edges`);

console.log("Loading address artifacts…");
const addressesAtlas = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/addresses.atlas.json"), "utf8"),
);
const addressesOnChain = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "public/addresses.json"), "utf8"));
  } catch {
    return {};
  }
})();
console.log(`  ${Object.keys(addressesAtlas).length} atlas, ${Object.keys(addressesOnChain).length} on-chain`);

console.log("Loading chain-state.json…");
const chainState = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/chain-state.json"), "utf8"),
);
const chainStateByAddr = {};
if (chainState.chains) {
  for (const [chain, data] of Object.entries(chainState.chains)) {
    for (const [addr, values] of Object.entries(data.values ?? {})) {
      chainStateByAddr[addr.toLowerCase()] = { chain, block: data.block ?? data.slot ?? null, values };
    }
  }
} else {
  for (const [addr, values] of Object.entries(chainState.values ?? {})) {
    chainStateByAddr[addr.toLowerCase()] = { chain: "ethereum", block: chainState.block ?? null, values };
  }
}

// ---------------------------------------------------------------------------
// Build rows
// ---------------------------------------------------------------------------

console.log("Loading manifest.json…");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/manifest.json"), "utf8"));

// blockNumber is no longer in manifest (it changed on every build:snapshot run,
// causing spurious manifest hash changes). Read directly from chain-state.json.
const blockNumber = chainState.block
  ?? (chainState.chains ? Object.values(chainState.chains)[0]?.block ?? null : null);

const metaRows = [
  { key: "atlasCommit",   value: manifest.atlasCommit ?? null },
  { key: "redlensCommit", value: manifest.redlensCommit ?? null },
  { key: "generatedAt",   value: manifest.generatedAt ?? null },
  { key: "blockNumber",   value: blockNumber },
];
console.log(`  atlas: ${manifest.atlasCommit?.slice(0,12)}, redlens: ${manifest.redlensCommit?.slice(0,12)}`);

const syncAtlasHash = manifest.atlasCommit ?? null;
const syncUpdatedAt = new Date().toISOString();

const docRows = allDocs.map((d) => ({
  id: d.id,
  doc_no: d.doc_no,
  title: d.title,
  type: d.type,
  depth: d.depth ?? 0,
  parent_id: d.parentId ?? null,
  content: d.content ?? "",
  ord: d.order ?? 0,
  atlas_hash: syncAtlasHash,
  updated_at: syncUpdatedAt,
}));

// slug → entity id, for resolving address.entity_id
const entityBySlug = new Map(entityRows.map((e) => [e.slug, e]));

const addressRows = Object.entries(addressesAtlas).map(([addr, atlas]) => {
  const onChain = addressesOnChain[addr] ?? {};
  const label = onChain.chainlogId ?? atlas.entityLabel ?? onChain.etherscanName ?? null;
  const s = label ? slugify(label) : null;
  const cs = chainStateByAddr[addr.toLowerCase()];
  return {
    address: addr.toLowerCase(),
    chain: atlas.chain ?? "ethereum",
    label,
    chainlog_id: onChain.chainlogId ?? null,
    etherscan_name: onChain.etherscanName ?? null,
    is_contract: onChain.isContract ? 1 : 0,
    is_proxy: onChain.isProxy ? 1 : 0,
    implementation: onChain.implementation ?? null,
    roles: JSON.stringify(atlas.roles ?? []),
    aliases: JSON.stringify(atlas.aliases ?? []),
    expected_tokens: JSON.stringify(atlas.expectedTokens ?? []),
    chain_state: cs ? JSON.stringify(cs.values) : null,
    state_block: cs?.block ?? null,
    entity_id: s ? (entityBySlug.get(s)?.id ?? null) : null,
  };
});

console.log(`\nRow counts:`);
console.log(`  docs:      ${docRows.length}`);
console.log(`  entities:  ${entityRows.length}`);
console.log(`  addresses: ${addressRows.length}`);
console.log(`  edges:     ${edgeRows.length}`);
console.log(`  kv_meta:   ${metaRows.length}`);

// ---------------------------------------------------------------------------
// Write SQL files and apply
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "redlens-sync-"));
const clearFile = path.join(TMP, "_0_clear.sql");
fs.writeFileSync(
  clearFile,
  // Drop FTS5 triggers before clearing docs so deletes don't fire per-row
  // FTS5 writes. The index is rebuilt once after all docs are inserted.
  // kv_meta is NOT cleared here — sync-vectors writes vectorsAtlasCommit
  // concurrently and DELETE would race with it. INSERT OR REPLACE in
  // writeBatched is idempotent; the key set is stable so no stale keys accumulate.
  "DROP TRIGGER IF EXISTS docs_ai;\n" +
  "DROP TRIGGER IF EXISTS docs_ad;\n" +
  "DROP TRIGGER IF EXISTS docs_au;\n",
);
const files = {
  docs:     path.join(TMP, "_docs.sql"),
  entities: path.join(TMP, "_entities.sql"),
  addresses: path.join(TMP, "_addresses.sql"),
  edges:    path.join(TMP, "_edges.sql"),
  kv_meta:  path.join(TMP, "_kv_meta.sql"),
};

// Stale detection: read current IDs from D1, diff against new set, emit targeted DELETEs.
// Reads are cheap; this replaces bulk clear+reinsert with zero writes for unchanged rows.
console.log("\nDetecting stale rows…");

const currentDocIds = fetchCurrentDocIds();
const newDocIdSet = new Set(docRows.map((d) => d.id));
const removedDocIds = currentDocIds ? currentDocIds.filter((id) => !newDocIdSet.has(id)) : [];
console.log(`  docs:     ${removedDocIds.length} removed`);
if (removedDocIds.length > 0) {
  files.docs_cleanup = path.join(TMP, "_docs_cleanup.sql");
  fs.writeFileSync(
    files.docs_cleanup,
    `DELETE FROM docs WHERE id IN (${removedDocIds.map(esc).join(",")});\n`,
  );
}

const currentEntityIds = fetchCurrentEntityIds();
const newEntityIdSet = new Set(entityRows.map((e) => e.id));
const removedEntityIds = currentEntityIds ? currentEntityIds.filter((id) => !newEntityIdSet.has(id)) : [];
console.log(`  entities: ${removedEntityIds.length} removed`);
if (removedEntityIds.length > 0) {
  files.entities_cleanup = path.join(TMP, "_entities_cleanup.sql");
  fs.writeFileSync(
    files.entities_cleanup,
    `DELETE FROM entities WHERE id IN (${removedEntityIds.map(esc).join(",")});\n`,
  );
}

const currentAddrKeys = fetchCurrentAddrKeys();
const newAddrKeySet = new Set(addressRows.map((a) => `${a.address}|${a.chain}`));
const removedAddrKeys = currentAddrKeys ? currentAddrKeys.filter((k) => !newAddrKeySet.has(k)) : [];
console.log(`  addresses: ${removedAddrKeys.length} removed`);
if (removedAddrKeys.length > 0) {
  files.addresses_cleanup = path.join(TMP, "_addresses_cleanup.sql");
  const conditions = removedAddrKeys.map((k) => {
    const [addr, chain] = k.split("|");
    return `(address=${esc(addr)} AND chain=${esc(chain)})`;
  });
  fs.writeFileSync(
    files.addresses_cleanup,
    `DELETE FROM addresses WHERE ${conditions.join(" OR ")};\n`,
  );
}

const currentEdgeKeys = fetchCurrentEdgeKeys();
const newEdgeKeySet = new Set(
  edgeRows.map((e) => `${e.from_id}|${e.to_id}|${e.edge_type}|${e.meta ?? ""}`),
);
const removedEdgeKeys = currentEdgeKeys ? currentEdgeKeys.filter((k) => !newEdgeKeySet.has(k)) : [];
console.log(`  edges:     ${removedEdgeKeys.length} removed`);
if (removedEdgeKeys.length > 0) {
  files.edges_cleanup = path.join(TMP, "_edges_cleanup.sql");
  const conditions = removedEdgeKeys.map((k) => {
    const parts = k.split("|");
    // key format: from_id|to_id|edge_type|meta  (meta may contain | if ever quoted JSON does, but currently safe)
    const [fromId, toId, edgeType, ...metaParts] = parts;
    const metaVal = metaParts.join("|"); // rejoin in case meta ever has a | (defensive)
    return metaVal
      ? `(from_id=${esc(fromId)} AND to_id=${esc(toId)} AND edge_type=${esc(edgeType)} AND meta=${esc(metaVal)})`
      : `(from_id=${esc(fromId)} AND to_id=${esc(toId)} AND edge_type=${esc(edgeType)} AND meta IS NULL)`;
  });
  fs.writeFileSync(
    files.edges_cleanup,
    `DELETE FROM edges WHERE ${conditions.join(" OR ")};\n`,
  );
}

console.log("\nWriting SQL files…");
await writeUpsert(
  files.docs, "docs",
  ["id", "doc_no", "title", "type", "depth", "parent_id", "content", "ord", "atlas_hash", "updated_at"],
  ["id"],
  ["doc_no", "title", "type", "depth", "parent_id", "content", "ord"],
  docRows,
);
await writeUpsert(
  files.entities, "entities",
  ["id", "slug", "name", "entity_type", "subtype", "defining_doc_id", "is_active", "meta"],
  ["id"],
  ["slug", "name", "entity_type", "subtype", "defining_doc_id", "is_active", "meta"],
  entityRows,
);
await writeUpsert(
  files.addresses, "addresses",
  [
    "address", "chain", "label", "chainlog_id", "etherscan_name",
    "is_contract", "is_proxy", "implementation",
    "roles", "aliases", "expected_tokens",
    "chain_state", "state_block", "entity_id",
  ],
  ["address", "chain"],
  [
    "label", "chainlog_id", "etherscan_name",
    "is_contract", "is_proxy", "implementation",
    "roles", "aliases", "expected_tokens",
    "chain_state", "state_block", "entity_id",
  ],
  addressRows,
);
// id is omitted — AUTOINCREMENT assigns it for new edges; existing edges keep
// their id via ON CONFLICT DO UPDATE (no replace, so no id churn).
await writeUpsert(
  files.edges, "edges",
  ["from_id", "from_type", "to_id", "to_type", "edge_type", "source_doc_nos", "weight", "meta"],
  ["from_id", "to_id", "edge_type"],
  ["from_type", "to_type", "source_doc_nos", "weight"],
  edgeRows,
  "from_id, to_id, edge_type, COALESCE(meta, '')",
);
await writeBatched(files.kv_meta, "kv_meta", ["key", "value"], metaRows);

// Rebuild FTS5 index from the content table in one pass (replaces per-row triggers).
const rebuildFile = path.join(TMP, "_fts_rebuild.sql");
fs.writeFileSync(rebuildFile, "INSERT INTO docs_fts(docs_fts) VALUES('rebuild');\n");
files.fts_rebuild = rebuildFile;

console.log(`\nApplying to D1 ${REMOTE ? "(remote)" : "(local)"}…`);

// One-time migrations — idempotent: errors mean the object already exists.
for (const stmt of [
  "ALTER TABLE docs ADD COLUMN atlas_hash TEXT",
  "ALTER TABLE docs ADD COLUMN updated_at TEXT",
  // Expression index for edge upsert natural key. CREATE UNIQUE INDEX in
  // schema.sql would abort the sync if old data has collisions; try/catch here
  // is the safe path. IF NOT EXISTS means a no-op once created.
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_natural ON edges(from_id, to_id, edge_type, COALESCE(meta, ''))",
  // node_history.commit_seq added after initial table creation
  "ALTER TABLE node_history ADD COLUMN commit_seq INTEGER",
]) {
  try {
    execSync(`npx wrangler@latest d1 execute ${DB} ${FLAG} --command="${stmt}"`, {
      stdio: "pipe",
      cwd: MCP_DIR,
    });
  } catch {
    // Already exists or (for the index) data has a collision — safe to ignore
  }
}

// ---------------------------------------------------------------------------
// Migration runner
// Each migration carries a shouldRun() predicate that inspects the actual DB
// state. Returns true (run it), false (already correct — record and skip), or
// null (DB unreachable — skip without recording).
// schema_migrations is created here so it exists before schema.sql runs.
// ---------------------------------------------------------------------------

const MIGRATIONS = [
  {
    id: "001-drop-unique-doc-no",
    file: path.join(MCP_DIR, "migrations/001-drop-unique-doc-no.sql"),
    shouldRun() {
      const rows = d1Query("SELECT sql FROM sqlite_master WHERE type='table' AND name='docs'");
      if (rows === null) return null;
      return (rows[0]?.sql ?? "").includes("UNIQUE");
    },
  },
];

function recordMigration(id) {
  const ts = new Date().toISOString();
  try {
    execSync(
      `npx wrangler@latest d1 execute ${DB} ${FLAG} --command="INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('${id}', '${ts}')"`,
      { stdio: "pipe", cwd: MCP_DIR },
    );
  } catch { /* ignore */ }
}

try {
  execSync(
    `npx wrangler@latest d1 execute ${DB} ${FLAG} --command="CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"`,
    { stdio: "pipe", cwd: MCP_DIR },
  );
} catch { /* ignore */ }

const appliedMigrations = new Set(
  (d1Query("SELECT id FROM schema_migrations") ?? []).map((r) => r.id),
);

console.log("Running migrations…");
for (const mig of MIGRATIONS) {
  if (appliedMigrations.has(mig.id)) {
    console.log(`  ${mig.id} already applied`);
    continue;
  }
  const needed = mig.shouldRun ? mig.shouldRun() : true;
  if (needed === null) {
    console.log(`  ${mig.id} skipped (DB unreachable)`);
    continue;
  }
  if (!needed) {
    console.log(`  ${mig.id} not needed — recording`);
    recordMigration(mig.id);
    continue;
  }
  console.log(`  ${mig.id} running…`);
  runFile(mig.file);
  recordMigration(mig.id);
  console.log(`  ${mig.id} done`);
}

runFile(SCHEMA);
console.log("  schema done");
runFile(clearFile);
fs.unlinkSync(clearFile);
console.log("  clear done");
for (const [name, file] of Object.entries(files)) {
  runFile(file);
  console.log(`  ${name} done`);
  fs.unlinkSync(file);
}
fs.rmdirSync(TMP);

console.log("\nDone.");
