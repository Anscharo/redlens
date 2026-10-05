// Curated Operational Facilitator Responsibilities report. Backend port of the
// /reports/of-responsibilities page: it reuses the exact pure derivation
// (src/lib/facilitatorResponsibilities.ts) via the ix-adapter, so the model sees
// the same categorized output the UI shows — every Facilitator duty, assignment,
// active-data responsibility, and process step in one call, instead of the model
// reconstructing it from duty_for / *_facilitator_for / responsible_party_for
// edges by hand. The shared shaping lives in ./responsibilities.
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { deriveFacilitatorResponsibilities, ofSearchFields, CATEGORY_LABELS } from "../../lib/facilitatorResponsibilities.ts";
import { indexesToDocs, indexesToGraphData } from "./ix-adapter.ts";
import { buildResponsibilitiesReport } from "./responsibilities.ts";
import { applyReportFilter } from "./report-filter.ts";
import { defineReportTool } from "./report-tool.ts";

export function buildFacilitatorResponsibilitiesReport(
  ix: Indexes,
  opts: { include_provenance: boolean; filter?: string },
): ToolResult {
  const all = deriveFacilitatorResponsibilities({ docs: indexesToDocs(ix) }, indexesToGraphData(ix));
  const rows = applyReportFilter(all, opts.filter, ofSearchFields);
  return buildResponsibilitiesReport("facilitator_responsibilities", rows, CATEGORY_LABELS, opts.include_provenance);
}

export const facilitatorResponsibilitiesTool = defineReportTool({
  name: "atlas_report_facilitator_responsibilities",
  title: "Atlas Report Facilitator Responsibilities",
  description:
    "Curated report (not raw graph calls) — every Operational/Core Facilitator responsibility in one call, answers " +
    "'what is a Facilitator responsible for' without reconstructing it from duty_for / *_facilitator_for / " +
    "responsible_party_for edges. Each row: duty text, category, and the agent/facilitator/executor it's " +
    "attributed to. Sources only with include_provenance:true.",
  promptBlurb:
    "every Operational/Core Facilitator responsibility grouped by category with duty text + attribution — 'what is a Facilitator responsible for'.",
  params: ["include_provenance", "filter"],
  build: buildFacilitatorResponsibilitiesReport,
});
