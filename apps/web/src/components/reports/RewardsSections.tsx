// Section blocks for the Integrator Reward Relationships report — the
// ecosystem reference cards and one section per Prime Agent. Split out of
// RewardsReport.tsx so the page file is data + <ReportShell> only.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { AddressInfo } from "@/types";
import type { RewardsIndex, RewardsAgent } from "@/lib/rewardsIndex";
import type { ReportQuery } from "@/lib/reportFilter";
import { AddressLink, EntityChip } from "./RewardsCells";
import { PrimitiveTable } from "./RewardsPrimitiveTable";

export function EcosystemHeader({ idx, addrMap }: { idx: RewardsIndex; addrMap: Record<string, AddressInfo> }) {
  const cards = (["drPrimitive", "ibPrimitive", "stUsdsDr", "srUsdsDr"] as const)
    .map((k) => idx[k])
    .filter((n): n is NonNullable<typeof n> => !!n);
  return (
    <div className="mb-8 grid md:grid-cols-2 gap-4">
      {cards.map((n) => (
        <AtlasLink
          key={n.id}
          to={atlasHref(n.id)}
          className="text-left p-3 rounded border border-[var(--border)] hover:bg-[var(--hover)] transition-colors block no-underline"
        >
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm font-medium text-tan">{n.title}</span>
            <span className="mono text-[10px] text-accent">{n.docNo}</span>
          </div>
          <p className="text-[11px] text-tan-3 line-clamp-2">{n.description}</p>
        </AtlasLink>
      ))}
      <div className="md:col-span-2 text-[11px] text-tan-3 flex items-center gap-2 pt-2">
        <span>Demand Side Buffer Multisig:</span>
        <AddressLink addr={idx.demandSideBufferAddress} chain="ethereum" addrMap={addrMap} />
        <span className="opacity-60">— DR + IB disbursement account</span>
      </div>
    </div>
  );
}

export function AgentSection({
  agent,
  addrMap,
  rq,
}: {
  agent: RewardsAgent;
  addrMap: Record<string, AddressInfo>;
  rq: ReportQuery;
}) {
  // Instance counts (Active/Suspended/Completed) — operational deployments.
  // Invocations are counted separately so the empty-state copy doesn't claim
  // an agent has "no instances" when it has in-progress invocations.
  const drInstanceCount = agent.dr
    ? agent.dr.active.length + agent.dr.suspended.length + agent.dr.completed.length
    : 0;
  const ibInstanceCount = agent.ib
    ? agent.ib.active.length + agent.ib.suspended.length + agent.ib.completed.length
    : 0;
  const drInvocationCount = agent.dr?.invocations.length ?? 0;
  const ibInvocationCount = agent.ib?.invocations.length ?? 0;
  const invocations = drInvocationCount + ibInvocationCount;
  const chain = agent.chain;
  return (
    <section className="mb-10 pb-8 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="text-lg font-semibold" style={{ color: "var(--tan)" }}>
          {agent.name}
        </h2>
        {drInstanceCount + ibInstanceCount + invocations === 0 && (
          <span className="mono text-[10px] text-tan-3">(no instances)</span>
        )}
        {drInstanceCount + ibInstanceCount === 0 && invocations > 0 && (
          <span className="mono text-[10px] text-tan-3">
            ({invocations} invocation{invocations === 1 ? "" : "s"} in progress)
          </span>
        )}
      </div>
      {chain && (chain.executor || chain.govops) && (
        <p className="text-[11px] text-tan-3 mb-4 flex items-center gap-2 flex-wrap">
          {chain.executor && (
            <>
              calculated by <EntityChip e={chain.executor} />
            </>
          )}
          {chain.executor && chain.govops && <span className="opacity-50">·</span>}
          {chain.govops && (
            <>
              disbursed by <EntityChip e={chain.govops} />
            </>
          )}
        </p>
      )}
      {agent.dr && <PrimitiveTable agent={agent} prim={agent.dr} addrMap={addrMap} rq={rq} />}
      {agent.ib && <PrimitiveTable agent={agent} prim={agent.ib} addrMap={addrMap} rq={rq} />}
    </section>
  );
}
