// Curated Integrator Reward Relationships report. Backend port of the
// /reports/rewards page: it reuses the exact pure derivation
// (src/lib/rewardsIndex.ts) via the ix-adapter, so the model sees the same
// per-agent Distribution Reward / Integration Boost rollup the UI shows —
// each agent's operational chain, primitive activation, and every Instance /
// Invocation with its resolved params — in one call, instead of the model
// stitching it together from instance entities + active_data_for edges by hand.
import type { Indexes } from "../indexes.ts";
import type { ToolResult } from "../tools.ts";
import { fitToBudget, TRUNCATION_HINT } from "../output-budget.ts";
import { buildRewardsIndex } from "../../lib/rewardsIndex.ts";
import type { AgentPrimitive, RewardsAgent, RewardsIcd } from "../../lib/rewardsTypes.ts";
import { indexesToGraphData, indexesToBundle } from "./ix-adapter.ts";

// `params` is the raw [value, srcUuid, srcDocNo] tuple map behind each resolved
// field — the provenance layer. Drop it for the leaner (include_provenance:false)
// rollup; the resolved display fields (rewardCode, partnerName, …) stay.
function stripIcdParams<S>({ params: _params, ...rest }: RewardsIcd<S>): RewardsIcd<S> {
  return rest as RewardsIcd<S>;
}
function stripPrimParams(p: AgentPrimitive | null): AgentPrimitive | null {
  if (!p) return null;
  return {
    ...p,
    active: p.active.map(stripIcdParams),
    suspended: p.suspended.map(stripIcdParams),
    completed: p.completed.map(stripIcdParams),
    invocations: p.invocations.map(stripIcdParams),
  };
}
function stripAgentParams(a: RewardsAgent): RewardsAgent {
  return { ...a, dr: stripPrimParams(a.dr), ib: stripPrimParams(a.ib) };
}

export function buildRewardsReport(ix: Indexes, opts: { include_provenance: boolean }): ToolResult {
  const { docs } = indexesToBundle(ix);
  const { agents: allAgents, ...ecosystem } = buildRewardsIndex(docs, indexesToGraphData(ix));

  const agents = opts.include_provenance ? allAgents : allAgents.map(stripAgentParams);

  const { kept, truncated } = fitToBudget(agents);
  const result: ToolResult = {
    report: "rewards",
    total: allAgents.length,
    returned: kept.length,
    truncated,
    agents: kept,
    // Ecosystem anchor docs (stUsdsDr, srUsdsDr, dr/ibPrimitive) + the demand-side
    // buffer address — scalar context that always fits, kept outside the budget.
    ecosystem,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
