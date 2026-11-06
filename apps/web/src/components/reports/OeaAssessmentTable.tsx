import type { PrecisionElement } from "@/lib/oeaAssessment";
import { PRECISION_ELEMENTS } from "@/lib/oeaAssessment";
import type { OeaMechanism, OeaRow } from "@/lib/oeaReport";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { usePagedRows } from "../../hooks/usePagedRows";
import { EMPTY_QUERY, type ReportQuery } from "@/lib/reportFilter";
import { Highlight } from "./Highlight";
import { RatingPill } from "./OeaRatingPill";
import { OeaTableRow } from "./OeaTableRow";


const ELEMENT_LABELS: Record<PrecisionElement, string> = {
  actor: "Actor", trigger: "Trigger", action: "Action",
  timeBound: "Time bound", completion: "Completion", discretion: "Discretion",
};
const STATE_STYLE = { present: "text-tan", partial: "text-tan-2", absent: "text-tan-3 line-through" };

function ExpandedBody({ row, mechanisms, rq }: { row: OeaRow; mechanisms: Record<string, OeaMechanism>; rq: ReportQuery }) {
  const e = row.entry;
  if (!e)
    return (
      <div className="space-y-3 text-sm">
        <blockquote className="mono text-xs text-tan-2 border-l-2 border-[var(--border)] pl-3">
          <Highlight text={row.task.assessedText} rq={rq} />
        </blockquote>
        <p className="text-xs text-tan-3">Not yet assessed — run `pnpm oea:assess`.</p>
      </div>
    );
  return (
    <div className="space-y-3 text-sm">
      <blockquote className="mono text-xs text-tan-2 border-l-2 border-[var(--border)] pl-3">
        <Highlight text={e.assessedText} rq={rq} />
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
  label, rows, mechanisms, expandedKey, onToggle, rq = EMPTY_QUERY,
}: {
  label: string;
  rows: readonly OeaRow[];
  mechanisms: Record<string, OeaMechanism>;
  expandedKey: string | null;
  onToggle: (row: OeaRow) => void;
  rq?: ReportQuery;
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
            <th className="py-1 px-3 font-normal">Task</th>
            <th className="py-1 px-3 font-normal w-24">Precision</th>
            <th className="py-1 px-3 font-normal w-24">Incentives</th>
            <th className="py-1 px-3 font-normal w-24" />
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const expanded = expandedKey === row.task.taskKey;
            return (
              <OeaTableRow
                key={row.task.taskKey}
                row={row}
                expanded={expanded}
                onToggle={() => onToggle(row)}
                rq={rq}
              >
                <ExpandedBody row={row} mechanisms={mechanisms} rq={rq} />
              </OeaTableRow>
            );
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
