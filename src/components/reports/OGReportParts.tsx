import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import type { MergedSource } from "../../lib/dutyCollapse";
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

// One doc-no link; the owning agent (merged rows) rides along as both a hover
// tooltip and an aria-label (a bare title attribute is invisible to screen
// readers and touch).
function DocLink({ uuid, docNo, agent, rq }: { uuid: string; docNo: string; agent?: string; rq: ReportQuery }) {
  return (
    <AtlasLink
      to={atlasHref(uuid)}
      title={agent}
      aria-label={agent ? `${docNo} — ${agent}` : undefined}
      className="mono text-xs text-accent hover:underline text-left"
    >
      <Highlight text={docNo} rq={rq} />
    </AtlasLink>
  );
}

export function DocCell({
  r,
  rq = EMPTY_QUERY,
}: {
  r: { uuid: string; docNo: string; sources?: MergedSource[] };
  rq?: ReportQuery;
}) {
  // A row that merged several per-agent doc replicas links every copy, not
  // just the representative — each copy is a real atlas doc a reader may need.
  if (r.sources && r.sources.length > 1) {
    return (
      <ul className="flex flex-col gap-0.5">
        {r.sources.map((s) => (
          <li key={s.uuid}>
            <DocLink uuid={s.uuid} docNo={s.docNo} agent={s.agent} rq={rq} />
          </li>
        ))}
      </ul>
    );
  }
  return r.uuid ? (
    <DocLink uuid={r.uuid} docNo={r.docNo} rq={rq} />
  ) : (
    <span className="mono text-xs text-tan-3 text-left"><Highlight text={r.docNo} rq={rq} /></span>
  );
}
