// Curated Active Data Index report. Backend port of the /reports/active-data
// page: it reuses the exact pure derivation (src/lib/activeDataIndex.ts) via the
// ix-adapter, so the model sees the same one-row-per-Active-Data-doc rollup the
// UI shows — controller, resolved Responsible Party + evidence chain, the
// prime→executor→facilitator/govops chain, and the update process — in one call,
// instead of walking active_data_for / responsible_party_for / role edges by hand.
//
// (The UI additionally decorates rows with last-edit dates from history; that's
// client-side and NOT part of buildActiveDataRows, so it isn't included here.)
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { fitToBudget, TRUNCATION_HINT } from "../chat/output-budget.ts";
import { buildActiveDataRows, adSearchFields, type ActiveDataRow } from "../../lib/activeDataIndex.ts";
import { indexesToGraphData, indexesToDocs } from "./ix-adapter.ts";
import { applyReportFilter } from "./report-filter.ts";

// The evidence arrays are the provenance layer — the ordered doc_no chain that
// proves each Responsible Party / Facilitator resolution. Drop them for the
// leaner (include_provenance:false) rollup; the resolved names/roles stay.
function stripRowProvenance(r: ActiveDataRow): ActiveDataRow {
  return {
    ...r,
    responsibleParty: r.responsibleParty ? { ...r.responsibleParty, evidence: [] } : null,
    facilitator: r.facilitator ? { ...r.facilitator, evidence: [] } : null,
  };
}

export function buildActiveDataReport(ix: Indexes, opts: { include_provenance: boolean; filter?: string }): ToolResult {
  const allRows = buildActiveDataRows(indexesToDocs(ix), indexesToGraphData(ix));
  const matched = applyReportFilter(allRows, opts.filter, adSearchFields);

  const rows = opts.include_provenance ? matched : matched.map(stripRowProvenance);

  const { kept, truncated } = fitToBudget(rows);
  const result: ToolResult = {
    report: "active_data",
    total: matched.length,
    returned: kept.length,
    truncated,
    active_data: kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
