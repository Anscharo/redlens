import { rewardsIndexToCSV, type RewardsAgent, type RewardsIndex } from "@/lib/rewardsIndex";
import { type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ReportShell } from "./ReportShell";
import { RewardsDescription } from "./RewardsDescription";
import { EcosystemHeader, AgentSection } from "./RewardsSections";
import { countIcds, useRewardsState } from "./useRewardsState";

const REPORT: ReportId = "rewards";

// Header-box text filter, per ICD row, over the fields in rewardsSearch.ts —
// so "skybase" surfaces every SkyBase instance and "0x…" finds reward
// addresses wherever they appear.
const SEARCHES =
  "instance · doc nos · status · reward code · partner · chain · cadence · address · payments RP · tracking text · params · agent + chain entities";

function RewardsCsvButton({
  idx,
  shownAgents,
  query,
}: {
  idx: RewardsIndex;
  shownAgents: RewardsAgent[];
  query: string;
}) {
  return (
    <DownloadCsvButton
      report={REPORT}
      filename="integrator-reward-relationships.csv"
      rowCount={countIcds(shownAgents)}
      build={() => rewardsIndexToCSV({ ...idx, agents: shownAgents })}
      fullRowCount={countIcds(idx.agents)}
      buildFull={() => rewardsIndexToCSV(idx)}
      query={query}
    />
  );
}

export function RewardsReport({ query, mode }: { query: string; mode: ReportMode }) {
  const { idx, addrMap, rq, shownAgents, summary } = useRewardsState(query, mode);
  return (
    <ReportShell
      report={REPORT}
      maxWidth="max-w-6xl"
      description={<RewardsDescription summary={summary} />}
      query={query}
      searches={SEARCHES}
      actions={idx ? <RewardsCsvButton idx={idx} shownAgents={shownAgents} query={query} /> : undefined}
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
