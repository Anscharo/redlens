// Curated OEA Task Assessment report. Backend port of the /reports/oea-assessment
// page: unlike the graph-derived reports, oea-report.json is ALREADY the fully
// joined rollup (built by scripts/required/build-oea-report.ts against live
// docs at build time — see src/lib/oeaReport.ts's createOeaReport) — the page
// just displays report.rows verbatim, so this tool does too. No live doc join
// needed at request time.
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { config } from "../config.ts";
import { oeaSearchFields, type OeaReportArtifact, type OeaRow } from "../../lib/oeaReport.ts";
import { applyReportFilter } from "./report-filter.ts";
import { readPublicJson, rowsEnvelope } from "./util.ts";
import { defineReportTool } from "./report-tool.ts";

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
  return rowsEnvelope("oea_assessment", rows, "rows", {
    rubric_version: artifact?.rubricVersion ?? null,
    model: artifact?.model ?? null,
    summary: artifact?.summary ?? null,
  });
}

export const oeaAssessmentTool = defineReportTool({
  name: "atlas_report_oea_assessment",
  title: "Atlas Report OEA Assessment",
  description:
    "Curated report (not raw graph calls) — every task the Operational Executor Agent performs, rated weak/mid/strong " +
    "for definitional precision and for incentives/penalties. AI-drafted against a fixed rubric, human-reviewed. Each " +
    "row: the task, its rating + reasoning, and freshness status (fresh/stale/unassessed) against the live atlas text.",
  promptBlurb: "every Operational Executor Agent task rated for precision and incentives.",
  params: ["include_provenance", "filter"],
  build: buildOeaAssessmentReport,
});
