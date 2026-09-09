// Curated Atlas Processes report. Backend port of the /reports/processes page:
// it reuses the exact pure derivation (src/lib/processesIndex.ts) against the
// committed public/processes.json inventory + live doc titles/doc_nos, so the
// model sees the same one-row-per-process rollup the UI shows.
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { config } from "../config.ts";
import { fitToBudget, TRUNCATION_HINT } from "../chat/output-budget.ts";
import { buildProcessRows, processSearchFields, type ProcessEntry } from "../../lib/processesIndex.ts";
import { indexesToDocs } from "./ix-adapter.ts";
import { applyReportFilter } from "./report-filter.ts";
import { readPublicJson } from "./util.ts";

export function buildProcessesReport(
  ix: Indexes,
  opts: { filter?: string },
  publicDir: string = config.publicDir,
): ToolResult {
  const entries = readPublicJson<ProcessEntry[]>("processes.json", publicDir) ?? [];
  const allRows = buildProcessRows(indexesToDocs(ix), entries);
  const matched = applyReportFilter(allRows, opts.filter, processSearchFields);

  const { kept, truncated } = fitToBudget(matched);
  const result: ToolResult = {
    report: "processes",
    total: matched.length,
    returned: kept.length,
    truncated,
    processes: kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
