// Curated OEA Task Assessment report. Backend port of the /reports/oea-assessment
// page: unlike the graph-derived reports, oea-report.json is ALREADY the fully
// joined rollup (built by scripts/required/build-oea-report.ts against live
// docs at build time — see src/lib/oeaReport.ts's createOeaReport) — the page
// just displays report.rows verbatim, so this tool does too. No live doc join
// needed at request time.
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { config } from "../config.ts";
import { fitToBudget, TRUNCATION_HINT } from "../chat/output-budget.ts";
import { oeaSearchFields, type OeaReportArtifact, type OeaRow } from "../../lib/oeaReport.ts";
import { applyReportFilter } from "./report-filter.ts";
import { readPublicJson } from "./util.ts";

// The reasoning strings are the provenance layer here — always the bulk of a
// row's bytes. Drop them for the leaner (include_provenance:false) rollup;
// the resolved ratings/status stay.
function stripRowProvenance(r: OeaRow): OeaRow {
  return r.entry
    ? { ...r, entry: { ...r.entry, precision: { ...r.entry.precision, reasoning: "" }, incentives: { ...r.entry.incentives, reasoning: "" } } }
    : r;
}

export function buildOeaAssessmentReport(
  _ix: Indexes,
  opts: { include_provenance: boolean; filter?: string },
  publicDir: string = config.publicDir,
): ToolResult {
  const artifact = readPublicJson<OeaReportArtifact>("oea-report.json", publicDir);
  const allRows = artifact?.rows ?? [];
  const matched = applyReportFilter(allRows, opts.filter, oeaSearchFields);
  const rows = opts.include_provenance ? matched : matched.map(stripRowProvenance);

  const { kept, truncated } = fitToBudget(rows);
  const result: ToolResult = {
    report: "oea_assessment",
    total: matched.length,
    returned: kept.length,
    truncated,
    rubric_version: artifact?.rubricVersion ?? null,
    model: artifact?.model ?? null,
    summary: artifact?.summary ?? null,
    rows: kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
