// Curated Operational GovOps Responsibilities report. Backend port of the
// /reports/gov-ops-responsibilities page: it reuses the exact pure derivation
// (src/lib/govopsResponsibilities.ts) via the ix-adapter, so the model sees the
// same categorized output the UI shows — every GovOps role definition, duty,
// per-Executor assignment, active-data responsibility, and process step in one
// call, instead of the model reconstructing it from duty_for / *_govops_for /
// responsible_party_for edges by hand. The shared shaping lives in
// ./responsibilities.
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { deriveGovOpsResponsibilities, ogSearchFields, CATEGORY_LABELS } from "../../lib/govopsResponsibilities.ts";
import { indexesToDocs, indexesToGraphData } from "./ix-adapter.ts";
import { buildResponsibilitiesReport } from "./responsibilities.ts";
import { applyReportFilter } from "./report-filter.ts";

export function buildGovOpsResponsibilitiesReport(
  ix: Indexes,
  opts: { include_provenance: boolean; filter?: string },
): ToolResult {
  const all = deriveGovOpsResponsibilities({ docs: indexesToDocs(ix) }, indexesToGraphData(ix));
  const rows = applyReportFilter(all, opts.filter, ogSearchFields);
  return buildResponsibilitiesReport("govops_responsibilities", rows, CATEGORY_LABELS, opts.include_provenance);
}
