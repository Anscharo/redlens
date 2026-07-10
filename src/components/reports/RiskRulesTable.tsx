import type { AtlasNode } from "../../types";
import type { Preciseness } from "../../lib/riskAssessment";
import type { RiskRow } from "../../lib/riskAssessmentIndex";
import { RISK_DOMAIN_LABELS, type RiskDomain } from "../../lib/riskRules";
import { RatingPill } from "./OeaAssessmentTable";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import { usePagedRows } from "../../hooks/usePagedRows";
import { hiddenMatches, type SearchField } from "../../lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";

// The search haystack as labelled fields; the rated paragraph (quote) and
// covered prime agents only render in the expanded body, so matches on them
// surface via the floating aside. Keep in sync with the cells below.
export const riskSearchFields = (r: RiskRow): SearchField[] => [
  { label: "doc no", value: r.candidate.docNo },
  { label: "title", value: r.candidate.title },
  { label: "summary", value: r.triage.description ?? "" },
  { label: "rule text", value: r.candidate.quote, hidden: true },
  { label: "prime agent", value: (r.candidate.agents ?? []).join(", "), hidden: true, despace: true },
];

const SCORE_STYLE: Record<Preciseness, string> = {
  1: "bg-[color-mix(in_srgb,var(--red)_35%,transparent)] text-tan",
  2: "bg-[color-mix(in_srgb,var(--red)_20%,transparent)] text-tan",
  3: "bg-[var(--hover)] text-tan-2",
  4: "bg-[color-mix(in_srgb,var(--terminal-green)_18%,transparent)] text-tan",
  5: "bg-[color-mix(in_srgb,var(--terminal-green)_30%,transparent)] text-tan",
};

export function ScorePill({ s }: { s: Preciseness | null }) {
  if (!s) return <span className="mono text-[10px] text-tan-3">—</span>;
  return <span className={`mono text-[10px] px-1.5 py-0.5 rounded ${SCORE_STYLE[s]}`}>{s}/5</span>;
}

function ExpandedBody({ row, docs }: { row: RiskRow; docs: Record<string, AtlasNode> }) {
  const e = row.entry;
  if (!e) return <p className="text-xs text-tan-3">Not yet assessed — run `pnpm risk:assess`.</p>;
  return (
    <div className="space-y-3 text-sm">
      <blockquote className="mono text-xs text-tan-2 border-l-2 border-[var(--border)] pl-3 whitespace-pre-wrap">
        {e.quote}
      </blockquote>
      <div>
        <p className="mono text-[10px] text-tan-3 uppercase tracking-wider mb-1">
          Precision <ScorePill s={e.preciseness} />
        </p>
        <p className="text-tan-2">{e.precisenessReasoning}</p>
        {e.metrics.length > 0 && (
          <p className="mono text-[11px] text-tan-3 mt-1">
            metrics: {e.metrics.map((m) => (
              <span key={m} className="px-1.5 py-0.5 rounded bg-[var(--hover)] text-tan-2 mr-1.5">{m}</span>
            ))}
          </p>
        )}
      </div>
      <div>
        <p className="mono text-[10px] text-tan-3 uppercase tracking-wider mb-1">
          Penalties / Incentives <RatingPill r={e.enforcement} />
        </p>
        <p className="text-tan-2">{e.enforcementReasoning}</p>
        {e.mechanismUuids.length > 0 && (
          <p className="text-xs mt-1">
            {e.mechanismUuids.map((u) => (
              <AtlasLink key={u} to={atlasHref(u)} className="text-accent hover:underline mr-3">
                {docs[u]?.title ?? u.slice(0, 8)} ↗
              </AtlasLink>
            ))}
          </p>
        )}
      </div>
      {row.candidate.agents && row.candidate.agents.length > 1 && (
        <p className="mono text-[10px] text-tan-3">replicated across: {row.candidate.agents.join(", ")}</p>
      )}
      <p className="mono text-[10px] text-tan-3">
        ✳ assessed by {e.model}
        {row.status === "stale" && " · STALE — the atlas changed since this rating; re-queued on next run"}
      </p>
    </div>
  );
}

