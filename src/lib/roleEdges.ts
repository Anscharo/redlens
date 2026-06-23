// Role-as-edge type sets emitted by build-graph.mjs for the prime → executor →
// facilitator/govops chain. Single-sourced here so a new role-edge variant from
// a future atlas PR is added once, not in every report that walks the chain.
//
// Note: rewardsIndex deliberately restricts to the operational_* variants only
// (not core_*), so it references those edge types explicitly rather than these
// sets — that narrowing is intentional, not drift.
export const EXEC_EDGES = new Set(["operational_executor_agent_for", "core_executor_agent_for"]);
export const FAC_EDGES = new Set(["operational_facilitator_for", "core_facilitator_for"]);
export const GOV_EDGES = new Set(["operational_govops_for", "core_govops_for"]);
export const CHAIN_EDGES = new Set([...EXEC_EDGES, ...FAC_EDGES, ...GOV_EDGES]);
