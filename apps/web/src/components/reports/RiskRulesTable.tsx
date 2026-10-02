// Paged table of Risk Rules Assessment rows; each row expands in place to
// show its assessment reasoning.
import type { AtlasNode } from "@/types";
import type { RiskRow } from "@/lib/riskAssessmentIndex";
import { usePagedRows } from "../../hooks/usePagedRows";
import { EMPTY_QUERY, type ReportQuery } from "@/lib/reportFilter";
import { RiskTableRow } from "./RiskTableRow";

export { ScorePill } from "./ScorePill";

interface RiskTableProps {
  rows: readonly RiskRow[];
  docs: Record<string, AtlasNode>;
  expandedKey: string | null;
  onToggle: (row: RiskRow) => void;
  rq?: ReportQuery;
}

function RiskTableHead() {
  return (
    <thead>
      <tr className="text-xs mono text-tan-3">
        <th className="py-1 px-3 font-normal w-40">Doc</th>
        <th className="py-1 px-3 font-normal">Rule</th>
        <th className="py-1 px-3 font-normal w-40">Risk Type</th>
        <th className="py-1 px-3 font-normal w-28">Precision</th>
        <th className="py-1 px-3 font-normal w-28">Incentives</th>
      </tr>
    </thead>
  );
}

export function RiskTable({ rows, docs, expandedKey, onToggle, rq = EMPTY_QUERY }: RiskTableProps) {
  const { visible, remaining, showMore } = usePagedRows(rows);
  return (
    <div className="mb-8">
      <table className="w-full text-left">
        <RiskTableHead />
        <tbody>
          {visible.map((row) => (
            <RiskTableRow key={row.candidate.taskKey} row={row} docs={docs}
              expanded={expandedKey === row.candidate.taskKey} onToggle={onToggle} rq={rq} />
          ))}
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
