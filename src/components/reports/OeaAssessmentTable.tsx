import type { Rating, PrecisionElement } from "../../lib/oeaAssessment";
import { PRECISION_ELEMENTS } from "../../lib/oeaAssessment";
import type { OeaMechanism, OeaRow } from "../../lib/oeaReport";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";

const RATING_STYLE: Record<Rating, string> = {
  weak: "bg-[color-mix(in_srgb,var(--red)_30%,transparent)] text-tan",
  mid: "bg-[var(--hover)] text-tan-2",
  strong: "bg-[color-mix(in_srgb,var(--terminal-green)_28%,transparent)] text-tan",
};

export function RatingPill({ r }: { r: Rating | null }) {
  if (!r) return <span className="mono text-[10px] text-tan-3">—</span>;
  return <span className={`mono text-[10px] px-1.5 py-0.5 rounded ${RATING_STYLE[r]}`}>{r}</span>;
}

const ELEMENT_LABELS: Record<PrecisionElement, string> = {
  actor: "Actor", trigger: "Trigger", action: "Action",
  timeBound: "Time bound", completion: "Completion", discretion: "Discretion",
};
const STATE_STYLE = { present: "text-tan", partial: "text-tan-2", absent: "text-tan-3 line-through" };

function ExpandedBody({ row, mechanisms }: { row: OeaRow; mechanisms: Record<string, OeaMechanism> }) {
  const e = row.entry;
  if (!e) return <p className="text-xs text-tan-3">Not yet assessed — run `pnpm oea:assess`.</p>;
  return (
    <div className="space-y-3 text-sm">
      <blockquote className="mono text-xs text-tan-2 border-l-2 border-[var(--border)] pl-3">
        {e.assessedText}
        {!e.quoted && <span className="text-tan-3"> (representative snippet — full document was rated)</span>}
      </blockquote>
      <div>
        <p className="mono text-[10px] text-tan-3 uppercase tracking-wider mb-1">
          Precision <RatingPill r={e.precision.rating} />
        </p>
        <p className="mono text-[11px] mb-1">
          {PRECISION_ELEMENTS.map((k) => (
            <span key={k} className={`mr-3 ${STATE_STYLE[e.precision.elements[k]]}`}
              title={`${ELEMENT_LABELS[k]}: ${e.precision.elements[k]}`}>
              {ELEMENT_LABELS[k]}
            </span>
          ))}
        </p>
        <p className="text-tan-2">{e.precision.reasoning}</p>
      </div>
      <div>
        <p className="mono text-[10px] text-tan-3 uppercase tracking-wider mb-1">
          Incentives <RatingPill r={e.incentives.rating} />
        </p>
        <p className="text-tan-2">{e.incentives.reasoning}</p>
        {e.incentives.mechanismUuids.length > 0 && (
          <p className="text-xs mt-1">
            {e.incentives.mechanismUuids.map((u) => (
              <AtlasLink key={u} to={atlasHref(u)} className="text-accent hover:underline mr-3">
                {mechanisms[u]?.title ?? u.slice(0, 8)} ↗
              </AtlasLink>
            ))}
          </p>
        )}
      </div>
      <p className="mono text-[10px] text-tan-3">
        ✳ assessed by {e.model} · rubric {e.rubricVersion}
        {row.status === "stale" && " · STALE — the atlas changed since this rating; re-queued on next run"}
      </p>
    </div>
  );
}

export function OeaTable({
  label, rows, mechanisms, expandedKey, onToggle,
}: {
  label: string;
  rows: OeaRow[];
  mechanisms: Record<string, OeaMechanism>;
  expandedKey: string | null;
  onToggle: (row: OeaRow) => void;
}) {
  return (
    <div className="mb-8">
      <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
        {label} <span className="text-tan-3/60">({rows.length})</span>
      </h2>
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs mono text-tan-3">
            <th className="py-1 px-3 font-normal w-40">Doc</th>
            <th className="py-1 px-3 font-normal">Task</th>
            <th className="py-1 px-3 font-normal w-24">Precision</th>
            <th className="py-1 px-3 font-normal w-24">Incentives</th>
            <th className="py-1 px-3 font-normal w-24" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedKey === row.task.taskKey;
            const e = row.entry;
            return [
              <tr key={row.task.taskKey}
                className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
                <td className="py-2 px-3 align-top">
                  <AtlasLink to={atlasHref(row.task.uuid)} className="mono text-xs text-accent hover:underline">
                    {row.task.docNo}
                  </AtlasLink>
                </td>
                <td className="py-2 px-3 align-top text-sm">
                  <button
                    type="button"
                    className="mono text-xs text-tan-3 mr-1.5 hover:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-sm"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Collapse" : "Expand"} assessment reasoning for ${row.task.title}`}
                    onClick={() => onToggle(row)}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                  <AtlasLink to={atlasHref(row.task.uuid)} className="text-tan hover:underline"
                  >
                    {row.task.title}
                  </AtlasLink>
                  {row.task.automated && <span className="mono text-[10px] text-tan-3 ml-1.5">[automated]</span>}
                  {!expanded && <p className="text-xs text-tan-2 mt-0.5 line-clamp-2">{row.task.assessedText}</p>}
                </td>
                <td className="py-2 px-3 align-top"><RatingPill r={e?.precision.rating ?? null} /></td>
                <td className="py-2 px-3 align-top">
                  <RatingPill r={e?.incentives.rating ?? null} />
                  {e && <span className="text-tan-3 text-[10px] ml-1 cursor-help" title={`assessed by ${e.model}`}>✳</span>}
                </td>
                <td className="py-2 px-3 align-top">
                  {row.status !== "fresh" && (
                    <span className={`badge ${row.status === "stale" ? "badge-red" : "badge-muted"}`}>{row.status}</span>
                  )}
                </td>
              </tr>,
              expanded && (
                <tr key={`${row.task.taskKey}:x`} className="border-t border-[var(--border)]">
                  <td colSpan={5} className="py-3 px-3 bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]">
                    <ExpandedBody row={row} mechanisms={mechanisms} />
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
