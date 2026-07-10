import type { OGResponsibility } from "../../lib/govopsResponsibilities";
import type { Chain } from "../../lib/reportChains";
import { stripExecutorPrefix } from "../../lib/reportChains";
import { AgentChips, DocCell } from "./OGReportParts";
import { hiddenMatches, type SearchField } from "../../lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";

// The search haystack as labelled fields, with `hidden` tracking exactly what
// THIS table renders per category — so hidden-only matches can be explained
// beside the row. Keep in sync with the cells below.
export function ogSearchFields(r: OGResponsibility): SearchField[] {
  const cat = r.category;
  const assignment = cat === "assignment";
  const govVisible = assignment || cat === "active-data" || cat === "process-step";
  const primeVisible = cat !== "definition";
  return [
    { label: "doc no", value: r.docNo },
    { label: "title", value: r.title, hidden: assignment },
    { label: "duty", value: r.duty, hidden: assignment },
    { label: "role", value: r.role ?? "", hidden: true },
    { label: "govops", value: r.govops ?? "", hidden: !govVisible },
    { label: "executor", value: r.executor ?? "", hidden: !assignment },
    { label: "prime agent", value: [r.agent, ...(r.agents ?? [])].filter(Boolean).join(", "), hidden: !primeVisible },
  ];
}

export function OGCategoryTable({
  cat,
  label,
  rows,
  chains,
  tokens = [],
}: {
  cat: OGResponsibility["category"];
  label: string;
  rows: OGResponsibility[];
  chains: Map<string, Chain>;
  tokens?: string[];
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
                <MatchAside matches={hiddenMatches(ogSearchFields(r), tokens)} tokens={tokens} />
                <DocCell r={r} tokens={tokens} />
              </td>
              {cat === "assignment" ? (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan">
                    {r.executor ? <Highlight text={stripExecutorPrefix(r.executor)} tokens={tokens} /> : "—"}
                  </td>
                  <td className="py-2 px-3 align-top text-sm text-accent">
                    <Highlight text={r.govops ?? "—"} tokens={tokens} />
                  </td>
                  <td className="py-2 px-3 align-top">
                    <AgentChips agents={r.agents ?? []} chains={chains} tokens={tokens} />
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan"><Highlight text={r.title} tokens={tokens} /></td>
                  <td className="py-2 px-3 align-top text-sm text-tan-2"><Highlight text={r.duty} tokens={tokens} /></td>
                  {(cat === "active-data" || cat === "process-step") && (
                    <td className="py-2 px-3 align-top text-sm text-accent">
                      <Highlight text={r.govops ?? "—"} tokens={tokens} />
                    </td>
                  )}
                  {(cat === "op-duty" || cat === "core-duty") && (
                    <td className="py-2 px-3 align-top">
                      <AgentChips agents={r.agents ?? []} chains={chains} tokens={tokens} />
                    </td>
                  )}
                  {(cat === "active-data" || cat === "process-step") && (
                    <td className="py-2 px-3 align-top">
                      <AgentChips agents={r.agent ? [r.agent] : []} chains={chains} tokens={tokens} />
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
