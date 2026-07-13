import type { AgentPrimitive, RewardsAgent, RewardsInstance, RewardsInvocation } from "../../lib/rewardsIndex";
import { rowMatches, type ReportQuery, type SearchField } from "../../lib/reportFilter";

// The Rewards report's per-ICD search haystack as labelled fields. `hidden`
// marks what PrimitiveTable does NOT render (tracking methodology text and
// param values — only the param count shows), so those matches get explained
// in the row's floating aside. Agent + chain names count as visible: they
// head the agent section the row sits in.
export function icdSearchFields(
  agent: RewardsAgent,
  i: RewardsInstance | RewardsInvocation,
): SearchField[] {
  return [
    { label: "status", value: i.status },
    { label: "instance", value: i.name },
    { label: "doc no", value: i.docNo },
    { label: "reward code", value: i.rewardCode ?? "" },
    { label: "tracking doc", value: i.trackingDocNo ?? "" },
    { label: "partner", value: i.partnerName ?? "", despace: true },
    { label: "chain", value: i.rewardChain ?? "" },
    { label: "cadence", value: i.cadence ?? "" },
    { label: "address", value: i.rewardAddress ?? "" },
    { label: "payments rp", value: i.paymentsResponsibleParty?.name ?? "", despace: true },
    { label: "tracking", value: i.tracking ?? "", hidden: true },
    {
      label: "params",
      value: Object.entries(i.params ?? {})
        .map(([k, [v]]) => `${k}: ${v}`)
        .join(" · "),
      hidden: true,
    },
    { label: "agent", value: agent.name, despace: true },
    {
      label: "agent chain",
      value: [agent.chain?.executor?.name, agent.chain?.govops?.name].filter(Boolean).join(", "),
      despace: true,
    },
  ];
}

// Narrows a primitive's ICD buckets to the rows matching `rq`; returns null
// when nothing survives (the whole DR/IB table is then hidden). Shared by the
// on-screen render and the CSV export so both reflect the active filter.
export function filterPrimitive(
  agent: RewardsAgent,
  prim: AgentPrimitive,
  rq: ReportQuery,
): AgentPrimitive | null {
  const keep = <T extends RewardsInstance | RewardsInvocation>(list: T[]): T[] =>
    list.filter((i) => rowMatches(icdSearchFields(agent, i), rq));
  const next = {
    ...prim,
    active: keep(prim.active),
    suspended: keep(prim.suspended),
    completed: keep(prim.completed),
    invocations: keep(prim.invocations),
  };
  return next.active.length + next.suspended.length + next.completed.length + next.invocations.length > 0
    ? next
    : null;
}

// The agents to render for a query: each agent kept iff ≥1 ICD matches, with
// its DR/IB buckets narrowed to the matching rows. Empty query → the agents
// untouched (identity preserved for memoized consumers).
export function filterRewardsAgents(agents: RewardsAgent[], rq: ReportQuery): RewardsAgent[] {
  if (rq.needles.length === 0) return agents;
  return agents
    .map((a) => {
      const dr = a.dr ? filterPrimitive(a, a.dr, rq) : null;
      const ib = a.ib ? filterPrimitive(a, a.ib, rq) : null;
      return dr || ib ? { ...a, dr, ib } : null;
    })
    .filter((a): a is RewardsAgent => a !== null);
}
