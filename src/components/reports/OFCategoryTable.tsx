import type { OFResponsibility } from "../../lib/facilitatorResponsibilities";
import type { Chain } from "../../lib/reportChains";
import { stripExecutorPrefix } from "../../lib/reportChains";
import { AgentChips, DocCell } from "./OGReportParts";
import { EMPTY_QUERY, hiddenMatches, type ReportQuery, type SearchField } from "../../lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";

// Duty rows carry per-row facilitator attribution (fan-out edges) — shown for
// op-duty, where two orgs hold the role and the split is real information.
// Universal rows bind every holder, so the column would be constant noise.
const facNames = (r: OFResponsibility) =>
  r.facilitators?.join(", ") ?? r.facilitator ?? "—";

// The search haystack as labelled fields, with `hidden` tracking exactly what
// THIS table renders per category — so hidden-only matches can be explained
// beside the row. Keep in sync with the cells below.
export function ofSearchFields(r: OFResponsibility): SearchField[] {
  const cat = r.category;
  const assignment = cat === "assignment";
  const facVisible = assignment || cat === "op-duty" || cat === "active-data" || cat === "process-step";
  const primeVisible = cat !== "universal" && cat !== "core-facilitator";
  return [
    { label: "doc no", value: r.sources?.map((s) => s.docNo).join(" ") ?? r.docNo },
    { label: "title", value: r.title, hidden: assignment },
    { label: "duty", value: r.duty, hidden: assignment },
    { label: "role", value: r.role ?? "", hidden: true },
    { label: "facilitator", value: [r.facilitator, ...(r.facilitators ?? [])].filter(Boolean).join(", "), hidden: !facVisible, despace: true },
    { label: "executor", value: r.executor ?? "", hidden: !assignment, despace: true },
    { label: "prime agent", value: [r.agent, ...(r.agents ?? [])].filter(Boolean).join(", "), hidden: !primeVisible, despace: true },
  ];
}

export function OFCategoryTable({
  cat,
  label,
  rows,
  chains,
  rq = EMPTY_QUERY,
}: {
  cat: OFResponsibility["category"];
  label: string;
  rows: OFResponsibility[];
  chains: Map<string, Chain>;
  rq?: ReportQuery;
}) {
  const showFac = cat === "op-duty" || cat === "active-data" || cat === "process-step";
  const showPrime = cat !== "universal" && cat !== "core-facilitator" && cat !== "assignment";
  return (
    <div className="mb-8">
      <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
        {label} <span className="text-tan-3/60">({rows.length})</span>
      </h2>
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs mono text-tan-3">
            <th className="py-1 px-3 font-normal w-44">Doc</th>
            {cat === "assignment" ? (
              <>
                <th className="py-1 px-3 font-normal">Executor Agent</th>
                <th className="py-1 px-3 font-normal w-40">Facilitator</th>
                <th className="py-1 px-3 font-normal">Prime Agents</th>
              </>
            ) : (
              <>
                <th className="py-1 px-3 font-normal">Section</th>
                <th className="py-1 px-3 font-normal">Duty</th>
                {showFac && <th className="py-1 px-3 font-normal w-40">Facilitator</th>}
                {showPrime && <th className="py-1 px-3 font-normal w-36">Prime</th>}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${cat}:${r.uuid || r.docNo}:${r.facilitator ?? ""}`}
              className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors"
            >
              <td className="py-2 px-3 align-top relative">
                <MatchAside matches={hiddenMatches(ofSearchFields(r), rq)} rq={rq} />
                <DocCell r={r} rq={rq} />
              </td>
              {cat === "assignment" ? (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan">
                    {r.executor ? <Highlight text={stripExecutorPrefix(r.executor)} rq={rq} flex /> : "—"}
                  </td>
                  <td className="py-2 px-3 align-top text-sm text-accent">
                    <Highlight text={r.facilitator ?? "—"} rq={rq} flex />
                  </td>
                  <td className="py-2 px-3 align-top">
                    <AgentChips agents={r.agents ?? []} chains={chains} rq={rq} />
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan"><Highlight text={r.title} rq={rq} /></td>
                  <td className="py-2 px-3 align-top text-sm text-tan-2"><Highlight text={r.duty} rq={rq} /></td>
                  {showFac && (
                    <td className="py-2 px-3 align-top text-sm text-accent"><Highlight text={facNames(r)} rq={rq} flex /></td>
                  )}
                  {showPrime && (
                    <td className="py-2 px-3 align-top">
                      <AgentChips
                        agents={r.agents ?? (r.agent ? [r.agent] : [])}
                        chains={chains}
                        rq={rq}
                      />
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
