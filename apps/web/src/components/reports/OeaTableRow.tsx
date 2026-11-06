import type { ReactNode } from "react";
import type { OeaRow } from "@/lib/oeaReport";
import { oeaSearchFields } from "@/lib/oeaReport";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { hiddenMatches, type ReportQuery } from "@/lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";
import { OeaRatingCells } from "./OeaRatingPill";

function OeaTaskCell({
  row,
  expanded,
  onToggle,
  rq,
}: {
  row: OeaRow;
  expanded: boolean;
  onToggle: () => void;
  rq: ReportQuery;
}) {
  return (
    <td className="py-2 px-3 align-top text-sm">
      <button
        type="button"
        className="mono text-xs text-tan-3 mr-1.5 hover:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-sm"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} assessment reasoning for ${row.task.title}`}
        onClick={onToggle}
      >
        {expanded ? "▾" : "▸"}
      </button>
      <AtlasLink to={atlasHref(row.task.uuid)} className="text-tan hover:underline">
        <Highlight text={row.task.title} rq={rq} />
      </AtlasLink>
      {row.task.automated && <span className="mono text-[10px] text-tan-3 ml-1.5">[automated]</span>}
      {!expanded && <p className="text-xs text-tan-2 mt-0.5 line-clamp-2"><Highlight text={row.task.assessedText} rq={rq} /></p>}
    </td>
  );
}

// One assessed task: its summary row, then the caller's expanded body (children)
// in a full-width row beneath it while `expanded`.
export function OeaTableRow({
  row,
  expanded,
  onToggle,
  rq,
  children,
}: {
  row: OeaRow;
  expanded: boolean;
  onToggle: () => void;
  rq: ReportQuery;
  children: ReactNode;
}) {
  return (
    <>
      <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
        <td className="py-2 px-3 align-top relative">
          <MatchAside matches={hiddenMatches(oeaSearchFields(row), rq)} rq={rq} />
          <AtlasLink to={atlasHref(row.task.uuid)} className="mono text-xs text-accent hover:underline">
            <Highlight text={row.task.docNo} rq={rq} />
          </AtlasLink>
        </td>
        <OeaTaskCell row={row} expanded={expanded} onToggle={onToggle} rq={rq} />
        <OeaRatingCells row={row} />
      </tr>
      {expanded && (
        <tr className="border-t border-[var(--border)]">
          <td colSpan={5} className="py-3 px-3 bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]">
            {children}
          </td>
        </tr>
      )}
    </>
  );
}
