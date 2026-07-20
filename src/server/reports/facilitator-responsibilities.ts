// Curated Operational Facilitator Responsibilities report. Backend port of the
// /reports/of-responsibilities page: it reuses the exact pure derivation
// (src/lib/facilitatorResponsibilities.ts) via the ix-adapter, so the model sees
// the same categorized output the UI shows — every Facilitator duty, assignment,
// active-data responsibility, and process step in one call, instead of the model
// reconstructing it from duty_for / *_facilitator_for / responsible_party_for
// edges by hand. The shared shaping lives in ./responsibilities.
import type { Indexes } from "../indexes.ts";
import type { ToolResult } from "../tools.ts";
import { deriveFacilitatorResponsibilities, CATEGORY_LABELS } from "../../lib/facilitatorResponsibilities.ts";
import { indexesToDocs, indexesToGraphData } from "./ix-adapter.ts";
import { buildResponsibilitiesReport } from "./responsibilities.ts";

export function buildFacilitatorResponsibilitiesReport(
  ix: Indexes,
  opts: { include_provenance: boolean },
): ToolResult {
  const rows = deriveFacilitatorResponsibilities({ docs: indexesToDocs(ix) }, indexesToGraphData(ix));
  return buildResponsibilitiesReport("facilitator_responsibilities", rows, CATEGORY_LABELS, opts.include_provenance);
}
