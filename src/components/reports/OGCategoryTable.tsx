import type { OGResponsibility } from "../../lib/govopsResponsibilities";
import type { Chain } from "../../lib/reportChains";
import { stripExecutorPrefix } from "../../lib/reportChains";
import { AgentChips, DocCell } from "./OGReportParts";

export function OGCategoryTable({
  cat,
  label,
  rows,
  chains,
}: {
  cat: OGResponsibility["category"];
  label: string;
  rows: OGResponsibility[];
  chains: Map<string, Chain>;
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
              <td className="py-2 px-3 align-top"><DocCell r={r} /></td>
              {cat === "assignment" ? (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan">
                    {r.executor ? stripExecutorPrefix(r.executor) : "—"}
                  </td>
                  <td className="py-2 px-3 align-top text-sm text-accent">{r.govops ?? "—"}</td>
                  <td className="py-2 px-3 align-top">
                    <AgentChips agents={r.agents ?? []} chains={chains} />
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan">{r.title}</td>
                  <td className="py-2 px-3 align-top text-sm text-tan-2">{r.duty}</td>
                  {(cat === "active-data" || cat === "process-step") && (
                    <td className="py-2 px-3 align-top text-sm text-accent">{r.govops ?? "—"}</td>
                  )}
                  {(cat === "op-duty" || cat === "core-duty") && (
                    <td className="py-2 px-3 align-top">
                      <AgentChips agents={r.agents ?? []} chains={chains} />
                    </td>
                  )}
                  {(cat === "active-data" || cat === "process-step") && (
                    <td className="py-2 px-3 align-top">
                      <AgentChips agents={r.agent ? [r.agent] : []} chains={chains} />
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
