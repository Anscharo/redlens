// Pill groups + summary strip for the Risk Rules Assessment report. Risk Type
// is multi-select (a row can carry several domains); the rest are single-select.
import { RISK_DOMAIN_LABELS, type RiskDomain } from "../../lib/riskRules";
import type { Rating } from "../../lib/oeaAssessment";
import { summarizeRisk, type RiskJoin, type RiskRowStatus } from "../../lib/riskAssessmentIndex";
import { CategoryPills } from "./CategoryPills";

export const DOMAINS = Object.keys(RISK_DOMAIN_LABELS) as RiskDomain[];
export const SCORES = ["1", "2", "3", "4", "5"] as const;
export type Score = (typeof SCORES)[number];
const RATINGS = ["weak", "mid", "strong"] as const;
const STATUSES = ["fresh", "stale", "unassessed"] as const;

export interface RiskPillCounts {
  domain: Record<RiskDomain, number>;
  score: Record<Score, number>;
  enforce: Record<Rating, number>;
  status: Record<RiskRowStatus, number>;
}

// Pill counts describe the UNFILTERED universe so they don't jump around while
// filtering. Domain counts use the same any-tag matching as the filter (rows
// carry multiple domains, so these overlap and sum to > total).
export function riskPillCounts(join: RiskJoin): RiskPillCounts {
  const s = summarizeRisk(join.rows);
  const domain: Record<RiskDomain, number> = { peg: 0, alloc: 0, sc: 0 };
  for (const r of join.rows) for (const d of r.triage.domains) domain[d as RiskDomain]++;
  return {
    domain,
    score: Object.fromEntries(SCORES.map((k) => [k, s.preciseness[Number(k) as 1 | 2 | 3 | 4 | 5]])) as Record<Score, number>,
    enforce: s.enforcement,
    status: { fresh: join.rows.length - s.stale - s.unassessed, stale: s.stale, unassessed: s.unassessed },
  };
}

export function RiskSummaryStrip({ join, shown }: { join: RiskJoin; shown: number }) {
  const total = join.rows.length;
  return (
    <p className="mono text-xs text-tan-3">
      {shown === total ? (
        `${total.toLocaleString()} Atlas sections match the filter`
      ) : (
        <>
          <strong className="font-semibold text-tan">{shown.toLocaleString()}</strong>
          {` of ${total.toLocaleString()} Atlas sections match the filter`}
        </>
      )}
      {join.untriaged > 0 && ` · ${join.untriaged} awaiting triage`}
    </p>
  );
}

export function RiskRulesControls({
  domains,
  onDomain,
  score,
  onScore,
  enforce,
  onEnforce,
  status,
  onStatus,
  counts,
}: {
  domains: RiskDomain[];
  onDomain: (next: RiskDomain) => void;
  score: Score | null;
  onScore: (next: Score) => void;
  enforce: Rating | null;
  onEnforce: (next: Rating) => void;
  status: RiskRowStatus | null;
  onStatus: (next: RiskRowStatus) => void;
  counts: RiskPillCounts;
}) {
  return (
    <div className="flex flex-col gap-2 mb-6">
      <CategoryPills label="Risk Type" labelTitle="Broad category of risk assessment" categories={DOMAINS} active={domains} onToggle={onDomain} display={RISK_DOMAIN_LABELS} counts={counts.domain} hint="multi-select" />
      <CategoryPills label="Precision" labelTitle="How clearly does this section describe a risk-related rule?" categories={SCORES} active={score} onToggle={onScore} counts={counts.score} hint={<>1 vague <span className="enlargen">→</span> 5 precise</>} />
      <CategoryPills label="Incentives" labelTitle="Does this section include a consequence or predetermined action?" categories={RATINGS} active={enforce} onToggle={onEnforce} counts={counts.enforce} />
      <CategoryPills label="Status" labelTitle="Has this section been updated since the report was last refreshed?" categories={STATUSES} active={status} onToggle={onStatus} counts={counts.status} />
    </div>
  );
}
