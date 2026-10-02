/**
 * Phase 2 entity + address edges (2i–2x) for build-graph: prime_agent_for,
 * executor_agent_for, facilitator_for, govops_for, aligned/ranked delegate,
 * holds_role, ecosystem_accord, comprises, erg_member, responsible_party_for,
 * process_step_responsible_party_for, duty_for, defines_entity, has_address,
 * mentions, org-prose relations, proxies_to.
 *
 * Each pattern is its own module under graph-entity-edges/; patterns.mjs lists
 * them in run order.
 */
import { buildContext } from "./graph-entity-edges/context.mjs";
import { ENTITY_EDGE_PATTERNS } from "./graph-entity-edges/patterns.mjs";

export function extractEntityEdges(allDocs, docById, docByDocNo, entityContext, addressesRaw) {
  const ctx = buildContext(allDocs, docById, docByDocNo, entityContext, addressesRaw);
  for (const pattern of ENTITY_EDGE_PATTERNS) pattern.run(ctx);
  return ctx.edges;
}
