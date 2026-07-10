import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import type { Chain } from "../../lib/reportChains";
import { Highlight } from "./Highlight";

export function AgentChips({ agents, chains, tokens = [] }: { agents: string[]; chains: Map<string, Chain>; tokens?: string[] }) {
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
            <Highlight text={a} tokens={tokens} />
          </AtlasLink>
        ) : (
          <span key={a} className="mono text-xs px-1.5 py-0.5 text-tan-3"><Highlight text={a} tokens={tokens} /></span>
        );
      })}
    </div>
  );
}

export function DocCell({ r, tokens = [] }: { r: { uuid: string; docNo: string }; tokens?: string[] }) {
  return r.uuid ? (
    <AtlasLink to={atlasHref(r.uuid)} className="mono text-xs text-accent hover:underline text-left">
      <Highlight text={r.docNo} tokens={tokens} />
    </AtlasLink>
  ) : (
    <span className="mono text-xs text-tan-3 text-left"><Highlight text={r.docNo} tokens={tokens} /></span>
  );
}
