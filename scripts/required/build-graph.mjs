#!/usr/bin/env node
/**
 * build-graph.mjs
 *
 * Pattern-driven extraction of the Atlas graph. Outputs live at repo root so
 * they're first-class artifacts for every consumer — the frontend loads
 * relations.json directly. (This previously named a `sync-d1.mjs` mirroring the
 * graph into D1 for the redlens-mcp Worker; no such script exists in this repo.)
 * See .claude/skills/parse-atlas/SKILL.md for the full relationship reference.
 *
 * Usage (from repo root):
 *   node scripts/required/build-graph.mjs
 *
 * Reads:
 *   public/docs.json
 *   public/addresses.atlas.json
 *   public/addresses.json
 *
 * Writes:
 *   public/graph.json           — full export for local inspection / D1 sync input
 *   public/relations.json       — lean browser payload
 *   public/addresses.atlas.json — enriched in place (Phase 4.5)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  slugify,
  makeEntity,
} from "../lib/graph-patterns.mjs";
import { checkGateTripwires, warnDriftCount } from "../lib/graph-tripwires.mjs";
import { extractMultisigs } from "../lib/graph-multisigs.mjs";
import { extractTransfers } from "../lib/graph-transfers.mjs";
import { extractBridges } from "../lib/graph-bridges.mjs";
import { extractOmni } from "../lib/graph-omni.mjs";
import { extractTransitions } from "../lib/graph-transitions.mjs";
import { extractEntities } from "../lib/graph-entities.mjs";
import { extractDocEdges } from "../lib/graph-doc-edges.mjs";
import { extractEntityEdges } from "../lib/graph-entity-edges.mjs";
import { extractActiveData } from "../lib/graph-active-data.mjs";
import { enrichAddresses } from "../lib/graph-address-enrich.mjs";
import {
  ETH_ADDR_RE,
  SOL_ADDR_RE,
  ETH_ADDR_EXACT_RE,
  SOL_ADDR_EXACT_RE,
  normalizeAddress,
  findTableContext,
} from "../lib/address-chains.mjs";
import {
  extractRoles,
  extractEntityLabel,
  extractExpectedTokens,
} from "../lib/address-annotate.mjs";
import { normalizeChainLabel } from "../lib/chains.mjs";
import { codeUnitCompare } from "../lib/natural-sort.mjs";
import { gitHead, stampAtlasCommit } from "../lib/atlas-commit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Isolation overrides (preview builds) — see build-index.mjs for the rationale.
// OUT_DIR holds the artifacts this build owns (docs/addresses.atlas in, graph/
// relations/addresses.atlas out). ONCHAIN_DIR holds addresses.json, reused
// from main, which a preview does NOT rebuild — it defaults to OUT_DIR so the
// main build reads it from public/ as before.
const ATLAS_SRC_DIR = process.env.ATLAS_SRC_DIR ?? path.join(ROOT, "vendor/next-gen-atlas");
const OUT_DIR = process.env.ATLAS_OUT_DIR ?? path.join(ROOT, "public");
const ONCHAIN_DIR = process.env.ATLAS_ONCHAIN_DIR ?? OUT_DIR;

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

console.log("Loading docs.json…");
const rawDocs = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "docs.json"), "utf8"));
// Prefer docs.json's stamp over git: the runtime image has no atlas checkout,
// so `git rev-parse` would write "unknown" and the in-process updater could
// never converge live SHA to sync_state.atlas_sha.
const atlasCommit = stampAtlasCommit(process.env.ATLAS_COMMIT, rawDocs.atlasCommit, gitHead(ATLAS_SRC_DIR));
const allDocs = Object.values(rawDocs.nodes);
console.log(`  ${allDocs.length} docs`);

const docById = new Map(allDocs.map((d) => [d.id, d]));
const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));

// Silent-collapse tripwires: a renumber/rename that zeroes a structural gate
// produces no error anywhere — only these [drift] stderr lines.
checkGateTripwires(allDocs);

// Load both address artifacts and build a merged in-memory view for graph
// extraction. Phase 4.5 writes enrichments back to addresses.atlas.json only;
// addresses.json (on-chain data) is never mutated by build-graph.
console.log("Loading address artifacts…");
const addressesAtlas = JSON.parse(
  fs.readFileSync(path.join(OUT_DIR, "addresses.atlas.json"), "utf8"),
).addresses;
const addressesOnChain = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ONCHAIN_DIR, "addresses.json"), "utf8"));
  } catch {
    return {};
  }
})();

function resolveLabel(atlas, onChain) {
  return onChain.chainlogId ?? atlas.entityLabel ?? onChain.etherscanName ?? null;
}

// Populated by the Phase 2.6 annotation pass below (which overwrites every key
// before Phase 1 entity extraction reads it). No pre-population needed here.
const addressesRaw = {};
console.log(`  ${Object.keys(addressesAtlas).length} atlas, ${Object.keys(addressesOnChain).length} on-chain`);

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
  const agg = new Map(); // addr → { labels: Set, roles: Set, tokens: Set }

  for (const doc of allDocs) {
    const content = doc.content ?? "";

    ETH_ADDR_RE.lastIndex = 0;
    let m;
    while ((m = ETH_ADDR_RE.exec(content)) !== null) {
      const key = normalizeAddress(m[0]);
      const table = findTableContext(content, m.index);
      let g = agg.get(key);
      if (!g) { g = { labels: new Set(), roles: new Set(), tokens: new Set() }; agg.set(key, g); }
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
      if (!g) { g = { labels: new Set(), roles: new Set(), tokens: new Set() }; agg.set(key, g); }
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

    // Chain is deliberately NOT recomputed here. build-index owns it: it runs
    // the same prose detection *plus* the doc-title/ancestor walk this pass
    // can't see, and applies the same prefer-a-specific-chain aggregation
    // across docs. Re-deriving it from content alone here both discarded the
    // heading signal and let a single stray mention win globally — one doc
    // whose prose says "Gnosis Protocol" pinned the address to Gnosis Chain
    // however many other docs placed it on ethereum. Phase 4.5a still applies
    // the ICD-stated chain on top, which outranks both.

    // Entity label: pick longest non-generic candidate
    const labelPool = [...g.labels];
    const candidates = labelPool.filter((l) => !GENERIC_LABELS.has(l.toLowerCase()));
    const pool = candidates.length ? candidates : labelPool;
    pool.sort((a, b) => b.length - a.length || codeUnitCompare(a, b));
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

const normalizeChain = (raw) => normalizeChainLabel(raw, "icd-chain");

// Returns the chain the ICD itself names, or null when it names none. The
// caller supplies the default: "named nothing" must stay distinguishable from
// "named ethereum", because Phase 4.5a writes this back over the chain
// build-index detected and would otherwise reset every unlabelled ICD address
// to ethereum.
function icdParamChain(key, params) {
  if (key.startsWith("Token Address (")) {
    const m = key.match(/\(([^)]+)\)/);
    if (m && !/ERC4626/i.test(m[1])) return normalizeChain(m[1]);
  }
  const raw = params["Integration Partner Chain"]?.[0] ?? params["Network"]?.[0];
  return raw ? normalizeChain(raw) : null;
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
    const isEvm = ETH_ADDR_EXACT_RE.test(value);
    const isSol = !isEvm && SOL_ADDR_EXACT_RE.test(value);
    if (!isEvm && !isSol) continue;

    const addr = normalizeAddress(value);
    const namedChain = isSol ? "solana" : icdParamChain(key, params);
    const chain = namedChain ?? "ethereum";
    const label = icdParamLabel(key, params, agentName, ent.name);

    if (!icdAnnotations.has(addr)) {
      icdAnnotations.set(addr, { roles: [role], entityLabel: label, chain: namedChain });
    } else {
      const existing = icdAnnotations.get(addr);
      if (!existing.roles.includes(role)) existing.roles.push(role);
      existing.chain ??= namedChain;
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
warnDriftCount("ICD-param agent unresolved", instanceCount + invocationCount - icdAgentResolved);

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
// Parses Active Data tables that contain named actors not captured by the
// prose-pattern phases above (Current Aligned Delegates, Derecognized
// Delegates, SRC Membership Registry, Current Authorized Forum Accounts,
// Aligned Delegate Breach Registry) plus a drift detector for every other
// Active Data table in the atlas. See scripts/lib/graph-active-data.mjs and
// .claude/skills/parse-atlas/SKILL.md Pattern 16.
// ---------------------------------------------------------------------------
extractActiveData(allDocs, docById, entityMap, edges, addressesAtlas, addressesRaw);

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
    const ent = makeEntity(slug, name, entity_type, { subtype, defining_doc_id, meta });
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
  // Detection keys on child TITLES ("…Signers" + "…Number Of Signers") and
  // dies before any per-root warning if those templates change — only this
  // notices every multisig disappearing at once.
  if (msStats.roots === 0) {
    console.warn(
      "  [drift] tripwire: 0 multisig roots detected — the child-title suffixes in " +
        "scripts/lib/graph-multisigs.mjs childSuffix() no longer match the atlas",
    );
  }

  // --- Transfer/grant events (Pattern 18) ---
  const txStats = extractTransfers(allDocs, docById, docByDocNo, entityMap, edges, addPatternEntity);
  console.log(
    `  Phase 2.8: funds transfer data — ${txStats.grants} grants, ${txStats.genesis} genesis` +
    ` (${txStats.planned} planned), ${txStats.authorizations} authorizations, ${txStats.dataGaps} gaps` +
    `, ${txStats.allocations} allocations, ${txStats.budgetTransfers} budget transfers` +
    (txStats.warnings ? `, ${txStats.warnings} WARNINGS` : ""),
  );

  // --- Bridge validator sets (Pattern 21) ---
  const brStats = extractBridges(allDocs, docById, docByDocNo, entityMap, edges, addPatternEntity);
  console.log(
    `  Phase 2.8: ${brStats.roots} bridges, ${brStats.validatorEdges} validator_of,` +
    ` ${brStats.created} new validator entities` +
    (brStats.warnings ? `, ${brStats.warnings} WARNINGS` : ""),
  );

  // --- Prime Agent omni-doc governance metadata (Pattern 22) ---
  const omStats = extractOmni(allDocs, docById, docByDocNo, entityByDocId, edges);
  console.log(
    `  Phase 2.8: ${omStats.channels} governance_channel, ${omStats.emergencies} emergency_response` +
    (omStats.warnings ? `, ${omStats.warnings} WARNINGS` : ""),
  );

  // --- Pending operational transitions (Pattern 23) ---
  const trStats = extractTransitions(allDocs, docById, docByDocNo, entityMap, edges);
  console.log(
    `  Phase 2.8: ${trStats.count} pending_transition` +
    (trStats.warnings ? `, ${trStats.warnings} WARNINGS` : ""),
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

// Only the counts are consumed downstream (row-count logging + graph.json
// meta) — count directly instead of materializing the row objects.
const docCount = allDocs.length;
const addressCount = Object.keys(addressesRaw).length;

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
console.log(`  docs:     ${docCount}`);
console.log(`  addresses:${addressCount}`);
console.log(`  edges:    ${edgeRows.length}`);

// graph.json — full export for local inspection / debugging
fs.writeFileSync(
  path.join(OUT_DIR, "graph.json"),
  JSON.stringify({
    meta: {
      atlasCommit,
      schemaVersion: 4,
      counts: {
        entities: entityRows.length,
        docs: docCount,
        addresses: addressCount,
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
  "process_step_responsible_party_for",
  "duty_for",
  // multisig + integration-partner + bridge-validator actors stay visible in the UI
  "signer_of",
  "can_modify_signers_of",
  "integration_partner_of",
  "validator_of",
]);
// Edge types that are graph.json-only (chatbot/MCP data, not browser UI):
// funds_transfer / funds_authorization / funds_data_gap are event/silence data;
// authorized_rep_for points at forum-handle individuals that would clutter the
// canvas; pending_transition is chat/MCP handoff data. governance_channel /
// emergency_response stay in relations.json — they feed the Radar "Contact"
// section (doc→entity, so they never reach the entity↔entity canvas anyway).
const OMIT_EDGE_TYPES = new Set([
  "parent_of",
  "funds_transfer",
  "funds_authorization",
  "funds_data_gap",
  "authorized_rep_for",
  "pending_transition",
]);
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
  path.join(OUT_DIR, "relations.json"),
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
const relSize = fs.statSync(path.join(OUT_DIR, "relations.json")).size;
console.log(`  relations.json written (${(relSize / 1024).toFixed(0)} KB)`);

// ---------------------------------------------------------------------------
// Phase 4.5: Enrich addresses.atlas.json with graph-derived annotations
//
// Mutates addressesAtlas in place (the atlas-only artifact). Never touches
// addresses.json (on-chain data). Five passes, each only fills gaps — see
// scripts/lib/graph-address-enrich.mjs for the pass-by-pass breakdown.
// ---------------------------------------------------------------------------
{
  const { labelToAddresses } = entityContext;
  const stats = enrichAddresses({
    allDocs,
    docByDocNo,
    addressesAtlas,
    addressesOnChain,
    icdAnnotations,
    entityMap,
    labelToAddresses,
  });

  fs.writeFileSync(path.join(OUT_DIR, "addresses.atlas.json"), JSON.stringify({ atlasCommit, addresses: addressesAtlas }));
  console.log(
    `  Atlas enrichment:` +
    ` ${stats.icdUpdated} ICD` +
    (stats.icdMissing ? ` (${stats.icdMissing} not in prose)` : "") +
    (stats.icdRechained ? ` [${stats.icdRechained} chain corrected]` : "") +
    `, ${stats.entityLabeled} entity-linked` +
    `, ${stats.parentLabeled} parent-titled` +
    `, ${stats.titleLabeled} doc-titled` +
    `, ${stats.chainlogFallback} chainlog-fallback`,
  );
}

console.log("\nDone.");
