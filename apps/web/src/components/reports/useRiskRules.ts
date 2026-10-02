// URL-synced pill state and the derived row set for the Risk Rules Assessment
// report. Domain is multi-select (a row can carry several domains); the rest
// are single-select. The pills AND with each other and with the text filter.
import { useMemo } from "react";
import { loadAtlas } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadRiskAssessment } from "../../lib/riskAssessmentLoad";
import { enumerateRiskCandidates, RISK_DOMAIN_LABELS, type RiskDomain } from "@/lib/riskRules";
import type { Rating } from "@/lib/oeaAssessment";
import type { RiskAssessmentArtifact } from "@/lib/riskAssessment";
import { joinRisk, riskSearchFields, type RiskJoin, type RiskRow, type RiskRowStatus } from "@/lib/riskAssessmentIndex";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { categoryCodec } from "./CategoryPills";
import { DOMAINS, SCORES, riskPillCounts, type RiskPillCounts, type Score } from "./RiskRulesControls";
import { useExpandedRow } from "./useExpandedRow";
import { useReportFilter, useReportList, useReportQuery } from "./useReportQuery";

export const REPORT: ReportId = "risk-rules";

const scoreCodec = categoryCodec(Object.fromEntries(SCORES.map((s) => [s, s])) as Record<Score, string>);
const ratingCodec = categoryCodec<Rating>({ weak: "weak", mid: "mid", strong: "strong" });
const statusCodec = categoryCodec<RiskRowStatus>({ fresh: "fresh", stale: "stale", unassessed: "unassessed" });
// Filter changes re-render a long list — apply them in a transition so the
// pill click stays responsive.
const DEFER = { transition: true };

export interface RiskFilters {
  domains: RiskDomain[];
  onDomain: (next: RiskDomain) => void;
  score: Score | null;
  onScore: (next: Score) => void;
  enforce: Rating | null;
  onEnforce: (next: Rating) => void;
  status: RiskRowStatus | null;
  onStatus: (next: RiskRowStatus) => void;
}

export function useRiskFilters(): RiskFilters {
  const [domains, onDomain] = useReportList<RiskDomain>(REPORT, "domain", DOMAINS, "domain", DEFER);
  const [score, onScore] = useReportFilter<Score>(REPORT, "precision", scoreCodec, "precision", DEFER);
  const [enforce, onEnforce] = useReportFilter<Rating>(REPORT, "incentives", ratingCodec, "incentives", DEFER);
  const [status, onStatus] = useReportFilter<RiskRowStatus>(REPORT, "status", statusCodec, "status", DEFER);
  return { domains, onDomain, score, onScore, enforce, onEnforce, status, onStatus };
}

/** Domain labels for the active domain pills, in pill order. */
export const domainLabels = (f: RiskFilters) => f.domains.map((d) => RISK_DOMAIN_LABELS[d]);

type Pills = Pick<RiskFilters, "domains" | "status" | "score" | "enforce">;

function matchesPills(r: RiskRow, { domains, status, score, enforce }: Pills): boolean {
  return (
    (domains.length === 0 || domains.some((d) => r.triage.domains.includes(d))) &&
    (status === null || r.status === status) &&
    (score === null || String(r.entry?.preciseness) === score) &&
    (enforce === null || r.entry?.enforcement === enforce)
  );
}

export function useRiskRows(f: RiskFilters, query: string, mode: ReportMode) {
  const atlas = useLoaded(loadAtlas);
  const artifact = useLoaded(loadRiskAssessment);
  const join = useMemo<RiskJoin>(() => {
    if (!atlas) return { rows: [], untriaged: 0, rejected: 0 };
    return joinRisk(enumerateRiskCandidates(atlas).candidates, artifact);
  }, [atlas, artifact]);
  // Memoized so the row list only recomputes when a filter actually changes
  // (not on unrelated re-renders, e.g. expanding a row) — RiskTable's
  // pagination relies on `rows` keeping a stable identity across those.
  const rq = useReportQuery(query, mode);
  const { domains, status, score, enforce } = f;
  const filtered = useMemo(
    () => filterRows(join.rows.filter((r) => matchesPills(r, { domains, status, score, enforce })), rq, riskSearchFields),
    [join, domains, status, score, enforce, rq],
  );
  const counts = useMemo(() => riskPillCounts(join), [join]);
  return { atlas, artifact, rq, join, filtered, counts };
}

/** `report_view` properties: the size of the row universe and its backlog. */
export function riskViewProps(join: RiskJoin, counts: RiskPillCounts, artifact: RiskAssessmentArtifact | null) {
  return {
    row_count: join.rows.length,
    stale_count: counts.status.stale,
    unassessed_count: counts.status.unassessed,
    untriaged_count: join.untriaged,
    rubric_version: artifact?.rubricVersion ?? null,
  };
}

export function useRiskExpandedRow() {
  const [expanded, toggleExpanded] = useExpandedRow(REPORT);
  const toggleRow = (row: RiskRow) =>
    toggleExpanded(row.candidate.taskKey, {
      node_id: row.candidate.uuid,
      domain: row.triage.domains[0] ?? row.candidate.domains[0] ?? null,
      status: row.status,
    });
  return [expanded, toggleRow] as const;
}
