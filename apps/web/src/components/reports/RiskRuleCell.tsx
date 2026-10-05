// The Doc and Rule cells of a Risk Rules row. Doc: the hidden-match aside and
// the doc number linking into the atlas. Rule: expand chevron, title,
// stub/status badges, and the triage description while collapsed.
import { riskSearchFields, type RiskRow } from "@/lib/riskAssessmentIndex";
import { hiddenMatches, type ReportQuery } from "@/lib/reportFilter";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "../AtlasLink";
import { Highlight, MatchAside } from "./Highlight";

export function RiskDocCell({ row, rq }: { row: RiskRow; rq: ReportQuery }) {
  return (
    <td className="py-2 px-3 align-top relative">
      <MatchAside matches={hiddenMatches(riskSearchFields(row), rq)} rq={rq} />
      <AtlasLink to={atlasHref(row.candidate.uuid)} onClick={(ev) => ev.stopPropagation()}
        className="mono text-xs text-accent hover:underline">
        <Highlight text={row.candidate.docNo} rq={rq} />
      </AtlasLink>
    </td>
  );
}

interface RiskRuleCellProps {
  row: RiskRow;
  expanded: boolean;
  onToggle: (row: RiskRow) => void;
  rq: ReportQuery;
}

export function RiskRuleCell({ row, expanded, onToggle, rq }: RiskRuleCellProps) {
  return (
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
      <span className="text-tan"><Highlight text={row.candidate.title} rq={rq} /></span>
      {row.candidate.stub && <span className="mono text-[10px] text-tan-3 ml-1.5">[stub]</span>}
      {row.status !== "fresh" && (
        <span className={`badge ml-1.5 ${row.status === "stale" ? "badge-red" : "badge-muted"}`}>{row.status}</span>
      )}
      {!expanded && <p className="text-xs text-tan-2 mt-0.5 line-clamp-2"><Highlight text={row.triage.description} rq={rq} /></p>}
    </td>
  );
}
