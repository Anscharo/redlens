// Data loading + derived views for the Rewards report.
import { useEffect, useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { setAddressMap } from "../../lib/addressMap";
import { loadGraph } from "../../lib/graph";
import { useLoaded } from "../../hooks/useAtlasData";
import { buildRewardsIndex, type RewardsAgent, type RewardsIndex } from "@/lib/rewardsIndex";
import { type ReportMode } from "@/lib/reportFilter";
import { filterRewardsAgents } from "@/lib/rewardsSearch";
import { useReportQuery } from "./useReportQuery";

export type RewardsSummary = ReturnType<typeof summarizeRewards>;

// Total ICD rows (instances + invocations) across the given agents — the
// number the CSV will emit, so its label matches the filtered export.
export function countIcds(agents: RewardsAgent[]): number {
  let n = 0;
  for (const a of agents)
    for (const prim of [a.dr, a.ib])
      if (prim) n += prim.active.length + prim.suspended.length + prim.completed.length + prim.invocations.length;
  return n;
}

// Instance counts (dr/ib) cover operational instances only — Active +
// Suspended + Completed, per atlas A.2.2.1.3.2. Invocations are tracked in
// a separate field so the summary doesn't inflate "deployed reward
// primitives" with in-progress governance.
function summarizeRewards(idx: RewardsIndex) {
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
}

export function useRewardsState(query: string, mode: ReportMode) {
  // Three independent loads (a failure re-throws into the route ErrorBoundary,
  // which owns the error page). Addresses are an enrichment — the tables read
  // them as a plain record, so an empty map renders fine.
  const docs = useLoaded(loadDocs);
  const graph = useLoaded(loadGraph);
  const addresses = useLoaded(loadAddresses);
  const idx = useMemo(() => (docs && graph ? buildRewardsIndex(docs, graph) : null), [docs, graph]);

  // Hydrate the shared singleton the inline <Address> tooltips read for
  // name/explorer resolution (this report loads the map directly, not via
  // useAddressMap which is what normally sets the singleton).
  useEffect(() => {
    if (addresses) setAddressMap(addresses);
  }, [addresses]);

  // Text filter: keep agents with at least one matching ICD, with their DR/IB
  // buckets narrowed to the matching rows. Empty-query passthrough keeps the
  // unfiltered view (including agents with no instances).
  const rq = useReportQuery(query, mode);
  const shownAgents = useMemo(() => (idx ? filterRewardsAgents(idx.agents, rq) : []), [idx, rq]);
  const summary = useMemo(() => (idx ? summarizeRewards(idx) : null), [idx]);
  return { idx, addrMap: addresses ?? {}, rq, shownAgents, summary };
}
