// Curated Risk Rules Assessment report. Backend port of the /reports/risk-rules
// page: it reuses the exact pure derivation (src/lib/riskRules.ts's
// enumerateRiskCandidates + src/lib/riskAssessmentIndex.ts's joinRisk) against
// the live candidate universe, so a rating is flagged stale the moment the
// atlas changes under it — the same freshness guarantee the report page gives,
// never a silently-reused rating from a renumbered or edited paragraph.
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { config } from "../config.ts";
import { fitToBudget, TRUNCATION_HINT } from "../chat/output-budget.ts";
import { enumerateRiskCandidates } from "../../lib/riskRules.ts";
import { joinRisk, riskSearchFields, type RiskRow } from "../../lib/riskAssessmentIndex.ts";
import type { RiskAssessmentArtifact } from "../../lib/riskAssessment.ts";
import type { AtlasBundle } from "../../lib/docsTypes.ts";
import { indexesToDocs } from "./ix-adapter.ts";
import { applyReportFilter } from "./report-filter.ts";
import { readPublicJson } from "./util.ts";

// The reasoning strings + full triage description are the provenance layer
// here. Drop them for the leaner (include_provenance:false) rollup; the
// resolved rating/status and the rated paragraph stay.
function stripRowProvenance(r: RiskRow): RiskRow {
  return r.entry
    ? { ...r, entry: { ...r.entry, precisenessReasoning: "", enforcementReasoning: "" } }
    : r;
}

export function buildRiskRulesReport(
  ix: Indexes,
  opts: { include_provenance: boolean; filter?: string },
  publicDir: string = config.publicDir,
): ToolResult {
  // enumerateRiskCandidates only reads bundle.docs (see ix-adapter.ts's
  // indexesToDocs comment) — the byParent/docNoToId maps it never touches are
  // deliberately not built here.
  const bundle = { docs: indexesToDocs(ix) } as AtlasBundle;
  const { candidates } = enumerateRiskCandidates(bundle);
  const artifact = readPublicJson<RiskAssessmentArtifact>("risk-assessment.json", publicDir);
  const { rows: allRows, untriaged, rejected } = joinRisk(candidates, artifact);

  const matched = applyReportFilter(allRows, opts.filter, riskSearchFields);
  const rows = opts.include_provenance ? matched : matched.map(stripRowProvenance);

  const { kept, truncated } = fitToBudget(rows);
  const result: ToolResult = {
    report: "risk_rules",
    total: matched.length,
    returned: kept.length,
    truncated,
    rubric_version: artifact?.rubricVersion ?? null,
    // A risk-shaped paragraph isn't automatically a row: untriaged means the
    // triage script hasn't reached it yet, rejected means triage said
    // out-of-scope or not-a-rule. Surfaced so "why isn't X here" is answerable
    // without a second tool call.
    untriaged,
    rejected,
    rows: kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
