// One process entry of the Processes report: the collapsed summary row plus,
// when expanded, a full-width row holding the expanded body.
import type { ProcessRow as ProcessRowData } from "@/lib/processesIndex";
import type { LocalIgnore } from "../../lib/curationStore";
import type { AtlasNode } from "@/types";
import type { ReportQuery } from "@/lib/reportFilter";
import { ProcessExpandedBody } from "./ProcessExpandedBody";
import { ProcessSummaryRow } from "./ProcessSummaryRow";

type ProcessRowProps = {
  r: ProcessRowData;
  node: AtlasNode;
  stepChildren: AtlasNode[];
  expanded: boolean;
  onToggle: () => void;
  existing: LocalIgnore | undefined;
  onMark: (uuid: string, reason: string) => void;
  onUnmark: (uuid: string) => void;
  rq: ReportQuery;
};

export function ProcessRow({ r, node, stepChildren, expanded, onToggle, existing, onMark, onUnmark, rq }: ProcessRowProps) {
  return (
    <>
      <ProcessSummaryRow r={r} expanded={expanded} onToggle={onToggle} existing={existing} rq={rq} />
      {expanded && (
        <tr>
          <td colSpan={6} className="p-0">
            <ProcessExpandedBody
              node={node}
              steps={stepChildren}
              existing={existing}
              onMark={onMark}
              onUnmark={onUnmark}
            />
          </td>
        </tr>
      )}
    </>
  );
}
