// Curated Operational Facilitator Responsibilities report. This is the backend
// port of the /reports/of-responsibilities page: it reuses the exact pure
// derivation (src/lib/facilitatorResponsibilities.ts) via the ix-adapter, so
// the model sees the same duty-collapse / attribution output the UI shows —
// every Facilitator duty, assignment, active-data responsibility, and process
// step in one call, keyed by category, instead of the model reconstructing it
// from duty_for / *_facilitator_for / responsible_party_for edges by hand.
import type { Indexes } from "../indexes.ts";
import type { ToolResult } from "../tools.ts";
import { fitToBudget, TRUNCATION_HINT } from "../output-budget.ts";
import {
  deriveFacilitatorResponsibilities,
  CATEGORY_LABELS,
  type OFResponsibility,
} from "../../lib/facilitatorResponsibilities.ts";
import { indexesToGraphData, indexesToBundle } from "./ix-adapter.ts";

export function buildFacilitatorResponsibilitiesReport(
  ix: Indexes,
  opts: { include_provenance: boolean },
): ToolResult {
  const rows = deriveFacilitatorResponsibilities(indexesToBundle(ix), indexesToGraphData(ix));

  // provenance for this report = the multi-doc `sources` array on collapsed duty
  // rows (which docs merged into a row). docNo/uuid are identity, always kept.
  const shaped: OFResponsibility[] = opts.include_provenance
    ? rows
    : rows.map(({ sources: _sources, ...rest }) => rest);

  // Category rollup in the report's canonical order, so the model can see the
  // shape (and whether a category is empty) without scanning every row.
  const categories: Record<string, number> = {};
  for (const cat of Object.keys(CATEGORY_LABELS) as OFResponsibility["category"][]) {
    const n = rows.reduce((c, r) => c + (r.category === cat ? 1 : 0), 0);
    if (n) categories[CATEGORY_LABELS[cat]] = n;
  }

  const { kept, truncated } = fitToBudget(shaped);
  const result: ToolResult = {
    report: "facilitator_responsibilities",
    total: rows.length,
    returned: kept.length,
    truncated,
    categories,
    responsibilities: kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
