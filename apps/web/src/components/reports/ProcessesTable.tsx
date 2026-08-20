// One category block of the Processes report: heading + the rows in that
// category. The report renders one of these per category present.
import type { AtlasNode } from "@/types";
import type { ProcessRow as ProcessRowData } from "../../lib/processesIndex";
import { getStepChildren } from "../../lib/processesIndex";
import type { LocalIgnore } from "../../lib/curationStore";
import type { ReportQuery } from "@/lib/reportFilter";
import { ProcessRow } from "./ProcessRow";

const COLUMNS: [label: string, width: string][] = [
  ["", "w-6"],
  ["Doc #", "w-32"],
  ["Title", ""],
  ["Steps", "w-28"],
  ["Status", "w-28"],
  ["UUID", "w-20"],
];

export function ProcessesTable({
  category,
  rows,
  docs,
  childrenByParentDocNo,
  expandedUuid,
  onToggle,
  onNavigate,
  ignoresByUuid,
  onMark,
  onUnmark,
  rq,
}: {
  category: string;
  rows: ProcessRowData[];
  docs: Record<string, AtlasNode>;
  childrenByParentDocNo: Map<string, AtlasNode[]>;
  expandedUuid: string | null;
  onToggle: (uuid: string) => void;
  onNavigate: (id: string) => void;
  ignoresByUuid: Map<string, LocalIgnore>;
  onMark: (uuid: string, reason: string) => void;
  onUnmark: (uuid: string) => void;
  rq: ReportQuery;
}) {
  return (
    <div className="mb-8">
      <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
        {category} <span className="text-tan-3">({rows.length})</span>
      </h2>
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs mono text-tan-3">
            {COLUMNS.map(([label, w], i) => (
              <th key={i} className={`py-1 px-3 font-normal ${w}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const node = docs[r.uuid];
            const stepChildren = r.shape === "child" ? getStepChildren(node, childrenByParentDocNo) : [];
            return (
              <ProcessRow
                key={r.uuid}
                r={r}
                node={node}
                stepChildren={stepChildren}
                expanded={expandedUuid === r.uuid}
                onToggle={() => onToggle(r.uuid)}
                onNavigate={onNavigate}
                existing={ignoresByUuid.get(r.uuid)}
                onMark={onMark}
                onUnmark={onUnmark}
                rq={rq}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
