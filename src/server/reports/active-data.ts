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
import { buildActiveDataRows, adSearchFields, type ActiveDataRow } from "../../lib/activeDataIndex.ts";
import { indexesToGraphData, indexesToDocs } from "./ix-adapter.ts";
import { applyReportFilter } from "./report-filter.ts";
import { rowsEnvelope } from "./util.ts";
import { defineReportTool } from "./report-tool.ts";

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
  return rowsEnvelope("active_data", rows, "active_data");
}

export const activeDataTool = defineReportTool({
  name: "atlas_report_active_data",
  title: "Atlas Report Active Data",
  description:
    "Curated report (not raw graph calls) — one row per Active Data document, for 'who maintains / is responsible " +
    "for this Active Data'. Each row: the doc, its controller, resolved Responsible Party (direct/chain/role), " +
    "approving Facilitator, and update process (Direct Edit vs. Alignment Conserver Changes). Evidence chains " +
    "only with include_provenance:true.",
  promptBlurb:
    "one row per Active Data doc (controller, resolved Responsible Party with evidence, prime→executor→facilitator/govops chain, approving Facilitator, update process) — 'who maintains / is responsible for this Active Data'.",
  params: ["include_provenance", "filter"],
  build: buildActiveDataReport,
});