function DomainPills({ row }: { row: RiskRow }) {
  const domains = (row.triage.domains.length ? row.triage.domains : row.candidate.domains) as RiskDomain[];
  return (
    <span className="flex flex-wrap gap-1">
      {domains.map((d) => (
        <span key={d} className="mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-tan-2 whitespace-nowrap">
          {RISK_DOMAIN_LABELS[d]}
        </span>
      ))}
    </span>
  );
}

export function RiskTable({
  rows, docs, expandedKey, onToggle, tokens = [],
}: {
  rows: RiskRow[];
  docs: Record<string, AtlasNode>;
  expandedKey: string | null;
  onToggle: (row: RiskRow) => void;
  tokens?: string[];
}) {
  const { visible, remaining, showMore } = usePagedRows(rows);
  return (
    <div className="mb-8">
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs mono text-tan-3">
            <th className="py-1 px-3 font-normal w-40">Doc</th>
            <th className="py-1 px-3 font-normal">Rule</th>
            <th className="py-1 px-3 font-normal w-40">Risk Type</th>
            <th className="py-1 px-3 font-normal w-28">Precision</th>
            <th className="py-1 px-3 font-normal w-28">Incentives</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const expanded = expandedKey === row.candidate.taskKey;
            const e = row.entry;
            return [
              // The whole row toggles the assessment; inner links stopPropagation.
              // The chevron button stays as the keyboard/AT path for the same action.
              <tr key={row.candidate.taskKey}
                onClick={() => onToggle(row)}
                className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors cursor-pointer">
                <td className="py-2 px-3 align-top relative">
                  <MatchAside matches={hiddenMatches(riskSearchFields(row), tokens)} tokens={tokens} />
                  <AtlasLink to={atlasHref(row.candidate.uuid)} onClick={(ev) => ev.stopPropagation()}
                    className="mono text-xs text-accent hover:underline">
                    <Highlight text={row.candidate.docNo} tokens={tokens} />
                  </AtlasLink>
                </td>
                <td className="py-2 px-3 align-top text-sm">
                  <button
                    type="button"
                    className="mono text-xs text-tan-3 mr-1.5 hover:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-sm"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Collapse" : "Expand"} assessment reasoning for ${row.candidate.title}`}
                    onClick={(ev) => { ev.stopPropagation(); onToggle(row); }}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                  <span className="text-tan"><Highlight text={row.candidate.title} tokens={tokens} /></span>
                  {row.candidate.stub && <span className="mono text-[10px] text-tan-3 ml-1.5">[stub]</span>}
                  {row.status !== "fresh" && (
                    <span className={`badge ml-1.5 ${row.status === "stale" ? "badge-red" : "badge-muted"}`}>{row.status}</span>
                  )}
                  {!expanded && <p className="text-xs text-tan-2 mt-0.5 line-clamp-2"><Highlight text={row.triage.description} tokens={tokens} /></p>}
                </td>
                <td className="py-2 px-3 align-top"><DomainPills row={row} /></td>
                <td className="py-2 px-3 align-top"><ScorePill s={e?.preciseness ?? null} /></td>
                <td className="py-2 px-3 align-top"><RatingPill r={e?.enforcement ?? null} /></td>
              </tr>,
              expanded && (
                <tr key={`${row.candidate.taskKey}:x`} className="border-t border-[var(--border)]">
                  <td colSpan={5} className="py-3 px-3 bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]">
                    <ExpandedBody row={row} docs={docs} />
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
      {remaining > 0 && (
        <button
          type="button"
          onClick={showMore}
          className="mono text-xs text-accent hover:underline mt-2"
        >
          Show {Math.min(remaining, 100)} more ({remaining} remaining)
        </button>
      )}
    </div>
  );
}
