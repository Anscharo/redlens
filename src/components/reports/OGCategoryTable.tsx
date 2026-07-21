import { ogSearchFields, type OGResponsibility } from "../../lib/govopsResponsibilities";
import type { Chain } from "../../lib/reportChains";
import { stripExecutorPrefix } from "../../lib/reportChains";
import { AgentChips, DocCell } from "./OGReportParts";
import { EMPTY_QUERY, hiddenMatches, type ReportQuery } from "../../lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";

// ogSearchFields (the row search haystack) lives in the lib module so the
// atlas_report_govops_responsibilities MCP tool filters rows with the exact
// same field logic this table renders. Re-exported for existing importers.
export { ogSearchFields };

export function OGCategoryTable({
  cat,
  label,
  rows,
  chains,
  rq = EMPTY_QUERY,
}: {
  cat: OGResponsibility["category"];
  label: string;
  rows: OGResponsibility[];
  chains: Map<string, Chain>;
  rq?: ReportQuery;
}) {
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
                <th className="py-1 px-3 font-normal w-40">GovOps</th>
                <th className="py-1 px-3 font-normal">Prime Agents</th>
              </>
            ) : (
              <>
                <th className="py-1 px-3 font-normal">Section</th>
                <th className="py-1 px-3 font-normal">Duty</th>
                {(cat === "active-data" || cat === "process-step") && (
                  <th className="py-1 px-3 font-normal w-36">GovOps</th>
                )}
                {(cat === "op-duty" ||
                  cat === "core-duty" ||
                  cat === "active-data" ||
                  cat === "process-step") && (
                  <th className="py-1 px-3 font-normal w-36">Prime</th>
                )}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${cat}:${r.uuid || r.docNo}:${r.govops ?? ""}`}
              className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors"
            >
              <td className="py-2 px-3 align-top relative">
                <MatchAside matches={hiddenMatches(ogSearchFields(r), rq)} rq={rq} />
                <DocCell r={r} rq={rq} />
              </td>
              {cat === "assignment" ? (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan">
                    {r.executor ? <Highlight text={stripExecutorPrefix(r.executor)} rq={rq} flex /> : "—"}
                  </td>
                  <td className="py-2 px-3 align-top text-sm text-accent">
                    <Highlight text={r.govops ?? "—"} rq={rq} flex />
                  </td>
                  <td className="py-2 px-3 align-top">
                    <AgentChips agents={r.agents ?? []} chains={chains} rq={rq} />
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan"><Highlight text={r.title} rq={rq} /></td>
                  <td className="py-2 px-3 align-top text-sm text-tan-2"><Highlight text={r.duty} rq={rq} /></td>
                  {(cat === "active-data" || cat === "process-step") && (
                    <td className="py-2 px-3 align-top text-sm text-accent">
                      <Highlight text={r.govops ?? "—"} rq={rq} flex />
                    </td>
                  )}
                  {(cat === "op-duty" || cat === "core-duty") && (
                    <td className="py-2 px-3 align-top">
                      <AgentChips agents={r.agents ?? []} chains={chains} rq={rq} />
                    </td>
                  )}
                  {(cat === "active-data" || cat === "process-step") && (
                    <td className="py-2 px-3 align-top">
                      <AgentChips agents={r.agent ? [r.agent] : []} chains={chains} rq={rq} />
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
