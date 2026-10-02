// Collapsed summary row of a Processes report entry: chevron, doc number and
// title links, steps, status, and short UUID. Clicking the row toggles it;
// the links stop propagation so they navigate without toggling.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { HEADER_OFFSET } from "../../lib/layout";
import type { ProcessRow as ProcessRowData } from "@/lib/processesIndex";
import type { LocalIgnore } from "../../lib/curationStore";
import type { ReportQuery } from "@/lib/reportFilter";
import { Highlight } from "./Highlight";
import { ProcessStatusCell } from "./ProcessStatusCell";
import { ProcessStepsCell } from "./ProcessStepsCell";

const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

function ProcessLinkCell({ uuid, text, className, rq }: { uuid: string; text: string; className: string; rq: ReportQuery }) {
  return (
    <td className="py-2 px-3 align-top">
      <AtlasLink to={atlasHref(uuid)} onClick={stopPropagation} className={className}>
        <Highlight text={text} rq={rq} />
      </AtlasLink>
    </td>
  );
}

type ProcessSummaryRowProps = {
  r: ProcessRowData;
  expanded: boolean;
  onToggle: () => void;
  existing: LocalIgnore | undefined;
  rq: ReportQuery;
};

export function ProcessSummaryRow({ r, expanded, onToggle, existing, rq }: ProcessSummaryRowProps) {
  return (
    <tr
      id={r.uuid}
      onClick={onToggle}
      aria-expanded={expanded}
      style={{ scrollMarginTop: HEADER_OFFSET }}
      className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
    >
      <td className="py-2 px-3 align-top w-6 text-tan-3 mono text-[10px]" aria-hidden>
        {expanded ? "▾" : "▸"}
      </td>
      <ProcessLinkCell uuid={r.uuid} text={r.docNo} rq={rq} className="mono text-xs text-accent hover:underline text-left" />
      <ProcessLinkCell uuid={r.uuid} text={r.title} rq={rq} className="text-sm text-tan hover:underline text-left" />
      <td className="py-2 px-3 align-top">
        <ProcessStepsCell count={r.stepCount} shape={r.shape} />
      </td>
      <ProcessStatusCell status={r.status} existing={existing} />
      <td className="py-2 px-3 align-top mono text-[10px] text-tan-3" title={r.uuid}>
        {r.uuid.slice(0, 8)}
      </td>
    </tr>
  );
}
