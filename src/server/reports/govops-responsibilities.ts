// Curated Operational GovOps Responsibilities report. Backend port of the
// /reports/gov-ops-responsibilities page: it reuses the exact pure derivation
// (src/lib/govopsResponsibilities.ts) via the ix-adapter, so the model sees the
// same output the UI shows — every GovOps role definition, duty, per-Executor
// assignment, active-data responsibility, and process step in one call, keyed by
// category, instead of the model reconstructing it from duty_for /
// *_govops_for / responsible_party_for edges by hand.
import type { Indexes } from "../indexes.ts";
import type { ToolResult } from "../tools.ts";
import { fitToBudget, TRUNCATION_HINT } from "../output-budget.ts";
import {
  deriveGovOpsResponsibilities,
  CATEGORY_LABELS,
  type OGResponsibility,
} from "../../lib/govopsResponsibilities.ts";
import { indexesToGraphData, indexesToBundle } from "./ix-adapter.ts";

export function buildGovOpsResponsibilitiesReport(
  ix: Indexes,
  opts: { include_provenance: boolean },
): ToolResult {
  const rows = deriveGovOpsResponsibilities(indexesToBundle(ix), indexesToGraphData(ix));

  // provenance for this report = the multi-doc `sources` array on collapsed duty
  // rows (which docs merged into a row). docNo/uuid are identity, always kept.
  const shaped: OGResponsibility[] = opts.include_provenance
    ? rows
    : rows.map(({ sources: _sources, ...rest }) => rest);

  // Category rollup in the report's canonical order, so the model can see the
  // shape (and whether a category is empty) without scanning every row.
  const categories: Record<string, number> = {};
  for (const cat of Object.keys(CATEGORY_LABELS) as OGResponsibility["category"][]) {
    const n = rows.reduce((c, r) => c + (r.category === cat ? 1 : 0), 0);
    if (n) categories[CATEGORY_LABELS[cat]] = n;
  }

  const { kept, truncated } = fitToBudget(shaped);
  const result: ToolResult = {
    report: "govops_responsibilities",
    total: rows.length,
    returned: kept.length,
    truncated,
    categories,
    responsibilities: kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
