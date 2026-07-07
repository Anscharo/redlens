import type { OFResponsibility } from "../../lib/facilitatorResponsibilities";
import type { Chain } from "../../lib/reportChains";
import { stripExecutorPrefix } from "../../lib/reportChains";
import { AgentChips, DocCell } from "./OGReportParts";

// Duty rows carry per-row facilitator attribution (fan-out edges) — shown for
// op-duty, where two orgs hold the role and the split is real information.
// Universal rows bind every holder, so the column would be constant noise.
const facNames = (r: OFResponsibility) =>
  r.facilitators?.join(", ") ?? r.facilitator ?? "—";

export function OFCategoryTable({
  cat,
  label,
  rows,
  chains,
}: {
  cat: OFResponsibility["category"];
  label: string;
  rows: OFResponsibility[];
  chains: Map<string, Chain>;
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
              <td className="py-2 px-3 align-top"><DocCell r={r} /></td>
              {cat === "assignment" ? (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan">
                    {r.executor ? stripExecutorPrefix(r.executor) : "—"}
                  </td>
                  <td className="py-2 px-3 align-top text-sm text-accent">{r.facilitator ?? "—"}</td>
                  <td className="py-2 px-3 align-top">
                    <AgentChips agents={r.agents ?? []} chains={chains} />
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan">{r.title}</td>
                  <td className="py-2 px-3 align-top text-sm text-tan-2">{r.duty}</td>
                  {showFac && (
                    <td className="py-2 px-3 align-top text-sm text-accent">{facNames(r)}</td>
                  )}
                  {showPrime && (
                    <td className="py-2 px-3 align-top">
                      <AgentChips
                        agents={r.agents ?? (r.agent ? [r.agent] : [])}
                        chains={chains}
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
