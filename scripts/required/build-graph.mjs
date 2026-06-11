#!/usr/bin/env node
/**
 * build-graph.mjs
 *
 * Pattern-driven extraction of the Atlas graph. Outputs live at repo root so
 * they're first-class artifacts for every consumer — the frontend loads
 * relations.json directly; the redlens-mcp Worker mirrors the graph into D1
 * via sync-d1.mjs.
 * See .claude/skills/parse-atlas/SKILL.md for the full relationship reference.
 *
 * Usage (from repo root):
 *   node scripts/required/build-graph.mjs
 *
 * Reads:
 *   public/docs.json
 *   public/addresses.json
 *   public/chain-state.json
 *
 * Writes:
 *   public/graph.json        — full export for local inspection / D1 sync input
 *   public/relations.json    — lean browser payload
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import { slugify, normalizeKey, buildNameIndex } from "../lib/graph-patterns.mjs";
import { extractMultisigs } from "../lib/graph-multisigs.mjs";
import { extractTransfers } from "../lib/graph-transfers.mjs";
import {
  parseMarkdownTable,
  extractEthAddresses,
  extractUrl,
} from "../lib/table-parser.mjs";
import { extractEntities } from "../lib/graph-entities.mjs";
import { extractDocEdges } from "../lib/graph-doc-edges.mjs";
import { extractEntityEdges } from "../lib/graph-entity-edges.mjs";
import {
  ETH_ADDR_RE,
  SOL_ADDR_RE,
  normalizeAddress,
  detectChain,
  findTableContext,
} from "../lib/address-chains.mjs";
import {
  extractRoles,
  extractEntityLabel,
  extractExpectedTokens,
} from "../lib/address-annotate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const atlasCommit = (() => {
  try { return execSync("git rev-parse HEAD", { cwd: path.join(ROOT, "vendor/next-gen-atlas"), encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
})();

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

console.log("Loading docs.json…");
const rawDocs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8"));
const allDocs = Object.values(rawDocs.nodes);
console.log(`  ${allDocs.length} docs`);

const docById = new Map(allDocs.map((d) => [d.id, d]));
const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));

// Load both address artifacts and build a merged in-memory view for graph
// extraction. Phase 4.5 writes enrichments back to addresses.atlas.json only;
// addresses.json (on-chain data) is never mutated by build-graph.
console.log("Loading address artifacts…");
const addressesAtlas = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/addresses.atlas.json"), "utf8"),
).addresses;
const addressesOnChain = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "public/addresses.json"), "utf8"));
  } catch {
    return {};
  }
})();

function resolveLabel(atlas, onChain) {
  return onChain.chainlogId ?? atlas.entityLabel ?? onChain.etherscanName ?? null;
}

const addressesRaw = {};
for (const [addr, atlas] of Object.entries(addressesAtlas)) {
  const onChain = addressesOnChain[addr] ?? {};
  const label = resolveLabel(atlas, onChain);
  const aliasCandidates = [onChain.chainlogId, atlas.entityLabel, onChain.etherscanName].filter(
    (l) => l && l !== label,
  );
  const aliases = [
    ...new Set([...(atlas.aliases ?? []), ...aliasCandidates]),
  ].sort();
  addressesRaw[addr] = { ...atlas, ...onChain, label, aliases };
}
console.log(`  ${Object.keys(addressesAtlas).length} atlas, ${Object.keys(addressesOnChain).length} on-chain`);

console.log("Loading chain-state.json…");
const chainState = JSON.parse(fs.readFileSync(path.join(ROOT, "public/chain-state.json"), "utf8"));
const chainStateByAddr = {};
if (chainState.chains) {
  for (const [chain, data] of Object.entries(chainState.chains)) {
    for (const [addr, values] of Object.entries(data.values ?? {})) {
      chainStateByAddr[addr.toLowerCase()] = {
        chain,
        block: data.block ?? data.slot ?? null,
        values,
      };
    }
  }
} else {
  for (const [addr, values] of Object.entries(chainState.values ?? {})) {
    chainStateByAddr[addr.toLowerCase()] = {
      chain: "ethereum",
      block: chainState.block ?? null,
      values,
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 2.6: Annotate addresses from doc content
//
// Runs before Phase 1 (entity extraction) so that role-based detection
// (e.g. delegate role → create delegate_org entity) works correctly.
//
// Scans every doc for EVM and Solana addresses, applies sliding-window
// annotation (structural roles, entity labels, expected tokens), and merges
// the results into addressesAtlas. This replaces the annotation that
// previously ran in build-index, and now has access to the full doc set
// in one place — no loopback needed.
//
// GENERIC_LABELS filters out single-word prose artifacts that aren't real
// entity names (e.g. "contract", "address" picked up from nearby text).
// ---------------------------------------------------------------------------
{
  const GENERIC_LABELS = new Set([
    "contract", "address", "registry", "multisig",
    "the contract", "the address", "the multisig", "agreement",
  ]);

  // Per-address aggregation across all docs
  const agg = new Map(); // addr → { chains: Set, labels: Set, roles: Set, tokens: Set }

  for (const doc of allDocs) {
    const content = doc.content ?? "";

    ETH_ADDR_RE.lastIndex = 0;
    let m;
    while ((m = ETH_ADDR_RE.exec(content)) !== null) {
      const key = normalizeAddress(m[0]);
      const chain = detectChain(content, m.index);
      const table = findTableContext(content, m.index);
      let g = agg.get(key);
      if (!g) { g = { chains: new Set(), labels: new Set(), roles: new Set(), tokens: new Set() }; agg.set(key, g); }
      g.chains.add(chain);
      const label = extractEntityLabel(content, m.index, table);
      if (label) g.labels.add(label);
      for (const r of extractRoles(content, m.index, m[0].length, table)) g.roles.add(r);
      for (const t of extractExpectedTokens(content, m.index, m[0].length, table)) g.tokens.add(t);
    }

    SOL_ADDR_RE.lastIndex = 0;
    while ((m = SOL_ADDR_RE.exec(content)) !== null) {
      const key = normalizeAddress(m[0]);
      const table = findTableContext(content, m.index);
      let g = agg.get(key);
      if (!g) { g = { chains: new Set(["solana"]), labels: new Set(), roles: new Set(), tokens: new Set() }; agg.set(key, g); }
      g.chains.add("solana");
      const label = extractEntityLabel(content, m.index, table);
      if (label) g.labels.add(label);
      for (const r of extractRoles(content, m.index, m[0].length, table)) g.roles.add(r);
      for (const t of extractExpectedTokens(content, m.index, m[0].length, table)) g.tokens.add(t);
    }
  }

  // Merge into addressesAtlas
  for (const [addr, g] of agg) {
    let entry = addressesAtlas[addr];
    if (!entry) continue; // address not found during build-index (shouldn't happen)

    // Chain: prefer any non-ethereum detection
    const specific = [...g.chains].find((c) => c !== "ethereum");
    entry.chain = specific ?? [...g.chains][0] ?? entry.chain ?? "ethereum";

    // Entity label: pick longest non-generic candidate
    const labelPool = [...g.labels];
    const candidates = labelPool.filter((l) => !GENERIC_LABELS.has(l.toLowerCase()));
    const pool = candidates.length ? candidates : labelPool;
    pool.sort((a, b) => b.length - a.length || a.localeCompare(b));
    entry.entityLabel = pool[0] ?? null;
    entry.aliases = pool.length > 1 ? pool.slice(1) : [];

    entry.roles = [...g.roles].sort();
    entry.expectedTokens = [...g.tokens].sort();
  }

  // Rebuild addressesRaw from the now-annotated atlas so Phase 1 entity
  // extraction sees roles (e.g. delegate role → create delegate_org entity).
  for (const [addr, atlas] of Object.entries(addressesAtlas)) {
    const onChain = addressesOnChain[addr] ?? {};
    const label = resolveLabel(atlas, onChain);
    const aliasCandidates = [onChain.chainlogId, atlas.entityLabel, onChain.etherscanName]
      .filter((l) => l && l !== label);
    const aliases = [...new Set([...(atlas.aliases ?? []), ...aliasCandidates])].sort();
    addressesRaw[addr] = { ...atlas, ...onChain, label, aliases };
  }

  console.log(`  Phase 2.6: ${agg.size} addresses annotated from doc content`);
}

// ---------------------------------------------------------------------------
// Phase 1: Extract entities
// ---------------------------------------------------------------------------

console.log("\nExtracting entities…");
const entityContext = extractEntities(allDocs, docById, docByDocNo, addressesRaw);
console.log(`  ${entityContext.entityMap.size} entities`);
const { entityMap, entityByDocId } = entityContext;

// ---------------------------------------------------------------------------
// Phase 2: Extract edges
// ---------------------------------------------------------------------------

console.log("Extracting edges…");
const docEdges = extractDocEdges(allDocs, docById, docByDocNo, entityByDocId);
const entityEdges = extractEntityEdges(allDocs, docById, docByDocNo, entityContext, addressesRaw);
const edges = [...docEdges, ...entityEdges];
console.log(`  ${edges.length} total edges`);

// ---------------------------------------------------------------------------
// Phase 2.5: ICD-param address annotations + has_address edges
//
// Instance entities carry meta.params with structured address values. We use
// these to emit (a) has_address edges from the instance entity to each param
// address, and (b) an icdAnnotations map used in Phase 4.5 to enrich
// addresses.json with structurally-derived roles and labels — overriding the
// prose-heuristic results from build-index.
// ---------------------------------------------------------------------------

// Param keys that contain addresses, mapped to role tags.
// "Token Address (ERC4626 Vault)" is a vault contract, not a token — handled
// by the prefix rule in icdParamRole(). Bare "Address" is too ambiguous
// (appears in Pioneer Chain ICDs with no stable meaning) and is omitted.
const ICD_PARAM_ROLES = new Map([
  ["Integration Partner Reward Address", "integration-boost-reward"],
  ["Token Address", "token"],
  ["Underlying Asset Address", "underlying-asset"],
  ["Pool Address", "pool"],
  ["Allocator Role Address", "allocator-role"],
]);

function icdParamRole(key) {
  if (ICD_PARAM_ROLES.has(key)) return ICD_PARAM_ROLES.get(key);
  if (key.startsWith("Token Address (")) return /ERC4626/i.test(key) ? "vault" : "token";
  return null;
}

function normalizeChain(raw) {
  if (!raw) return "ethereum";
  const s = raw.toLowerCase();
  if (s.includes("base")) return "base";
  if (s.includes("arbitrum")) return "arbitrum";
  if (s.includes("optimism")) return "optimism";
  if (s.includes("solana")) return "solana";
  if (s.includes("avalanche") || s.includes("avax")) return "avalanche";
  if (s.includes("polygon")) return "polygon";
  if (s.includes("gnosis")) return "gnosis";
  if (s.includes("monad") || s.includes("plume") || s.includes("plasma")) return "ethereum"; // testnets/future — map to eth for now
  if (s.includes("ethereum") || s.includes("mainnet")) return "ethereum";
  console.warn(`  icd-chain: unrecognized chain string "${raw}", defaulting to ethereum`);
  return "ethereum";
}

function icdParamChain(key, params) {
  if (key.startsWith("Token Address (")) {
    const m = key.match(/\(([^)]+)\)/);
    if (m && !/ERC4626/i.test(m[1])) return normalizeChain(m[1]);
  }
  return normalizeChain(
    params["Integration Partner Chain"]?.[0] ?? params["Network"]?.[0],
  );
}

function icdParamLabel(key, params, agentName, instanceName) {
  if (key === "Integration Partner Reward Address") {
    const partner = params["Integration Partner Name"]?.[0];
    return partner ? `${partner} (IB reward)` : instanceName;
  }
  if (key.startsWith("Token Address")) {
    return params["Token Symbol"]?.[0] ?? params["Token Name"]?.[0] ?? instanceName;
  }
  if (key === "Pool Address") {
    const protocol = params["Target Protocol"]?.[0];
    return protocol ? `${protocol} Pool (${agentName ?? instanceName})` : instanceName;
  }
  if (key === "Underlying Asset Address") {
    const token = params["Token"]?.[0] ?? params["Token Symbol"]?.[0];
    return token ? `${token} underlying asset` : instanceName;
  }
  if (key === "Allocator Role Address") {
    return agentName ? `${agentName} allocator role` : instanceName;
  }
  return instanceName;
}

const icdAnnotations = new Map(); // lowercase addr → { roles, entityLabel, chain }
// IB partner names and agent token symbols — collected for Phase 4.5 logging.
const ibPartnerNames = new Set();
// (partnerName, instance entity, param-leaf doc_no) triples — consumed by the
// integration-partner promotion in Phase 2.8.
const ibPartnerLinks = [];
const agentTokenSymbols = new Set();
let icdHasAddressCount = 0;
let icdAgentResolved = 0;

for (const ent of entityMap.values()) {
  if (ent.entity_type !== "instance" && ent.entity_type !== "invocation") continue;
  let meta;
  try { meta = JSON.parse(ent.meta ?? "{}"); } catch { continue; }
  const params = meta.params ?? {};

  const agentDoc = meta.agent_doc_id ? docById.get(meta.agent_doc_id) : null;
  const agentEntity = agentDoc ? entityByDocId.get(agentDoc.id) : null;
  const agentName = agentEntity?.name ?? null;
  if (agentName) icdAgentResolved++;

  // Collect IB partner names and agent token symbols (logged at end).
  if (ent.subtype === "integration-boost") {
    const tuple = params["Integration Partner Name"];
    const partner = tuple?.[0];
    if (partner && partner.length > 1) {
      ibPartnerNames.add(partner);
      ibPartnerLinks.push({ partner, instance: ent, srcDocNo: tuple[2] });
    }
  }
  if (ent.subtype === "agent-token") {
    const symbol = params["Token Symbol"]?.[0];
    if (symbol && /^[A-Z]{2,10}$/.test(symbol)) agentTokenSymbols.add(symbol);
  }

  for (const [key, tuple] of Object.entries(params)) {
    const role = icdParamRole(key);
    if (!role) continue;
    const [value, , srcDocNo] = tuple;
    const isEvm = /^0x[0-9a-fA-F]{40}$/.test(value);
    const isSol = !isEvm && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(value);
    if (!isEvm && !isSol) continue;

    const addr = isEvm ? value.toLowerCase() : value;
    const chain = isSol ? "solana" : icdParamChain(key, params);
    const label = icdParamLabel(key, params, agentName, ent.name);

    if (!icdAnnotations.has(addr)) {
      icdAnnotations.set(addr, { roles: [role], entityLabel: label, chain });
    } else {
      const existing = icdAnnotations.get(addr);
      if (!existing.roles.includes(role)) existing.roles.push(role);
    }

    edges.push({
      fromId: ent.id,
      fromType: "entity",
      toId: `${addr}:${chain}`,
      toType: "address",
      edgeType: "has_address",
      sourceDocNos: [srcDocNo],
      meta: JSON.stringify({ param: key }),
    });
    icdHasAddressCount++;
  }
}

const instanceCount = [...entityMap.values()].filter((e) => e.entity_type === "instance").length;
const invocationCount = [...entityMap.values()].filter((e) => e.entity_type === "invocation").length;
console.log(
  `  ICD-param: ${icdHasAddressCount} has_address edges, ${icdAnnotations.size} unique addresses` +
  ` (agent resolved: ${icdAgentResolved}/${instanceCount + invocationCount} instances+invocations;` +
  ` ${instanceCount} instances, ${invocationCount} invocations)`,
);

// Edge-type breakdown for quick verification.
const edgeTypeCounts = new Map();
for (const e of edges) edgeTypeCounts.set(e.edgeType, (edgeTypeCounts.get(e.edgeType) ?? 0) + 1);
console.log("  edge type breakdown:");
for (const [et, count] of [...edgeTypeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${et.padEnd(36)} ${count}`);
}

// ---------------------------------------------------------------------------
// Phase 2.7: Active Data table entity extraction
//
// Parses three Active Data tables that contain named actors not captured by
// the prose-pattern phases above:
//   - Current Aligned Delegates  (5f584db8) — delegate_org, is_active=1
//   - Derecognized Delegates     (e7aec672) — delegate_org, is_active=0
//   - SRC Membership Registry    (d9c6ed16) — src_member, is_active=1
//
// For existing delegate_org entities (bootstrapped from chainlog addresses),
// enriches meta with forum_url and updates has_address edge role metadata.
// Creates new entities for delegates absent from the chainlog (e.g. BLUE,
// Cloaky) and registers their addresses in addressesAtlas + addressesRaw so
// Phase 3 picks them up in addressRows.
// ---------------------------------------------------------------------------
{
  const CURRENT_DELEGATES_UUID  = "5f584db8-f8d8-4118-988c-b2bc3f68ceb7";
  const DERECOGNIZED_UUID       = "e7aec672-ed19-4329-aaf7-736950be2eb7";
  const SRC_UUID                = "d9c6ed16-5b0d-4a6f-bb43-387398090afc";
  const FORUM_ACCOUNTS_UUID     = "b71564fd-22e0-4c69-99d1-5b23fc1fa329"; // A.2.7.1.1.1.1.4.0.6.1
  const BREACH_REGISTRY_UUID    = "1ddd9cf6-3f93-4a33-8c1d-80405eec1ffb"; // A.1.6.6.1.3.0.6.1
  // Tables we deliberately do not extract (the drift detector skips them):
  // Registered Spell Checklists — external GitHub URLs, no graph value.
  const KNOWN_UNEXTRACTED_TABLES = new Set([
    "93f5b36b-06a7-4282-9fd7-14e0cbafd08e", // A.1.10.2.5.1.3.2.0.6.1
  ]);

  // Reverse map: address (no chain suffix) → entity id, from existing has_address edges
  const addrToEntityId = new Map();
  for (const edge of edges) {
    if (edge.edgeType === "has_address" && edge.fromType === "entity") {
      addrToEntityId.set(edge.toId.split(":")[0], edge.fromId);
    }
  }
  const entityById = new Map([...entityMap.values()].map((e) => [e.id, e]));

  function slugToId(slug) {
    const h = crypto.createHash("sha256").update(slug).digest("hex");
    return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
  }

  function addTableEntity(slug, name, et, isActive, defDocId, meta) {
    const id = slugToId(slug);
    const entity = {
      id,
      slug,
      name,
      entity_type: et,
      subtype: null,
      defining_doc_id: defDocId,
      is_active: isActive,
      meta: JSON.stringify(meta),
    };
    entityMap.set(slug, entity);
    entityById.set(id, entity);
    return entity;
  }

  function addTableEdge(fromId, fromType, toId, toType, edgeType, meta) {
    edges.push({ fromId, fromType, toId, toType, edgeType, meta: meta ? JSON.stringify(meta) : undefined });
  }

  let enriched = 0, created = 0, derecognized = 0, srcMembers = 0;
  const skyGovernance = entityMap.get("sky-governance");

  // --- Table 1: Current Aligned Delegates ---
  const delegatesDoc = docById.get(CURRENT_DELEGATES_UUID);
  if (delegatesDoc) {
    for (const row of parseMarkdownTable(delegatesDoc.content ?? "")) {
      const name = row["Delegate Name"]?.trim();
      if (!name) continue;
      const eaAddr = extractEthAddresses(row["EA Address"] ?? "")[0];
      const contractAddr = extractEthAddresses(row["Delegation Contract"] ?? "")[0];
      const forumUrl = extractUrl(row["Forum Post"] ?? "");
      if (!eaAddr) continue;

      const existingId = addrToEntityId.get(eaAddr);
      const entity = existingId ? entityById.get(existingId) : null;

      if (entity) {
        // Enrich: add forum_url to meta, update has_address edge roles.
        // Also upgrade ecosystem_actor → delegate_org (e.g. entities that appear
        // in the ERG list get created as ecosystem_actor first; delegate table wins).
        if (entity.entity_type === "ecosystem_actor") entity.entity_type = "delegate_org";
        const m = JSON.parse(entity.meta ?? "{}");
        if (forumUrl) m.forum_url = forumUrl;
        entity.meta = JSON.stringify(m);

        for (const edge of edges) {
          if (edge.edgeType !== "has_address" || edge.fromId !== entity.id) continue;
          const addr = edge.toId.split(":")[0];
          if (addr === eaAddr) edge.meta = JSON.stringify({ role: "ea_address" });
          else if (contractAddr && addr === contractAddr) edge.meta = JSON.stringify({ role: "delegation_contract" });
        }
        enriched++;
      } else {
        // New entity — register addresses, emit has_address edges
        const s = slugify(name);
        const ent = addTableEntity(s, name, "delegate_org", 1, CURRENT_DELEGATES_UUID, {
          source: "active_data_table",
          forum_url: forumUrl,
        });
        for (const [addr, role] of [[eaAddr, "ea_address"], [contractAddr, "delegation_contract"]]) {
          if (!addr) continue;
          if (!addressesAtlas[addr]) {
            const label = role === "ea_address" ? name : `${name} Delegation Contract`;
            addressesAtlas[addr] = { chain: "ethereum", roles: ["delegate"], entityLabel: label };
            addressesRaw[addr] = { ...addressesAtlas[addr], label, aliases: [] };
          }
          addTableEdge(ent.id, "entity", `${addr}:ethereum`, "address", "has_address", { role });
        }
        created++;
      }

      const rowEntityId = entity?.id ?? entityMap.get(slugify(name))?.id;
      addTableEdge(rowEntityId, "entity", CURRENT_DELEGATES_UUID, "doc", "listed_in", null);
      // Inclusion in this registry IS Aligned Delegate recognition (Pattern 10).
      // The doc used to be a prose list (handled in Phase 2 as a fallback);
      // as a table, the role edges are emitted here.
      if (rowEntityId && skyGovernance) {
        edges.push({
          fromId: rowEntityId, fromType: "entity", toId: skyGovernance.id, toType: "entity",
          edgeType: "aligned_delegate_for", sourceDocNos: [delegatesDoc.doc_no],
        });
      }
    }
  }

  // --- Table 2: Derecognized Alignment Conservers ---
  const derecognizedDoc = docById.get(DERECOGNIZED_UUID);
  if (derecognizedDoc) {
    for (const row of parseMarkdownTable(derecognizedDoc.content ?? "")) {
      const name = row["Identity"]?.trim();
      if (!name || name === "-") continue;
      const s = slugify(name);
      if (entityMap.has(s)) continue;
      const ent = addTableEntity(s, name, "delegate_org", 0, DERECOGNIZED_UUID, {
        source: "active_data_table",
        derecognition_date: row["Date"]?.trim(),
        forum_url: extractUrl(row["Reasoning Post"] ?? ""),
      });
      addTableEdge(ent.id, "entity", DERECOGNIZED_UUID, "doc", "listed_in", null);
      derecognized++;
    }
  }

  // --- Table 3: SRC Membership Registry ---
  const srcDoc = docById.get(SRC_UUID);
  if (srcDoc) {
    for (const row of parseMarkdownTable(srcDoc.content ?? "")) {
      const name = row["Name or Alias"]?.trim();
      if (!name) continue;
      const s = slugify(name);
      if (entityMap.has(s)) continue;
      const ent = addTableEntity(s, name, "src_member", 1, SRC_UUID, {
        source: "active_data_table",
        domain_expertise: row["Domain Expertise"]?.trim(),
        start_date: row["Start Date"]?.trim(),
        term_status: row["Term Status"]?.trim(),
        standing: row["Standing"]?.trim(),
      });
      const govRaw = row["Verified Governance Address"]?.trim();
      if (govRaw && govRaw !== "N/A") {
        for (const addr of extractEthAddresses(govRaw)) {
          if (!addressesAtlas[addr]) {
            addressesAtlas[addr] = { chain: "ethereum", roles: ["governance"], entityLabel: name };
            addressesRaw[addr] = { ...addressesAtlas[addr], label: name, aliases: [] };
          }
          addTableEdge(ent.id, "entity", `${addr}:ethereum`, "address", "has_address", { role: "governance" });
        }
      }
      addTableEdge(ent.id, "entity", SRC_UUID, "doc", "listed_in", null);
      srcMembers++;
    }
  }

  // --- Table 4: Current Authorized Forum Accounts ---
  // Columns: Entity Name | Role | Entity Handle | Handles of Authorized
  // Representatives. Row entities get meta.forum_handle; each rep handle
  // becomes an ecosystem_actor (st="individual") with an authorized_rep_for
  // edge to the org. Reps that resolve to existing orgs (e.g. "SoterLabs" for
  // Amatsu) reuse that entity rather than creating an individual.
  let forumRows = 0, forumReps = 0;
  const forumDoc = docById.get(FORUM_ACCOUNTS_UUID);
  if (forumDoc) {
    const nameIndex = buildNameIndex(entityMap);
    const registerInIndex = (e) => {
      for (const key of [normalizeKey(e.name), normalizeKey(e.slug)])
        if (key && !nameIndex.has(key)) nameIndex.set(key, e);
    };
    for (const row of parseMarkdownTable(forumDoc.content ?? "")) {
      const name = row["Entity Name"]?.trim();
      if (!name || name === "N/A") continue;
      let entity = nameIndex.get(normalizeKey(name));
      if (!entity) {
        entity = addTableEntity(slugify(name), name, "ecosystem_actor", 1, FORUM_ACCOUNTS_UUID, {
          source: "forum_accounts_table",
        });
        registerInIndex(entity);
      }
      const handle = row["Entity Handle"]?.trim();
      const role = row["Role"]?.trim();
      const m = JSON.parse(entity.meta ?? "{}");
      if (handle && handle !== "N/A") m.forum_handle = handle;
      if (role && role !== "N/A") m.forum_role = role;
      entity.meta = JSON.stringify(m);
      addTableEdge(entity.id, "entity", FORUM_ACCOUNTS_UUID, "doc", "listed_in", {
        handle: handle !== "N/A" ? handle : undefined,
        role: role !== "N/A" ? role : undefined,
      });
      forumRows++;

      const repsRaw = (row["Handles of Authorized Representatives"] ?? "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .trim();
      if (!repsRaw || repsRaw === "N/A") continue;
      for (const handleName of repsRaw.split(/,\s*/).map((s) => s.trim()).filter(Boolean)) {
        let rep = nameIndex.get(normalizeKey(handleName));
        if (!rep) {
          rep = addTableEntity(slugify(handleName), handleName, "ecosystem_actor", 1, FORUM_ACCOUNTS_UUID, {
            source: "forum_accounts_table",
            forum_handle: handleName,
          });
          rep.subtype = "individual";
          registerInIndex(rep);
        }
        if (rep.id === entity.id) continue;
        addTableEdge(rep.id, "entity", entity.id, "entity", "authorized_rep_for", {
          handle: handleName,
        });
        forumReps++;
      }
    }
  } else {
    console.warn(`  Phase 2.7: Forum Accounts doc (${FORUM_ACCOUNTS_UUID}) not found`);
  }

  // --- Table 5: Aligned Delegate Breach Registry ---
  // Columns: Date | Identity | Breach Tier | Reasoning Post. Rows are dated
  // governance events attached to existing delegate entities via listed_in.
  let breaches = 0;
  const breachDoc = docById.get(BREACH_REGISTRY_UUID);
  if (breachDoc) {
    const nameIndex = buildNameIndex(entityMap);
    for (const row of parseMarkdownTable(breachDoc.content ?? "")) {
      const identity = row["Identity"]?.trim();
      if (!identity) continue;
      let entity = nameIndex.get(normalizeKey(identity));
      if (!entity) {
        entity = addTableEntity(slugify(identity), identity, "delegate_org", 1, BREACH_REGISTRY_UUID, {
          source: "breach_registry_table",
        });
        nameIndex.set(normalizeKey(identity), entity);
      }
      addTableEdge(entity.id, "entity", BREACH_REGISTRY_UUID, "doc", "listed_in", {
        date: row["Date"]?.trim(),
        breach_tier: row["Breach Tier"]?.trim(),
        reasoning_url: extractUrl(row["Reasoning Post"] ?? "") ?? undefined,
      });
      breaches++;
    }
  } else {
    console.warn(`  Phase 2.7: Breach Registry doc (${BREACH_REGISTRY_UUID}) not found`);
  }

  console.log(
    `\n  Phase 2.7: ${enriched} delegates enriched, ${created} created,` +
    ` ${derecognized} derecognized, ${srcMembers} SRC members,` +
    ` ${forumRows} forum rows (${forumReps} rep edges), ${breaches} breaches`,
  );

  // --- Drift detector: Active Data tables we are not extracting ---
  // Fires when any Active Data doc outside the handled/known-ignored sets
  // gains table rows — e.g. the 29 per-instance payment ledgers (all empty
  // today) or the Registered Multisigs registry. Loud by design.
  const HANDLED_TABLE_UUIDS = new Set([
    CURRENT_DELEGATES_UUID, DERECOGNIZED_UUID, SRC_UUID, FORUM_ACCOUNTS_UUID, BREACH_REGISTRY_UUID,
  ]);
  let driftWarnings = 0;
  for (const d of allDocs) {
    if (d.type !== "Active Data") continue;
    if (HANDLED_TABLE_UUIDS.has(d.id) || KNOWN_UNEXTRACTED_TABLES.has(d.id)) continue;
    const rows = parseMarkdownTable(d.content ?? "").filter((row) =>
      Object.values(row).some((v) => v && v.trim()),
    );
    if (!rows.length) continue;
    driftWarnings++;
    console.warn(
      `  [drift] unextracted Active Data table: ${d.doc_no} "${d.title}" (${d.id}, ${rows.length} rows)`,
    );
  }
  if (driftWarnings) {
    console.warn(`  [drift] ${driftWarnings} Active Data table(s) contain rows but are not extracted`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2.8: Multisigs, transfer events, integration partners
//
// Runs after 2.7 so that forum-account individuals (e.g. VoteWizard, ldr)
// already exist when multisig signer rosters reference them, and after
// Phase 2 so bare role references ("Core GovOps") resolve via role edges.
// ---------------------------------------------------------------------------
{
  function addPatternEntity(slug, name, entity_type, subtype, defining_doc_id, meta) {
    const existing = entityMap.get(slug);
    if (existing) return existing;
    const h = crypto.createHash("sha256").update(slug).digest("hex");
    const ent = {
      id: `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${h.slice(16,20)}-${h.slice(20,32)}`,
      slug,
      name,
      entity_type,
      subtype: subtype ?? null,
      defining_doc_id: defining_doc_id ?? null,
      is_active: 1,
      meta: meta ? JSON.stringify(meta) : null,
    };
    entityMap.set(slug, ent);
    return ent;
  }

  // --- Integration partners (from ICD params collected in Phase 2.5) ---
  // Each distinct "Integration Partner Name" value becomes an ecosystem_actor
  // (st="integration_partner") with one integration_partner_of edge per
  // instance it partners on.
  let partnerEdges = 0;
  const partnerEntities = new Set();
  for (const { partner, instance, srcDocNo } of ibPartnerLinks) {
    let ent = entityMap.get(slugify(partner));
    if (!ent) {
      ent = addPatternEntity(slugify(partner), partner, "ecosystem_actor", "integration_partner", null, {
        source: "integration_partner_param",
        source_doc_no: srcDocNo,
      });
    } else if (ent.entity_type === "ecosystem_actor" && !ent.subtype) {
      ent.subtype = "integration_partner";
    }
    partnerEntities.add(ent.id);
    edges.push({
      fromId: ent.id, fromType: "entity", toId: instance.id, toType: "entity",
      edgeType: "integration_partner_of", sourceDocNos: [srcDocNo],
    });
    partnerEdges++;
  }
  console.log(`  Phase 2.8: ${partnerEntities.size} integration partners (${partnerEdges} edges)`);

  // --- Multisigs (Pattern 17) ---
  const msStats = extractMultisigs(allDocs, docById, docByDocNo, entityMap, edges).run(addPatternEntity);
  console.log(
    `  Phase 2.8: ${msStats.roots} multisigs, ${msStats.signerEdges} signer_of,` +
    ` ${msStats.modifierEdges} can_modify_signers_of, ${msStats.created} new signer entities` +
    (msStats.warnings ? `, ${msStats.warnings} WARNINGS` : ""),
  );

  // --- Transfer/grant events (Pattern 18) ---
  const txStats = extractTransfers(allDocs, docById, docByDocNo, entityMap, edges, addPatternEntity);
  console.log(
    `  Phase 2.8: funds_transfer — ${txStats.grants} grants, ${txStats.genesis} genesis` +
    ` (${txStats.planned} planned), ${txStats.authorizations} authorizations` +
    (txStats.warnings ? `, ${txStats.warnings} WARNINGS` : ""),
  );
}

// ---------------------------------------------------------------------------
// Phase 3: Prepare rows
// ---------------------------------------------------------------------------

const entityRows = [...entityMap.values()].map((e) => ({
  id: e.id,
  slug: e.slug,
  name: e.name,
  entity_type: e.entity_type,
  subtype: e.subtype ?? null,
  defining_doc_id: e.defining_doc_id ?? null,
  is_active: e.is_active ?? 1,
  meta: e.meta ?? null,
}));

const docRows = allDocs.map((d) => ({
  id: d.id,
  doc_no: d.doc_no,
  title: d.title,
  type: d.type,
  depth: d.depth ?? 0,
  parent_id: d.parentId ?? null,
  content: (d.content ?? "").slice(0, 50000),
  ord: d.order ?? 0,
}));

const addressRows = Object.entries(addressesRaw).map(([addr, info]) => {
  const chain = info.chain ?? "ethereum";
  const cs = chainStateByAddr[addr.toLowerCase()];
  const s = info.label ? slugify(info.label) : null;
  return {
    address: addr.toLowerCase(),
    chain,
    label: info.label ?? null,
    chainlog_id: info.chainlogId ?? null,
    etherscan_name: info.etherscanName ?? null,
    is_contract: info.isContract ? 1 : 0,
    is_proxy: info.isProxy ? 1 : 0,
    implementation: info.implementation ?? null,
    roles: JSON.stringify(info.roles ?? []),
    aliases: JSON.stringify(info.aliases ?? []),
    expected_tokens: JSON.stringify(info.expectedTokens ?? []),
    chain_state: cs ? JSON.stringify(cs.values) : null,
    state_block: cs?.block ?? null,
    entity_id: s ? (entityMap.get(s)?.id ?? null) : null,
  };
});

const edgeRows = edges.map((e, i) => ({
  id: i + 1,
  from_id: e.fromId,
  from_type: e.fromType,
  to_id: e.toId,
  to_type: e.toType,
  edge_type: e.edgeType,
  source_doc_nos: e.sourceDocNos?.length ? JSON.stringify(e.sourceDocNos) : null,
  weight: 1.0,
  meta: e.meta ?? null,
}));

// ---------------------------------------------------------------------------
// Phase 4: Write JSON outputs (always); optionally sync to D1.
// ---------------------------------------------------------------------------

console.log("\nRow counts:");
console.log(`  entities: ${entityRows.length}`);
console.log(`  docs:     ${docRows.length}`);
console.log(`  addresses:${addressRows.length}`);
console.log(`  edges:    ${edgeRows.length}`);

// graph.json — full export for local inspection / debugging
fs.writeFileSync(
  path.join(ROOT, "public/graph.json"),
  JSON.stringify({
    meta: {
      atlasCommit,
      schemaVersion: 4,
      counts: {
        entities: entityRows.length,
        docs: docRows.length,
        addresses: addressRows.length,
        edges: edgeRows.length,
      },
    },
    entities: entityRows,
    edges: edgeRows,
  }),
);
console.log("  public/graph.json written");

// relations.json — lean browser payload.
// Filter rules:
//   - Drop parent_of edges (the tree is already in docs.json).
//   - Drop ecosystem_actor entities: too many, mostly orphans with no incoming edges.
//     Any edge referencing a dropped entity is also dropped to avoid dangling ids.
//   - Keep ecosystem_actors referenced by load-bearing role/RP edges so their
//     relationships survive (e.g. BA Labs → Core Council Risk Advisor role).
const OMIT_ENTITY_TYPES = new Set(["ecosystem_actor"]);
const KEEP_ACTOR_EDGE_TYPES = new Set([
  "holds_role_for",
  "responsible_party_for",
  // multisig + integration-partner actors stay visible in the UI
  "signer_of",
  "can_modify_signers_of",
  "integration_partner_of",
]);
// Edge types that are graph.json-only (chatbot/MCP data, not browser UI):
// funds_transfer is event data; authorized_rep_for points at forum-handle
// individuals that would clutter the canvas.
const OMIT_EDGE_TYPES = new Set(["parent_of", "funds_transfer", "authorized_rep_for"]);
const pinnedActorIds = new Set(
  edges
    .filter((e) => KEEP_ACTOR_EDGE_TYPES.has(e.edgeType) && e.fromType === "entity")
    .map((e) => e.fromId),
);
const keptEntityIds = new Set(
  entityRows
    .filter((e) => !OMIT_ENTITY_TYPES.has(e.entity_type) || pinnedActorIds.has(e.id))
    .map((e) => e.id),
);

const relationEdges = edges
  .filter((e) => !OMIT_EDGE_TYPES.has(e.edgeType))
  .filter((e) => {
    if (e.fromType === "entity" && !keptEntityIds.has(e.fromId)) return false;
    if (e.toType === "entity" && !keptEntityIds.has(e.toId)) return false;
    return true;
  })
  .map((e) => {
    const out = {
      f: e.fromId,
      ft: e.fromType,
      t: e.toId,
      tt: e.toType,
      e: e.edgeType,
      s: e.sourceDocNos?.length ? e.sourceDocNos : undefined,
    };
    if (e.meta) out.m = e.meta;
    return out;
  });

const relationEntities = entityRows
  .filter((e) => keptEntityIds.has(e.id))
  .map((e) => {
    const out = {
      id: e.id,
      slug: e.slug,
      name: e.name,
      et: e.entity_type,
      st: e.subtype,
      did: e.defining_doc_id,
    };
    if (e.meta) out.m = e.meta;
    return out;
  });

fs.writeFileSync(
  path.join(ROOT, "public/relations.json"),
  JSON.stringify({
    meta: {
      atlasCommit,
      schemaVersion: 4,
      counts: { entities: relationEntities.length, edges: relationEdges.length },
    },
    entities: relationEntities,
    edges: relationEdges,
  }),
);
const relSize = fs.statSync(path.join(ROOT, "public/relations.json")).size;
console.log(`  public/relations.json written (${(relSize / 1024).toFixed(0)} KB)`);

// ---------------------------------------------------------------------------
// Phase 4.5: Enrich addresses.atlas.json with graph-derived annotations
//
// Mutates addressesAtlas in place (the atlas-only artifact). Never touches
// addresses.json (on-chain data). Five passes, each only fills gaps:
//   4.5a — ICD-param: roles + entityLabel from structured ICD params
//   4.5b — Entity-linked: entityLabel from graph entities via labelToAddresses
//   4.5c — Parent-titled: "Address" docs → parent doc title
//   4.5d — Doc-titled: any address-bearing doc with a descriptive title
//   4.5e — Chainlog/Etherscan fallback: last resort from on-chain data
// ---------------------------------------------------------------------------
{
  let icdUpdated = 0, icdMissing = 0;
  let entityLabeled = 0, parentLabeled = 0, titleLabeled = 0, chainlogFallback = 0;

  // 4.5a
  for (const [addr, ann] of icdAnnotations) {
    const entry = addressesAtlas[addr];
    if (!entry) { icdMissing++; continue; }
    entry.roles = [...new Set([...ann.roles, ...(entry.roles ?? [])])];
    if (ann.entityLabel) entry.entityLabel = ann.entityLabel;
    icdUpdated++;
  }

  // 4.5b
  const { labelToAddresses } = entityContext;
  for (const [slug, addrList] of labelToAddresses) {
    const entity = entityMap.get(slug);
    if (!entity) continue;
    for (const { addr } of addrList) {
      const entry = addressesAtlas[addr];
      if (!entry || entry.entityLabel) continue;
      entry.entityLabel = entity.name;
      entityLabeled++;
    }
  }

  // 4.5c
  const GENERIC_TITLE = /^address(?:es)?$/i;
  for (const doc of allDocs) {
    if (!GENERIC_TITLE.test(doc.title.trim()) || !doc.addressRefs?.length) continue;
    const parentDocNo = doc.doc_no.split(".").slice(0, -1).join(".");
    const parentDoc = docByDocNo.get(parentDocNo);
    if (!parentDoc) continue;
    for (const addr of doc.addressRefs) {
      const entry = addressesAtlas[addr.toLowerCase()] ?? addressesAtlas[addr];
      if (!entry || entry.entityLabel) continue;
      entry.entityLabel = parentDoc.title;
      parentLabeled++;
    }
  }

  // 4.5d
  const SKIP_TITLE_D = /^address(?:es)?$|^parameters?$/i;
  for (const doc of allDocs) {
    if (!doc.addressRefs?.length || SKIP_TITLE_D.test(doc.title.trim())) continue;
    for (const addr of doc.addressRefs) {
      const entry = addressesAtlas[addr.toLowerCase()] ?? addressesAtlas[addr];
      if (!entry || entry.entityLabel) continue;
      entry.entityLabel = doc.title;
      titleLabeled++;
    }
  }

  // 4.5e: chainlog/Etherscan fallback — pull from on-chain file
  for (const [addr, entry] of Object.entries(addressesAtlas)) {
    if (entry.entityLabel) continue;
    const onChain = addressesOnChain[addr] ?? {};
    const fallback = onChain.chainlogId ?? onChain.etherscanName ?? null;
    if (fallback) { entry.entityLabel = fallback; chainlogFallback++; }
  }

  fs.writeFileSync(path.join(ROOT, "public/addresses.atlas.json"), JSON.stringify({ atlasCommit, addresses: addressesAtlas }));
  console.log(
    `  Atlas enrichment:` +
    ` ${icdUpdated} ICD` +
    (icdMissing ? ` (${icdMissing} not in prose)` : "") +
    `, ${entityLabeled} entity-linked` +
    `, ${parentLabeled} parent-titled` +
    `, ${titleLabeled} doc-titled` +
    `, ${chainlogFallback} chainlog-fallback`,
  );
}

console.log("\nDone.");
