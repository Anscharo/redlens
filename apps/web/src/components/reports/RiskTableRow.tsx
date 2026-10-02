// One Risk Rules row: the collapsed summary row plus, when expanded, the
// full-width assessment row beneath it.
import type { AtlasNode } from "@/types";
import type { RiskRow } from "@/lib/riskAssessmentIndex";
import { RISK_DOMAIN_LABELS, type RiskDomain } from "@/lib/riskRules";
import type { ReportQuery } from "@/lib/reportFilter";
import { RatingPill } from "./OeaAssessmentTable";
import { RiskExpandedBody } from "./RiskExpandedBody";
import { RiskDocCell, RiskRuleCell } from "./RiskRuleCell";
import { ScorePill } from "./ScorePill";

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

interface RiskTableRowProps {
  row: RiskRow;
  docs: Record<string, AtlasNode>;
  expanded: boolean;
  onToggle: (row: RiskRow) => void;
  rq: ReportQuery;
}

export function RiskTableRow({ row, docs, expanded, onToggle, rq }: RiskTableRowProps) {
  const e = row.entry;
  return (
    <>
      {/* The whole row toggles the assessment; inner links stopPropagation.
          The chevron button stays as the keyboard/AT path for the same action. */}
      <tr onClick={() => onToggle(row)}
        className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors cursor-pointer">
        <RiskDocCell row={row} rq={rq} />
        <RiskRuleCell row={row} expanded={expanded} onToggle={onToggle} rq={rq} />
        <td className="py-2 px-3 align-top"><DomainPills row={row} /></td>
        <td className="py-2 px-3 align-top"><ScorePill s={e?.preciseness ?? null} /></td>
        <td className="py-2 px-3 align-top"><RatingPill r={e?.enforcement ?? null} /></td>
      </tr>
      {expanded && (
        <tr className="border-t border-[var(--border)]">
          <td colSpan={5} className="py-3 px-3 bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]">
            <RiskExpandedBody row={row} docs={docs} rq={rq} />
          </td>
        </tr>
      )}
    </>
  );
}
