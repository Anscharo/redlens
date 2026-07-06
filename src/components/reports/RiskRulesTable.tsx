import type { AtlasNode } from "../../types";
import type { Preciseness } from "../../lib/riskAssessment";
import type { RiskRow } from "../../lib/riskAssessmentIndex";
import { RatingPill } from "./OeaAssessmentTable";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import { usePagedRows } from "../../hooks/usePagedRows";

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
          Preciseness <ScorePill s={e.preciseness} />
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
        ✳ assessed by {e.model} · rubric {e.rubricVersion}
        {row.status === "stale" && " · STALE — the atlas changed since this rating; re-queued on next run"}
      </p>
    </div>
  );
}

export function RiskTable({
  label, rows, docs, expandedKey, onToggle,
}: {
  label: string;
  rows: RiskRow[];
  docs: Record<string, AtlasNode>;
  expandedKey: string | null;
  onToggle: (taskKey: string) => void;
}) {
  const { visible, remaining, showMore } = usePagedRows(rows);
  return (
    <div className="mb-8">
      <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
        {label} <span className="text-tan-3/60">({rows.length})</span>
      </h2>
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs mono text-tan-3">
            <th className="py-1 px-3 font-normal w-40">Doc</th>
            <th className="py-1 px-3 font-normal">Rule</th>
            <th className="py-1 px-3 font-normal w-28">Preciseness</th>
            <th className="py-1 px-3 font-normal w-28">Incentives</th>
            <th className="py-1 px-3 font-normal w-24" />
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const expanded = expandedKey === row.candidate.taskKey;
            const e = row.entry;
            return [
              <tr key={row.candidate.taskKey}
                className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
                onClick={() => onToggle(row.candidate.taskKey)} aria-expanded={expanded}>
                <td className="py-2 px-3 align-top">
                  <AtlasLink to={atlasHref(row.candidate.uuid)} className="mono text-xs text-accent hover:underline"
                    onClick={(ev) => ev.stopPropagation()}>
                    {row.candidate.docNo}
                  </AtlasLink>
                </td>
                <td className="py-2 px-3 align-top text-sm">
                  <span className="mono text-xs text-tan-3 mr-1.5">{expanded ? "▾" : "▸"}</span>
                  <AtlasLink to={atlasHref(row.candidate.uuid)} className="text-tan hover:underline"
                    onClick={(ev) => ev.stopPropagation()}>
                    {row.candidate.title}
                  </AtlasLink>
                  {row.candidate.stub && <span className="mono text-[10px] text-tan-3 ml-1.5">[stub]</span>}
                  {!expanded && <p className="text-xs text-tan-2 mt-0.5 line-clamp-2">{row.triage.description}</p>}
                </td>
                <td className="py-2 px-3 align-top"><ScorePill s={e?.preciseness ?? null} /></td>
                <td className="py-2 px-3 align-top">
                  <RatingPill r={e?.enforcement ?? null} />
                  {e && <span className="text-tan-3 text-[10px] ml-1 cursor-help" title={`assessed by ${e.model}`}>✳</span>}
                </td>
                <td className="py-2 px-3 align-top">
                  {row.status !== "fresh" && (
                    <span className={`badge ${row.status === "stale" ? "badge-red" : "badge-muted"}`}>{row.status}</span>
                  )}
                </td>
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
