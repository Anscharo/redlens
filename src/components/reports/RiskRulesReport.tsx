import { useMemo } from "react";
import { loadAtlas } from "@/lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { useHydrateAddressMap } from "../../hooks/useHydrateAddressMap";
import { enumerateRiskCandidates, RISK_DOMAIN_LABELS, type RiskDomain } from "@/lib/riskRules";
import type { Rating } from "@/lib/oeaAssessment";
import { loadRiskAssessment, joinRisk, riskRowsToCSV, type RiskJoin, type RiskRow, type RiskRowStatus } from "@/lib/riskAssessmentIndex";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { categoryCodec } from "./CategoryPills";
import { RiskTable, riskSearchFields } from "./RiskRulesTable";
import { Link } from "../Link";
import { ROUTES } from "@/lib/routes";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { ReportShell } from "./ReportShell";
import { DOMAINS, RiskRulesControls, RiskSummaryStrip, SCORES, riskPillCounts, type Score } from "./RiskRulesControls";
import { useExpandedRow } from "./useExpandedRow";
import { useReportFilter, useReportList, useReportQuery } from "./useReportQuery";

const REPORT: ReportId = "risk-rules";

// Header-box text filter over the fields declared in RiskRulesTable (which
// also tracks their visibility for the hidden-match aside). Domain/precision/
// incentives/status are pill-owned and excluded; the text filter ANDs with
// the pills.
const SEARCHES = "doc no · title · summary · source paragraph · owning prime agent";

const scoreCodec = categoryCodec(Object.fromEntries(SCORES.map((s) => [s, s])) as Record<Score, string>);
const ratingCodec = categoryCodec<Rating>({ weak: "weak", mid: "mid", strong: "strong" });
const statusCodec = categoryCodec<RiskRowStatus>({ fresh: "fresh", stale: "stale", unassessed: "unassessed" });
// Filter changes re-render a long list — apply them in a transition so the
// pill click stays responsive.
const DEFER = { transition: true };

export function RiskRulesReport({ query, mode, onNavigate }: { query: string; mode: ReportMode; onNavigate: (id: string) => void }) {
  const atlas = useLoaded(loadAtlas);
  const artifact = useLoaded(loadRiskAssessment);
  // Curated explorer URLs for address linkification in quotes on direct visits.
  useHydrateAddressMap();
  const [domains, toggleDomain] = useReportList<RiskDomain>(REPORT, "domain", DOMAINS, "domain", DEFER);
  const [score, toggleScore] = useReportFilter<Score>(REPORT, "precision", scoreCodec, "precision", DEFER);
  const [enforce, toggleEnforce] = useReportFilter<Rating>(REPORT, "incentives", ratingCodec, "incentives", DEFER);
  const [status, toggleStatus] = useReportFilter<RiskRowStatus>(REPORT, "status", statusCodec, "status", DEFER);
  const [expanded, toggleExpanded] = useExpandedRow(REPORT);

  const join = useMemo<RiskJoin>(() => {
    if (!atlas) return { rows: [], untriaged: 0, rejected: 0 };
    return joinRisk(enumerateRiskCandidates(atlas).candidates, artifact);
  }, [atlas, artifact]);

  const toggleRow = (row: RiskRow) =>
    toggleExpanded(row.candidate.taskKey, {
      node_id: row.candidate.uuid,
      domain: row.triage.domains[0] ?? row.candidate.domains[0] ?? null,
      status: row.status,
    });

  // Memoized so the row list only recomputes when a filter actually changes
  // (not on unrelated re-renders, e.g. expanding a row) — RiskTable's
  // pagination relies on `rows` keeping a stable identity across those.
  const rq = useReportQuery(query, mode);
  const filtered = useMemo(
    () =>
      filterRows(
        join.rows.filter(
          (r) =>
            (domains.length === 0 || domains.some((d) => r.triage.domains.includes(d))) &&
            (status === null || r.status === status) &&
            (score === null || String(r.entry?.preciseness) === score) &&
            (enforce === null || r.entry?.enforcement === enforce),
        ),
        rq,
        riskSearchFields,
      ),
    [join, domains, status, score, enforce, rq],
  );
  const counts = useMemo(() => riskPillCounts(join), [join]);

  return (
    <ReportShell
      report={REPORT}
      title="Risk Rules Assessment"
      description="Every atlas paragraph that defines a risk-management rule, parameter, or process — peg maintenance, allocation risk, and smart contract security — scored 1–5 for precision and weak/mid/strong for penalties and incentives."
      note={
        <>
          ✳ assessed by {artifact?.assessModel ?? "—"} · human-reviewed ·{" "}
          <Link to={ROUTES.REPORTS_RISK_RUBRIC} className="text-accent hover:underline">
            rubric {artifact?.rubricVersion ?? "—"}
          </Link>
        </>
      }
      noteTitle="Ratings are LLM-drafted against the risk assessment rubric, then human-reviewed. Click a row for the reasoning."
      controls={
        <RiskRulesControls
          domains={domains}
          onDomain={toggleDomain}
          score={score}
          onScore={toggleScore}
          enforce={enforce}
          onEnforce={toggleEnforce}
          status={status}
          onStatus={toggleStatus}
          counts={counts}
        />
      }
      query={query}
      filters={[
        ...domains.map((d) => RISK_DOMAIN_LABELS[d]),
        score && `precision:${score}`,
        enforce && `incentives:${enforce}`,
        status && `status:${status}`,
      ]}
      searches={SEARCHES}
      count={join.rows.length > 0 ? <RiskSummaryStrip join={join} shown={filtered.length} /> : undefined}
      actions={
        join.rows.length > 0 ? (
          <DownloadCsvButton
            report={REPORT}
            filename="risk-rules-assessment.csv"
            rowCount={filtered.length}
            build={() => riskRowsToCSV(filtered)}
            fullRowCount={join.rows.length}
            buildFull={() => riskRowsToCSV(join.rows)}
            query={query}
            filters={[...domains.map((d) => RISK_DOMAIN_LABELS[d]), score, enforce, status]}
          />
        ) : undefined
      }
      ready={!!artifact && join.rows.length > 0}
      viewProps={{
        row_count: join.rows.length,
        stale_count: counts.status.stale,
        unassessed_count: counts.status.unassessed,
        untriaged_count: join.untriaged,
        rubric_version: artifact?.rubricVersion ?? null,
      }}
      noRows={join.rows.length > 0 && filtered.length === 0}
    >
      {atlas && filtered.length > 0 && (
        <RiskTable rows={filtered} docs={atlas.docs} expandedKey={expanded} onToggle={toggleRow} onNavigate={onNavigate} rq={rq} />
      )}
    </ReportShell>
  );
}
