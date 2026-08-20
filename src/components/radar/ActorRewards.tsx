import type { RewardsAgent } from "@/lib/rewardsIndex";
import { PrimitiveTable } from "../reports/RewardsPrimitiveTable";

interface Props {
  agent: RewardsAgent;
}

export function ActorRewards({ agent }: Props) {
  if (!agent.dr && !agent.ib) {
    return (
      <p className="text-xs italic" style={{ color: "var(--tan-3)" }}>
        No DR or IB instances for this agent.
      </p>
    );
  }

  return (
    <div>
      {agent.dr && <PrimitiveTable agent={agent} prim={agent.dr} addrMap={{}} />}
      {agent.ib && <PrimitiveTable agent={agent} prim={agent.ib} addrMap={{}} />}
    </div>
  );
}
