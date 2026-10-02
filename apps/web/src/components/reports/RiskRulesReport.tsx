import { useHydrateAddressMap } from "../../hooks/useHydrateAddressMap";
import { RiskTable } from "./RiskRulesTable";
import { Link } from "../Link";
import { ROUTES } from "@/lib/routes";
import type { ReportMode } from "@/lib/reportFilter";
import { ReportShell } from "./ReportShell";
import { RiskRulesControls, RiskSummaryStrip } from "./RiskRulesControls";
import { RiskRulesCsvButton } from "./RiskRulesCsvButton";
import { REPORT, domainLabels, riskViewProps, useRiskExpandedRow, useRiskFilters, useRiskRows } from "./useRiskRules";

// Header-box text filter over the fields declared in RiskRulesTable (which
// also tracks their visibility for the hidden-match aside). Domain/precision/
// incentives/status are pill-owned and excluded; the text filter ANDs with
// the pills.
const SEARCHES = "doc no · title · summary · source paragraph · owning prime agent";

function RiskRulesNote({ model, rubric }: { model: string | undefined; rubric: string | undefined }) {
  return (
    <>
      ✳ assessed by {model ?? "—"} · human-reviewed ·{" "}
      <Link to={ROUTES.REPORTS_RISK_RUBRIC} className="text-accent hover:underline">
        rubric {rubric ?? "—"}
      </Link>
    </>
  );
}

export function RiskRulesReport({ query, mode }: { query: string; mode: ReportMode }) {
  // Curated explorer URLs for address linkification in quotes on direct visits.
  useHydrateAddressMap();
  const f = useRiskFilters();
  const [expanded, toggleRow] = useRiskExpandedRow();
  const { atlas, artifact, rq, join, filtered, counts } = useRiskRows(f, query, mode);
  const hasRows = join.rows.length > 0;

  return (
    <ReportShell
      report={REPORT}
      description="Every atlas paragraph that defines a risk-management rule, parameter, or process — peg maintenance, allocation risk, and smart contract security — scored 1–5 for precision and weak/mid/strong for penalties and incentives."
      note={<RiskRulesNote model={artifact?.assessModel} rubric={artifact?.rubricVersion} />}
      noteTitle="Ratings are LLM-drafted against the risk assessment rubric, then human-reviewed. Click a row for the reasoning."
      controls={<RiskRulesControls {...f} counts={counts} />}
      query={query}
      filters={[...domainLabels(f), f.score && `precision:${f.score}`, f.enforce && `incentives:${f.enforce}`, f.status && `status:${f.status}`]}
      searches={SEARCHES}
      count={hasRows ? <RiskSummaryStrip join={join} shown={filtered.length} /> : undefined}
      actions={hasRows ? <RiskRulesCsvButton rows={join.rows} filtered={filtered} query={query} filters={f} /> : undefined}
      ready={!!artifact && hasRows}
      viewProps={riskViewProps(join, counts, artifact)}
      noRows={hasRows && filtered.length === 0}
    >
      {atlas && filtered.length > 0 && (
        <RiskTable rows={filtered} docs={atlas.docs} expandedKey={expanded} onToggle={toggleRow} rq={rq} />
      )}
    </ReportShell>
  );
}
