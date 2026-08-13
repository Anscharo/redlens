import { useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { loadGraph } from "../../lib/graph";
import { useLoaded } from "../../hooks/useAtlasData";
import { buildRewardsIndex, rewardsIndexToCSV, type RewardsAgent } from "../../lib/rewardsIndex";
import { type ReportMode } from "../../lib/reportFilter";
import { filterRewardsAgents } from "../../lib/rewardsSearch";
import type { ReportId } from "../../types";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ReportShell } from "./ReportShell";
import { EcosystemHeader, AgentSection } from "./RewardsSections";
import { useReportQuery } from "./useReportQuery";

const REPORT: ReportId = "rewards";

// Header-box text filter, per ICD row, over the fields in rewardsSearch.ts —
// so "skybase" surfaces every SkyBase instance and "0x…" finds reward
// addresses wherever they appear.
const SEARCHES =
  "instance · doc nos · status · reward code · partner · chain · cadence · address · payments RP · tracking text · params · agent + chain entities";

// Total ICD rows (instances + invocations) across the given agents — the
// number the CSV will emit, so its label matches the filtered export.
function countIcds(agents: RewardsAgent[]): number {
  let n = 0;
  for (const a of agents)
    for (const prim of [a.dr, a.ib])
      if (prim) n += prim.active.length + prim.suspended.length + prim.completed.length + prim.invocations.length;
  return n;
}

export function RewardsReport({ query, mode }: { query: string; mode: ReportMode }) {
  // Three independent loads (a failure re-throws into the route ErrorBoundary,
  // which owns the error page). Addresses are an enrichment — the tables read
  // them as a plain record, so an empty map renders fine.
  const docs = useLoaded(loadDocs);
  const graph = useLoaded(loadGraph);
  const addresses = useLoaded(loadAddresses);
  const idx = useMemo(() => (docs && graph ? buildRewardsIndex(docs, graph) : null), [docs, graph]);
  const addrMap = addresses ?? {};

  // Text filter: keep agents with at least one matching ICD, with their DR/IB
  // buckets narrowed to the matching rows. Empty-query passthrough keeps the
  // unfiltered view (including agents with no instances).
  const rq = useReportQuery(query, mode);
  const shownAgents = useMemo(() => (idx ? filterRewardsAgents(idx.agents, rq) : []), [idx, rq]);

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
  const invocations = summary ? summary.drInvocations + summary.ibInvocations : 0;

  return (
    <ReportShell
      report={REPORT}
      title="Integrator Reward Relationships"
      maxWidth="max-w-6xl"
      description={
        <>
          Every Distribution Reward and Integration Boost instance each Prime Agent has invoked, with reward
          codes, partner names, and on-chain reward addresses — sourced from the Atlas.
          {summary && (
            <span className="mono text-[11px] ml-2">
              {summary.dr} DR · {summary.ib} IB ·{" "}
              {invocations > 0 && (
                <>
                  {invocations} invocation{invocations === 1 ? "" : "s"} ·{" "}
                </>
              )}
              {summary.codes} codes · {summary.addrs} addresses
            </span>
          )}
        </>
      }
      query={query}
      searches={SEARCHES}
      actions={
        idx ? (
          <DownloadCsvButton
            report={REPORT}
            filename="integrator-reward-relationships.csv"
            rowCount={countIcds(shownAgents)}
            build={() => rewardsIndexToCSV({ ...idx, agents: shownAgents })}
            fullRowCount={countIcds(idx.agents)}
            buildFull={() => rewardsIndexToCSV(idx)}
            query={query}
          />
        ) : undefined
      }
      loading={!idx}
      viewProps={{ row_count: idx ? countIcds(idx.agents) : 0 }}
      noRows={!!idx && idx.agents.length > 0 && shownAgents.length === 0}
    >
      {/* Reference cards (primitive definitions + buffer address) — kept as
          context while filtering, hidden only when the filter clears the whole
          report so the empty state reads cleanly. */}
      {idx && (shownAgents.length > 0 || rq.needles.length === 0) && (
        <EcosystemHeader idx={idx} addrMap={addrMap} />
      )}
      {shownAgents.map((a) => (
        <AgentSection key={a.name} agent={a} addrMap={addrMap} rq={rq} />
      ))}
    </ReportShell>
  );
}
