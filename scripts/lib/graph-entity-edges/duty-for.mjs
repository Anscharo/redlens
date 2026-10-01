// 2s-ter. duty_for (acting-role duty discovery). GovOps and the Executor Agent
// have no dedicated "Duties" scope the way Facilitators do (A.1.7); their duties
// are scattered across primitive, process and agent-artifact docs. Every doc is
// scanned for each acting role (pattern taxonomy in graph-duties.mjs), emitting one
// duty_for edge per (doc, role) to the org holding the role.
import { DUTY_ROLES, findRoleDuties } from "../graph-duties.mjs";
import { warnDriftCount } from "../graph-tripwires.mjs";
import { dutyHolders, resolveDutyEntities } from "./duty-holders.mjs";

const ROLE_ASSIGNMENT_EDGE_TYPES = new Set([
  "operational_govops_for",
  "core_govops_for",
  "operational_facilitator_for",
  "core_facilitator_for",
  "operational_executor_agent_for",
  "core_executor_agent_for",
]);

// Narrative/research types never carry an operative duty: Scenarios illustrate a
// misalignment finding, Annotations define a rubric element, Needed Research poses
// an open question (riskRules.ts applies the same exclusion). ADCs are covered by
// 2s; Type Specifications name roles pervasively ("The Facilitator Action Tenet
// Type") but task no one.
const SKIPPED_TYPES = new Set([
  "Active Data Controller",
  "Type Specification",
  "Scenario",
  "Scenario Variation",
  "Annotation",
  "Needed Research",
]);

/**
 * Docs never scanned besides SKIPPED_TYPES: role-assignment docs (they name the
 * holder, they impose no duty) and 2s-bis targets (the structural edge beats a
 * fuzzy content match).
 */
function skippedDocIds(ctx) {
  const ids = new Set();
  for (const e of ctx.edges) {
    if (e.edgeType === "process_step_responsible_party_for") ids.add(e.toId);
    if (!ROLE_ASSIGNMENT_EDGE_TYPES.has(e.edgeType)) continue;
    const d = e.sourceDocNos?.[0] ? ctx.docByDocNo.get(e.sourceDocNos[0]) : null;
    if (d) ids.add(d.id);
  }
  return ids;
}

const isCandidate = (d, skipIds) =>
  // The Preamble (A.0.*) defines roles; it assigns no duties.  // fragile: doc_no prefix
  !d.doc_no.startsWith("A.0.") && !SKIPPED_TYPES.has(d.type) && !skipIds.has(d.id);

function emitDuties(ctx, holders, role, d, stats) {
  for (const duty of findRoleDuties(role, d.title, d.content, holders.orgsByRole.get(role.key))) {
    const entities = resolveDutyEntities(ctx, holders, role, d, duty);
    if (!entities.length) {
      stats.unresolved++;
      continue;
    }
    const meta = JSON.stringify({ role_declared: duty.role_declared, match: duty.match, quote: duty.quote });
    for (const entity of entities) ctx.addEdge(entity.id, "entity", d.id, "doc", "duty_for", [d.doc_no], meta);
    stats.edges += entities.length;
    stats.byMatch.set(duty.match, (stats.byMatch.get(duty.match) ?? 0) + 1);
  }
}

function report(role, s) {
  const byMatch = ["title", "active", "passive", "phrase", "org"].map((k) => `${s.byMatch.get(k) ?? 0} ${k}`);
  console.log(`  duty_for[${role.key}]: ${s.edges} edges (${byMatch.join(", ")}), ${s.unresolved} unresolved`);
  warnDriftCount(`duty_for[${role.key}] unresolved`, s.unresolved);
  if (s.edges === 0) {
    console.warn(
      `  [drift] tripwire: duty_for[${role.key}] emitted 0 edges — the ${role.key} duty patterns in scripts/lib/graph-duties.mjs no longer match the atlas`,
    );
  }
}

function run(ctx) {
  const holders = dutyHolders(ctx);
  const skipIds = skippedDocIds(ctx);
  const stats = new Map(DUTY_ROLES.map((r) => [r.key, { edges: 0, unresolved: 0, byMatch: new Map() }]));
  for (const d of ctx.allDocs) {
    if (!isCandidate(d, skipIds)) continue;
    for (const role of DUTY_ROLES) emitDuties(ctx, holders, role, d, stats.get(role.key));
  }
  for (const role of DUTY_ROLES) report(role, stats.get(role.key));
}

export const pattern = { id: "2s-ter", run };
