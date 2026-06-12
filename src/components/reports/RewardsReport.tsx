import { useState, useEffect, useMemo } from "react";
import { AtlasLink } from "../AtlasLink";
import { loadDocs } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { loadGraph } from "../../lib/graph";
import { atlasHref } from "../../lib/routes";
import type { AddressInfo } from "../../types";
import { buildRewardsIndex, type RewardsIndex, type RewardsAgent } from "../../lib/rewardsIndex";
import { AddressLink, EntityChip } from "./RewardsCells";
import { PrimitiveTable } from "./RewardsPrimitiveTable";

function EcosystemHeader({
  idx,
  addrMap,
}: {
  idx: RewardsIndex;
  addrMap: Record<string, AddressInfo>;
}) {
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

function AgentSection({
  agent,
  addrMap,
}: {
  agent: RewardsAgent;
  addrMap: Record<string, AddressInfo>;
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
  const chain = agent.chain;
  return (
    <section className="mb-10 pb-8 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="text-lg font-semibold" style={{ color: "var(--tan)" }}>
          {agent.name}
        </h2>
        {drInstanceCount + ibInstanceCount + drInvocationCount + ibInvocationCount === 0 && (
          <span className="mono text-[10px] text-tan-3">(no instances)</span>
        )}
        {drInstanceCount + ibInstanceCount === 0 && drInvocationCount + ibInvocationCount > 0 && (
          <span className="mono text-[10px] text-tan-3">
            ({drInvocationCount + ibInvocationCount} invocation{drInvocationCount + ibInvocationCount === 1 ? "" : "s"} in progress)
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
      {agent.dr && <PrimitiveTable agent={agent} prim={agent.dr} addrMap={addrMap} />}
      {agent.ib && <PrimitiveTable agent={agent} prim={agent.ib} addrMap={addrMap} />}
    </section>
  );
}

export function RewardsReport() {
  const [idx, setIdx] = useState<RewardsIndex | null>(null);
  const [addrMap, setAddrMap] = useState<Record<string, AddressInfo>>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(null);
    Promise.all([loadDocs(), loadAddresses(), loadGraph()]).then(([docs, addrs, graph]) => {
      setIdx(buildRewardsIndex(docs, graph));
      setAddrMap(addrs);
    }).catch((err) => {
      setError(String(err));
    });
  }, [attempt]);

  const summary = useMemo(() => {
    if (!idx) return null;
    // Instance counts (dr/ib) cover operational instances only — Active +
    // Suspended + Completed, per atlas A.2.2.1.3.2. Invocations are tracked in
    // a separate field so the summary doesn't inflate "deployed reward
    // primitives" with in-progress governance.
    const agg = { dr: 0, ib: 0, drInvocations: 0, ibInvocations: 0, codes: 0, addrs: 0 };
    for (const a of idx.agents) {
      if (a.dr) {
        agg.dr += a.dr.active.length + a.dr.suspended.length + a.dr.completed.length;
        agg.drInvocations += a.dr.invocations.length;
        for (const i of [...a.dr.active, ...a.dr.suspended, ...a.dr.completed, ...a.dr.invocations])
          if (i.rewardCode) agg.codes++;
      }
      if (a.ib) {
        agg.ib += a.ib.active.length + a.ib.suspended.length + a.ib.completed.length;
        agg.ibInvocations += a.ib.invocations.length;
        for (const i of [...a.ib.active, ...a.ib.suspended, ...a.ib.completed, ...a.ib.invocations])
          if (i.rewardAddress) agg.addrs++;
      }
    }
    return agg;
  }, [idx]);

  return (
    <div className="px-6 py-6">
      <div className="max-w-6xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Integrator Reward Relationships
        </h1>
        <p className="text-sm text-tan-3 mb-6">
          Every Distribution Reward and Integration Boost instance each Prime Agent has invoked,
          with reward codes, partner names, and on-chain reward addresses — sourced from the Atlas.
          {summary && (
            <span className="mono text-[11px] ml-2">
              {summary.dr} DR · {summary.ib} IB ·{" "}
              {summary.drInvocations + summary.ibInvocations > 0 && (
                <>
                  {summary.drInvocations + summary.ibInvocations} invocation{summary.drInvocations + summary.ibInvocations === 1 ? "" : "s"} ·{" "}
                </>
              )}
              {summary.codes} codes · {summary.addrs} addresses
            </span>
          )}
        </p>

        {error ? (
          <div className="flex items-center gap-3">
            <p className="text-sm mono" style={{ color: "var(--error-text)" }}>Failed to load report.</p>
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="text-xs mono text-accent hover:underline"
            >
              retry
            </button>
          </div>
        ) : !idx ? (
          <p className="text-sm text-tan-3">Loading…</p>
        ) : (
          <>
            <EcosystemHeader idx={idx} addrMap={addrMap} />
            {idx.agents.map((a) => (
              <AgentSection key={a.name} agent={a} addrMap={addrMap} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
