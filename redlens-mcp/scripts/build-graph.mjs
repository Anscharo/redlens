#!/usr/bin/env node
/**
 * build-graph.mjs
 *
 * Reads docs.json + addresses.json + chain-state.json and produces:
 *   - public/graph.json     (for local inspection)
 *   - SQL files imported into D1 via import-d1.mjs
 *
 * Usage:
 *   node scripts/build-graph.mjs [--remote]
 *
 * Research: docs/graph-schema-research.md
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// redlens-mcp lives inside the main repo as a subdirectory:
//   lens/redlens-mcp/scripts/build-graph.mjs → ROOT = lens/
const ROOT = path.resolve(__dirname, "../..");
const REMOTE = process.argv.includes("--remote");
const FLAG = REMOTE ? "--remote" : "--local";
const DB = "redlens-atlas";
const BATCH = 20; // D1 SQLITE_TOOBIG limit — node content is large, keep batches small

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s) {
  if (s == null) return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function slug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uuid() {
  return crypto.randomUUID();
}

function runFile(filePath) {
  execSync(`npx wrangler@latest d1 execute ${DB} ${FLAG} --file="${filePath}"`, {
    stdio: "inherit",
    cwd: path.resolve(__dirname, ".."),
  });
}

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

console.log("Loading docs.json…");
const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8"));
const nodes = Object.values(docs);
console.log(`  ${nodes.length} nodes`);

console.log("Loading addresses.json…");
const addressesRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "public/addresses.json"), "utf8"));
console.log(`  ${Object.keys(addressesRaw).length} addresses`);

console.log("Loading chain-state.json…");
const chainState = JSON.parse(fs.readFileSync(path.join(ROOT, "public/chain-state.json"), "utf8"));
// Normalise: support both flat {values:{addr:...}} and per-chain {chains:{eth:{values:{...}}}}
const chainStateByAddr = {};
if (chainState.chains) {
  for (const [chain, data] of Object.entries(chainState.chains)) {
    for (const [addr, values] of Object.entries(data.values ?? {})) {
      chainStateByAddr[addr.toLowerCase()] = {
        chain,
        block: data.block ?? data.slot ?? null,
        at: chainState.generatedAt,
        values,
      };
    }
  }
} else {
  // Flat (current format — all ethereum)
  for (const [addr, values] of Object.entries(chainState.values ?? {})) {
    chainStateByAddr[addr.toLowerCase()] = {
      chain: "ethereum",
      block: chainState.block ?? null,
      at: chainState.generatedAt,
      values,
    };
  }
}

// ---------------------------------------------------------------------------
// Entity catalog — hardcoded known entities + dynamic agent extraction
// ---------------------------------------------------------------------------

// Known entities derived from Atlas research (A.6.1.2.x + A.0.1.1.x)
const KNOWN_ENTITIES = [
  // Executor Agents
  { id: "c57df14a-0000-0000-0000-000000000001", slug: "amatsu", name: "Amatsu",
    entity_type: "agent", subtype: "operational_executor",
    defining_node_id: "c57df14a-0000-0000-0000-000000000001" }, // placeholder, real id from docs
  { id: "565660dd-0000-0000-0000-000000000001", slug: "ozone", name: "Ozone",
    entity_type: "agent", subtype: "operational_executor",
    defining_node_id: null },
  { id: "12b14e05-0000-0000-0000-000000000001", slug: "core-council-executor-1",
    name: "Core Council Executor Agent 1",
    entity_type: "agent", subtype: "core_executor",
    defining_node_id: null },

  // Facilitators
  { id: "a874a419-1191-4a48-b97c-c91cfedf378c", slug: "endgame-edge", name: "Endgame Edge",
    entity_type: "operational_facilitator", subtype: "executor_facilitator",
    defining_node_id: "a874a419-1191-4a48-b97c-c91cfedf378c" },
  { id: "d282ccb9-82f8-46da-9180-e15e5714bb88", slug: "redline-facilitation-group",
    name: "Redline Facilitation Group",
    entity_type: "operational_facilitator", subtype: "executor_facilitator",
    defining_node_id: "d282ccb9-82f8-46da-9180-e15e5714bb88" },
  { id: "8cfee319-727d-459b-ae67-cac3bec157d9", slug: "jansky", name: "JanSky",
    entity_type: "operational_facilitator", subtype: "core_facilitator",
    defining_node_id: "8cfee319-727d-459b-ae67-cac3bec157d9" },

  // GovOps
  { id: "66845ee6-4405-4ed8-bb22-4a7558e63a52", slug: "soter-labs", name: "Soter Labs",
    entity_type: "govops", subtype: "operational_govops",
    defining_node_id: "66845ee6-4405-4ed8-bb22-4a7558e63a52" },
  { id: "3b9b8910-e26b-4bc3-9889-7ee18bdc94f1", slug: "atlas-axis", name: "Atlas Axis",
    entity_type: "govops", subtype: "core_govops",
    defining_node_id: "3b9b8910-e26b-4bc3-9889-7ee18bdc94f1" },
];

// ERG members that need synthetic entity records (no dedicated Atlas node)
// Source: A.1.8.1.2.2.0.6.1
const ERG_NODE_ID = "e9807449-fdc3-4860-8d53-c56181311618";
const ERG_MEMBERS = [
  "Ecosystem", "Phoenix Labs", "Jetstream", "Steakhouse", "Blocktower",
  "Core Council Risk Advisor", "Maker Growth", "Dewiz", "Sidestream",
  "JuliaChang", "PullUp Labs", "Chronicle Labs", "TechOps Services",
  // Endgame Edge, JanSky, Atlas Axis are already in KNOWN_ENTITIES
  // Cloaky, Blue — also in addresses.json as delegates (cross-ref below)
  "Cloaky", "Blue",
];

// Delegate names that appear in both ERG and addresses.json
// (names matching addresses.json label field, case-insensitive)
const DELEGATE_ERG_OVERLAP = new Set(["cloaky", "blue"]);

// Build entity map (slug → entity record)
const entityMap = new Map();
for (const e of KNOWN_ENTITIES) {
  entityMap.set(e.slug, { ...e, meta: null });
}

// Add ERG synthetic entities
for (const name of ERG_MEMBERS) {
  const s = slug(name);
  if (!entityMap.has(s)) {
    entityMap.set(s, {
      id: uuid(),
      slug: s,
      name,
      entity_type: "ecosystem_actor",
      subtype: null,
      defining_node_id: null,
      is_active: 1,
      meta: JSON.stringify({
        source: "active_data_list",
        source_node_id: ERG_NODE_ID,
        source_doc_no: "A.1.8.1.2.2.0.6.1",
        extracted_as: "list_item",
      }),
    });
  }
}

// Resolve Executor Agent node IDs from docs.json
const docNoToNode = new Map(nodes.map(n => [n.doc_no, n]));
const amatsuNode = docNoToNode.get("A.6.1.2.1");
const ozoneNode = docNoToNode.get("A.6.1.2.2");
const cceNode = docNoToNode.get("A.6.1.2.3");
if (amatsuNode) entityMap.get("amatsu").defining_node_id = amatsuNode.id;
if (ozoneNode) entityMap.get("ozone").defining_node_id = ozoneNode.id;
if (cceNode) entityMap.get("core-council-executor-1").defining_node_id = cceNode.id;
// Fix IDs for executor agents to use actual Atlas node IDs
if (amatsuNode) entityMap.get("amatsu").id = amatsuNode.id;
if (ozoneNode) entityMap.get("ozone").id = ozoneNode.id;
if (cceNode) entityMap.get("core-council-executor-1").id = cceNode.id;

// Add Prime Agent entities from docs.json
const PRIME_AGENTS = {
  "A.6.1.1.1": { slug: "spark", name: "Spark" },
  "A.6.1.1.2": { slug: "grove", name: "Grove" },
  "A.6.1.1.3": { slug: "keel", name: "Keel" },
  "A.6.1.1.4": { slug: "skybase", name: "Skybase" },
  "A.6.1.1.5": { slug: "obex", name: "Obex" },
  "A.6.1.1.6": { slug: "pattern", name: "Pattern" },
  "A.6.1.1.7": { slug: "launch-agent-6", name: "Launch Agent 6" },
  "A.6.1.1.8": { slug: "launch-agent-7", name: "Launch Agent 7" },
};
for (const [docNo, info] of Object.entries(PRIME_AGENTS)) {
  const n = docNoToNode.get(docNo);
  if (n) {
    entityMap.set(info.slug, {
      id: n.id,
      slug: info.slug,
      name: info.name,
      entity_type: "agent",
      subtype: "prime",
      defining_node_id: n.id,
      is_active: 1,
      meta: null,
    });
  }
}

// Add Scope entities
for (const n of nodes.filter(n => n.type === "Scope")) {
  const s = slug(n.title);
  entityMap.set(s, {
    id: n.id,
    slug: s,
    name: n.title,
    entity_type: "scope",
    subtype: null,
    defining_node_id: n.id,
    is_active: 1,
    meta: null,
  });
}

// Cross-reference addresses.json delegate labels with entity slugs
// Build label → address lookup for entity → address edges
const labelToAddress = new Map();
for (const [addr, info] of Object.entries(addressesRaw)) {
  if (info.label) {
    const s = slug(info.label);
    if (!labelToAddress.has(s)) labelToAddress.set(s, []);
    labelToAddress.get(s).push({ addr, chain: info.chain ?? "ethereum" });
  }
  // Also create entity rows for named delegates not already in entityMap
  if (info.roles?.includes("delegate") && info.label) {
    const s = slug(info.label);
    if (!entityMap.has(s)) {
      entityMap.set(s, {
        id: uuid(),
        slug: s,
        name: info.label,
        entity_type: "alignment_conserver",
        subtype: "aligned_delegate",
        defining_node_id: null,
        is_active: 1,
        meta: JSON.stringify({ source: "addresses_json", address: addr }),
      });
    }
  }
}

console.log(`  ${entityMap.size} entities total`);

// ---------------------------------------------------------------------------
// Build edges
// ---------------------------------------------------------------------------

const edges = [];

function addEdge(fromId, fromType, toId, toType, edgeType, meta = null) {
  edges.push({ fromId, fromType, toId, toType, edgeType, weight: 1.0, meta });
}

// parent_of edges
for (const n of nodes) {
  if (n.parentId) addEdge(n.parentId, "atlas_node", n.id, "atlas_node", "parent_of");
}

// cites edges (UUID markdown links: [text](uuid))
const CITE_RE = /\[([^\]]*)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
const nodeIds = new Set(nodes.map(n => n.id));
let citeCount = 0;
for (const n of nodes) {
  const seen = new Set();
  for (const m of (n.content ?? "").matchAll(CITE_RE)) {
    const targetId = m[2];
    if (nodeIds.has(targetId) && targetId !== n.id && !seen.has(targetId)) {
      seen.add(targetId);
      addEdge(n.id, "atlas_node", targetId, "atlas_node", "cites");
      citeCount++;
    }
  }
}
console.log(`  ${citeCount} cites edges`);

// annotates edges (doc_no ending .0.3.X)
// active_data_for edges (doc_no ending .0.6.X)
const ANNOTATES_RE = /\.0\.3\.\d+$/;
const ACTIVE_DATA_RE = /\.0\.6\.\d+$/;
for (const n of nodes) {
  if (ANNOTATES_RE.test(n.doc_no) && n.parentId) {
    addEdge(n.id, "atlas_node", n.parentId, "atlas_node", "annotates");
  }
  if (ACTIVE_DATA_RE.test(n.doc_no) && n.parentId) {
    addEdge(n.id, "atlas_node", n.parentId, "atlas_node", "active_data_for");
  }
}

// mentions edges (addressRefs in docs.json, or extract from content)
const EVM_RE = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
for (const n of nodes) {
  const refs = n.addressRefs ?? [];
  for (const addr of refs) {
    const key = addr.toLowerCase() + ":ethereum"; // composite PK encoding
    addEdge(n.id, "atlas_node", key, "address", "mentions");
  }
}

// defines_entity edges (Atlas nodes that define known entities)
for (const [, entity] of entityMap) {
  if (entity.defining_node_id && nodeIds.has(entity.defining_node_id)) {
    addEdge(entity.defining_node_id, "atlas_node", entity.id, "entity", "defines_entity");
  }
}

// member_of edges (named assignments from A.6.1.2.x research)
const amatsuId = entityMap.get("amatsu")?.id;
const ozoneId = entityMap.get("ozone")?.id;
const cceId = entityMap.get("core-council-executor-1")?.id;
const eeId = entityMap.get("endgame-edge")?.id;
const redlineId = entityMap.get("redline-facilitation-group")?.id;
const janSkyId = entityMap.get("jansky")?.id;
const soterLabsId = entityMap.get("soter-labs")?.id;
const atlasAxisId = entityMap.get("atlas-axis")?.id;

if (eeId && amatsuId)      addEdge(eeId, "entity", amatsuId, "entity", "member_of",
  JSON.stringify({ role: "operational_facilitator", source_doc: "A.6.1.2.1.1" }));
if (redlineId && ozoneId)  addEdge(redlineId, "entity", ozoneId, "entity", "member_of",
  JSON.stringify({ role: "operational_facilitator", source_doc: "A.6.1.2.2.1" }));
if (janSkyId && cceId)     addEdge(janSkyId, "entity", cceId, "entity", "member_of",
  JSON.stringify({ role: "core_facilitator", source_doc: "A.6.1.2.3.1" }));
if (soterLabsId && amatsuId) addEdge(soterLabsId, "entity", amatsuId, "entity", "member_of",
  JSON.stringify({ role: "operational_govops", source_doc: "A.6.1.2.1.2" }));
if (soterLabsId && ozoneId) addEdge(soterLabsId, "entity", ozoneId, "entity", "member_of",
  JSON.stringify({ role: "operational_govops", source_doc: "A.6.1.2.2.2" }));
if (atlasAxisId && cceId)  addEdge(atlasAxisId, "entity", cceId, "entity", "member_of",
  JSON.stringify({ role: "core_govops", source_doc: "A.6.1.2.3.2" }));

// member_of_erg edges
const ergEntities = [
  "endgame-edge", "jansky", "atlas-axis", "cloaky", "blue",
  ...ERG_MEMBERS.map(slug),
];
for (const s of [...new Set(ergEntities)]) {
  const entity = entityMap.get(s);
  if (entity) addEdge(entity.id, "entity", ERG_NODE_ID, "atlas_node", "member_of_erg");
}

// has_address edges (entity → address composite key)
for (const [s, entity] of entityMap) {
  const addrs = labelToAddress.get(s) ?? [];
  for (const { addr, chain } of addrs) {
    const key = addr.toLowerCase() + ":" + chain;
    addEdge(entity.id, "entity", key, "address", "has_address");
  }
}

// proxies_to edges (from addresses.json implementation field)
for (const [addr, info] of Object.entries(addressesRaw)) {
  if (info.implementation) {
    const fromKey = addr.toLowerCase() + ":" + (info.chain ?? "ethereum");
    const toKey = info.implementation.toLowerCase() + ":" + (info.chain ?? "ethereum");
    addEdge(fromKey, "address", toKey, "address", "proxies_to");
  }
}

console.log(`  ${edges.length} total edges`);

// ---------------------------------------------------------------------------
// Addresses table rows
// ---------------------------------------------------------------------------

const addressRows = [];
for (const [addr, info] of Object.entries(addressesRaw)) {
  const chain = info.chain ?? "ethereum";
  const cs = chainStateByAddr[addr.toLowerCase()];
  // Find entity_id by matching label slug
  const s = info.label ? slug(info.label) : null;
  const entityId = s ? (entityMap.get(s)?.id ?? null) : null;

  addressRows.push({
    address: addr.toLowerCase(),
    chain,
    label: info.label ?? null,
    chainlog_id: info.chainlogId ?? null,
    etherscan_name: null,
    is_contract: info.isContract ? 1 : 0,
    is_proxy: info.isProxy ? 1 : 0,
    implementation: info.implementation ?? null,
    roles: JSON.stringify(info.roles ?? []),
    aliases: JSON.stringify(info.aliases ?? []),
    expected_tokens: JSON.stringify(info.expectedTokens ?? []),
    chain_state: cs ? JSON.stringify(cs.values) : null,
    state_block: cs?.block ?? null,
    state_at: cs?.at ?? null,
    entity_id: entityId,
  });
}

// ---------------------------------------------------------------------------
// Write SQL files
// ---------------------------------------------------------------------------

const TMP = path.join(__dirname);

function writeBatched(filePath, tableName, cols, rows, extraPreamble = "") {
  const out = fs.createWriteStream(filePath);
  if (extraPreamble) out.write(extraPreamble + "\n");
  out.write(`DELETE FROM ${tableName};\n`);

  let i = 0;
  for (const row of rows) {
    if (i % BATCH === 0) {
      if (i > 0) out.write(";\n");
      out.write(`INSERT OR REPLACE INTO ${tableName} (${cols.join(",")}) VALUES\n`);
    } else {
      out.write(",\n");
    }
    out.write("(" + cols.map(c => esc(row[c])).join(",") + ")");
    i++;
  }
  if (i > 0) out.write(";\n");
  out.end();
  return new Promise(r => out.on("finish", r));
}

// Prepare entity rows
const entityRows = [...entityMap.values()].map(e => ({
  id: e.id,
  slug: e.slug,
  name: e.name,
  entity_type: e.entity_type,
  subtype: e.subtype ?? null,
  defining_node_id: e.defining_node_id ?? null,
  is_active: e.is_active ?? 1,
  meta: e.meta ?? null,
}));

// Prepare node rows
const nodeRows = nodes.map(n => ({
  id: n.id,
  doc_no: n.doc_no,
  title: n.title,
  type: n.type,
  depth: n.depth ?? 0,
  parent_id: n.parentId ?? null,
  content: (n.content ?? "").slice(0, 50000),
  ord: n.order ?? 0,
  entity_id: [...entityMap.values()].find(e => e.defining_node_id === n.id)?.id ?? null,
}));

// Prepare edge rows
const edgeRows = edges.map((e, i) => ({
  id: i + 1,
  from_id: e.fromId,
  from_type: e.fromType,
  to_id: e.toId,
  to_type: e.toType,
  edge_type: e.edgeType,
  weight: e.weight,
  meta: e.meta ?? null,
}));

console.log("\nWriting SQL files…");

const entitiesFile  = path.join(TMP, "_entities.sql");
const nodesFile     = path.join(TMP, "_nodes.sql");
const addressesFile = path.join(TMP, "_addresses.sql");
const edgesFile     = path.join(TMP, "_edges.sql");

await writeBatched(entitiesFile, "entities",
  ["id","slug","name","entity_type","subtype","defining_node_id","is_active","meta"],
  entityRows);

await writeBatched(nodesFile, "atlas_nodes",
  ["id","doc_no","title","type","depth","parent_id","content","ord","entity_id"],
  nodeRows);

await writeBatched(addressesFile, "addresses",
  ["address","chain","label","chainlog_id","etherscan_name","is_contract","is_proxy",
   "implementation","roles","aliases","expected_tokens","chain_state","state_block","state_at","entity_id"],
  addressRows);

await writeBatched(edgesFile, "edges",
  ["id","from_id","from_type","to_id","to_type","edge_type","weight","meta"],
  edgeRows);

console.log(`  entities: ${entityRows.length}`);
console.log(`  nodes:    ${nodeRows.length}`);
console.log(`  addresses:${addressRows.length}`);
console.log(`  edges:    ${edgeRows.length}`);

// ---------------------------------------------------------------------------
// Export graph.json for local inspection
// ---------------------------------------------------------------------------
const graphJson = {
  meta: {
    generatedAt: new Date().toISOString(),
    sources: ["public/docs.json", "public/addresses.json", "public/chain-state.json"],
    schemaVersion: 2,
    counts: {
      entities: entityRows.length,
      nodes: nodeRows.length,
      addresses: addressRows.length,
      edges: edgeRows.length,
    },
  },
  entities: entityRows,
  edges: edgeRows.slice(0, 10000), // sample for inspection; full data is in D1
};
fs.writeFileSync(path.join(ROOT, "public/graph.json"), JSON.stringify(graphJson));
console.log("  public/graph.json written");

// ---------------------------------------------------------------------------
// Apply to D1
// ---------------------------------------------------------------------------
console.log(`\nApplying to D1 ${REMOTE ? "(remote)" : "(local)"}…`);

runFile(entitiesFile);  console.log("  entities done");
runFile(nodesFile);     console.log("  nodes done");
runFile(addressesFile); console.log("  addresses done");
runFile(edgesFile);     console.log("  edges done");

for (const f of [entitiesFile, nodesFile, addressesFile, edgesFile]) {
  fs.unlinkSync(f);
}

console.log("\nDone.");
