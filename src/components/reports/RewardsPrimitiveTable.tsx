import { Link } from "../Link";
import { AtlasLink } from "../AtlasLink";
import type { AddressInfo } from "../../types";
import type { AgentPrimitive, RewardsAgent, RewardsInstance, RewardsInvocation } from "../../lib/rewardsIndex";
import { atlasHref, actorHref } from "../../lib/routes";
import { AddressLink, StatusPill } from "./RewardsCells";
import { EMPTY_QUERY, hiddenMatches, type ReportQuery } from "../../lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";
import { icdSearchFields } from "../../lib/rewardsSearch";

function InstanceRow({
  inst,
  kind,
  addrMap,
  agent,
  rq,
}: {
  inst: RewardsInstance | RewardsInvocation;
  kind: "DR" | "IB";
  addrMap: Record<string, AddressInfo>;
  agent: RewardsAgent;
  rq: ReportQuery;
}) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top w-20 relative">
        <MatchAside matches={hiddenMatches(icdSearchFields(agent, inst), rq)} rq={rq} />
        <StatusPill s={inst.status} />
      </td>
      <td className="py-2 px-3 align-top">
        <AtlasLink
          to={atlasHref(inst.id)}
          className="text-sm text-tan hover:underline text-left"
        >
          <Highlight text={inst.name} rq={rq} />
        </AtlasLink>
        <div className="mono text-[10px] text-tan-3 mt-0.5 flex items-center gap-2">
          <span><Highlight text={inst.docNo} rq={rq} /></span>
          {inst.params && Object.keys(inst.params).length > 0 && (
            <span className="opacity-70" title={Object.keys(inst.params).join(" · ")}>
              ⚙ {Object.keys(inst.params).length}
            </span>
          )}
        </div>
      </td>
      {kind === "DR" ? (
        <>
          <td className="py-2 px-3 align-top w-24 mono text-xs text-tan-2">
            {inst.rewardCode ? (
              <AtlasLink
                to={atlasHref(inst.rewardCodeDocId ?? inst.id)}
                className="px-1.5 py-0.5 rounded bg-[var(--hover)] text-tan hover:underline"
              >
                <Highlight text={inst.rewardCode} rq={rq} />
              </AtlasLink>
            ) : (
              <span className="text-tan-3">—</span>
            )}
          </td>
          <td className="py-2 px-3 align-top text-xs text-tan-2">
            {inst.trackingDocId && inst.trackingDocNo ? (
              <AtlasLink
                to={atlasHref(inst.trackingDocId)}
                className="mono text-[11px] text-accent hover:underline"
              >
                <Highlight text={inst.trackingDocNo} rq={rq} />
              </AtlasLink>
            ) : (
              <span className="text-tan-3">—</span>
            )}
          </td>
          <td className="py-2 px-3 align-top w-32 text-[11px]">
            {inst.paymentsResponsibleParty ? (
              <Link
                to={actorHref(inst.paymentsResponsibleParty.slug)}
                className="text-accent hover:underline mono"
                title={
                  inst.paymentsControllerDocNo
                    ? `owed on ${inst.paymentsControllerDocNo}`
                    : undefined
                }
              >
                <Highlight text={inst.paymentsResponsibleParty.name} rq={rq} flex />
              </Link>
            ) : (
              <span className="text-tan-3">—</span>
            )}
          </td>
        </>
      ) : (
        <>
          <td className="py-2 px-3 align-top text-xs text-tan-2">
            {inst.partnerName ? (
              <AtlasLink
                to={atlasHref(inst.partnerNameDocId ?? inst.id)}
                className="text-tan-2 hover:underline text-left"
              >
                <Highlight text={inst.partnerName} rq={rq} flex />
              </AtlasLink>
            ) : (
              <span className="text-tan-3">—</span>
            )}
          </td>
          <td className="py-2 px-3 align-top text-xs">
            {inst.rewardAddress ? (
              <AddressLink addr={inst.rewardAddress} chain={inst.rewardChain} addrMap={addrMap} />
            ) : (
              <span className="text-tan-3">—</span>
            )}
          </td>
          <td className="py-2 px-3 align-top mono text-[11px] w-28">
            {inst.rewardChain ? (
              <AtlasLink
                to={atlasHref(inst.rewardChainDocId ?? inst.id)}
                className="text-tan-3 hover:underline"
              >
                <Highlight text={inst.rewardChain} rq={rq} />
              </AtlasLink>
            ) : (
              <span className="text-tan-3">—</span>
            )}
          </td>
          <td className="py-2 px-3 align-top mono text-[11px] w-20">
            {inst.cadence ? (
              <AtlasLink
                to={atlasHref(inst.cadenceDocId ?? inst.id)}
                className="text-tan-3 hover:underline"
              >
                <Highlight text={inst.cadence} rq={rq} />
              </AtlasLink>
            ) : (
              <span className="text-tan-3">—</span>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

export function PrimitiveTable({
  agent,
  prim,
  addrMap,
  rq = EMPTY_QUERY,
}: {
  agent: RewardsAgent;
  prim: AgentPrimitive;
  addrMap: Record<string, AddressInfo>;
  rq?: ReportQuery;
}) {
  const instances = [...prim.active, ...prim.suspended, ...prim.completed];
  const invocations = prim.invocations;
  const kind = prim.kind;
  const title = kind === "DR" ? "Distribution Reward" : "Integration Boost";

  function HeaderRow() {
    return (
      <tr className="text-[10px] mono text-tan-3 border-b border-[var(--border)]">
        <th className="py-1.5 px-3 font-normal">Status</th>
        <th className="py-1.5 px-3 font-normal">Instance</th>
        {kind === "DR" ? (
          <>
            <th className="py-1.5 px-3 font-normal">Reward Code</th>
            <th className="py-1.5 px-3 font-normal">Tracking</th>
            <th className="py-1.5 px-3 font-normal">Payments RP</th>
          </>
        ) : (
          <>
            <th className="py-1.5 px-3 font-normal">Partner</th>
            <th className="py-1.5 px-3 font-normal">Reward Address</th>
            <th className="py-1.5 px-3 font-normal">Chain</th>
            <th className="py-1.5 px-3 font-normal">Cadence</th>
          </>
        )}
      </tr>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <h3 className="text-sm font-medium" style={{ color: "var(--tan)" }}>
          {title}
        </h3>
        <AtlasLink
          to={atlasHref(prim.primitiveId)}
          className="mono text-[10px] text-accent hover:underline"
        >
          {prim.primitiveDocNo}
        </AtlasLink>
        <span className="mono text-[10px] text-tan-3">global: {prim.globalActivation ?? "—"}</span>
        <span className="mono text-[10px] text-tan-3">
          {prim.active.length} active · {prim.suspended.length} suspended · {prim.completed.length} completed
          {invocations.length > 0 && <> · <span style={{ color: "var(--accent)" }}>{invocations.length} in-progress invocation{invocations.length === 1 ? "" : "s"}</span></>}
        </span>
      </div>
      {instances.length === 0 && invocations.length === 0 && (
        <p className="text-xs text-tan-3 italic px-3 py-2 rounded border border-[var(--border)] border-dashed">
          No instances yet. {agent.name} has {title} globally activated but has not invoked any
          instance.
        </p>
      )}
      {instances.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><HeaderRow /></thead>
            <tbody>
              {instances.map((inst) => (
                <InstanceRow key={inst.id || inst.docNo} inst={inst} kind={kind} addrMap={addrMap} agent={agent} rq={rq} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invocations.length > 0 && (
        <div className="overflow-x-auto mt-3">
          <p className="mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--tan-3)" }}>
            Invocations in Progress
          </p>
          <table className="w-full text-left">
            <thead><HeaderRow /></thead>
            <tbody>
              {invocations.map((inst) => (
                <InstanceRow key={inst.id || inst.docNo} inst={inst} kind={kind} addrMap={addrMap} agent={agent} rq={rq} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
