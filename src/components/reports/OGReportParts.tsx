import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import type { Chain } from "../../lib/reportChains";

export function AgentChips({ agents, chains }: { agents: string[]; chains: Map<string, Chain> }) {
  if (!agents.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {agents.map((a) => {
        const c = chains.get(a);
        return c ? (
          <AtlasLink
            key={a}
            to={atlasHref(c.agentId)}
            className="mono text-xs px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors"
          >
            {a}
          </AtlasLink>
        ) : (
          <span key={a} className="mono text-xs px-1.5 py-0.5 text-tan-3">{a}</span>
        );
      })}
    </div>
  );
}

export function DocCell({ r }: { r: { uuid: string; docNo: string } }) {
  return r.uuid ? (
    <AtlasLink to={atlasHref(r.uuid)} className="mono text-xs text-accent hover:underline text-left">
      {r.docNo}
    </AtlasLink>
  ) : (
    <span className="mono text-xs text-tan-3 text-left">{r.docNo}</span>
  );
}
