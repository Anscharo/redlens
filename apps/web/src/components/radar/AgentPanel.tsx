import { Link } from "../Link";
import { Tooltip } from "../Tooltip";
import type { AgentPrimitiveStat } from "../../lib/primitiveStats";
import { actorHref } from "@/lib/routes";
import { CategoryRows } from "./CategoryRows";
import { HEADERS, thStyle } from "./primitiveTable";

export function AgentPanel({ agent }: { agent: AgentPrimitiveStat }) {
  let rowCounter = 0;
  const totals = agent.categories.reduce(
    (acc, cat) => {
      for (const p of cat.primitives) {
        acc[0] += p.invocations;
        acc[1] += p.active;
        acc[2] += p.suspended;
        acc[3] += p.completed;
      }
      return acc;
    },
    [0, 0, 0, 0],
  );
  const instanceTotal = totals[1] + totals[2] + totals[3];
  const agentTip = (
    <div>
      <div style={{ fontWeight: 600 }}>{agent.name} Prime Agent</div>
      <div style={{ color: "var(--tan-2)" }}>{instanceTotal} Total Instances</div>
    </div>
  );
  return (
    <article className="rounded py-4 break-inside-avoid" style={{ border: "1px solid var(--border)", background: "#0f0a08" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "auto" }} />
          {HEADERS.map((h) => <col key={h.key} style={{ width: "2rem" }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="text-left pb-2 pl-3" style={{ fontWeight: "600", fontSize: "0.875rem", color: "var(--tan)" }}>
              <Tooltip content={agentTip}>
                <Link to={actorHref(agent.slug)} className="hover:underline">{agent.name}</Link>
              </Tooltip>
            </th>
            {HEADERS.map((h, i) => (
              <Tooltip key={h.key} content={`${totals[i]} ${h.label}`}>
                <th className="mono text-[10px] pb-2" style={thStyle(h)}>{h.key}</th>
              </Tooltip>
            ))}
          </tr>
        </thead>
        <tbody>
          {agent.categories.map((cat) => {
            const startIndex = rowCounter;
            rowCounter += cat.primitives.length;
            return <CategoryRows key={cat.title} cat={cat} startIndex={startIndex} agentSlug={agent.slug} />;
          })}
        </tbody>
      </table>
    </article>
  );
}
