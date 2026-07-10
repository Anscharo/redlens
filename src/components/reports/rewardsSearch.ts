import type { RewardsAgent, RewardsInstance, RewardsInvocation } from "../../lib/rewardsIndex";
import type { SearchField } from "../../lib/reportFilter";

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
    { label: "partner", value: i.partnerName ?? "" },
    { label: "chain", value: i.rewardChain ?? "" },
    { label: "cadence", value: i.cadence ?? "" },
    { label: "address", value: i.rewardAddress ?? "" },
    { label: "payments rp", value: i.paymentsResponsibleParty?.name ?? "" },
    { label: "tracking", value: i.tracking ?? "", hidden: true },
    {
      label: "params",
      value: Object.entries(i.params ?? {})
        .map(([k, [v]]) => `${k}: ${v}`)
        .join(" · "),
      hidden: true,
    },
    { label: "agent", value: agent.name },
    {
      label: "agent chain",
      value: [agent.chain?.executor?.name, agent.chain?.govops?.name].filter(Boolean).join(", "),
    },
  ];
}
