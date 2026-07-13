import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import type { Chain } from "../../lib/reportChains";
import { Highlight } from "./Highlight";
import { EMPTY_QUERY, type ReportQuery } from "../../lib/reportFilter";

export function AgentChips({ agents, chains, rq = EMPTY_QUERY }: { agents: string[]; chains: Map<string, Chain>; rq?: ReportQuery }) {
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
            <Highlight text={a} rq={rq} flex />
          </AtlasLink>
        ) : (
          <span key={a} className="mono text-xs px-1.5 py-0.5 text-tan-3"><Highlight text={a} rq={rq} flex /></span>
        );
      })}
    </div>
  );
}

export function DocCell({ r, rq = EMPTY_QUERY }: { r: { uuid: string; docNo: string }; rq?: ReportQuery }) {
  return r.uuid ? (
    <AtlasLink to={atlasHref(r.uuid)} className="mono text-xs text-accent hover:underline text-left">
      <Highlight text={r.docNo} rq={rq} />
    </AtlasLink>
  ) : (
    <span className="mono text-xs text-tan-3 text-left"><Highlight text={r.docNo} rq={rq} /></span>
  );
}
