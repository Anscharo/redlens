// Curated Atlas Processes report. Backend port of the /reports/processes page:
// it reuses the exact pure derivation (src/lib/processesIndex.ts) against the
// committed public/processes.json inventory + live doc titles/doc_nos, so the
// model sees the same one-row-per-process rollup the UI shows.
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { config } from "../config.ts";
import { buildProcessRows, processSearchFields, type ProcessEntry } from "../../lib/processesIndex.ts";
import { indexesToDocs } from "./ix-adapter.ts";
import { applyReportFilter } from "./report-filter.ts";
import { readPublicJson, rowsEnvelope } from "./util.ts";
import { defineReportTool } from "./report-tool.ts";

export function buildProcessesReport(
  ix: Indexes,
  opts: { filter?: string },
  publicDir: string = config.publicDir,
): ToolResult {
  const entries = readPublicJson<ProcessEntry[]>("processes.json", publicDir) ?? [];
  const allRows = buildProcessRows(indexesToDocs(ix), entries);
  const matched = applyReportFilter(allRows, opts.filter, processSearchFields);
  return rowsEnvelope("processes", matched, "processes");
}

export const processesTool = defineReportTool({
  name: "atlas_report_processes",
  title: "Atlas Report Processes",
  description:
    "Curated report (not raw graph calls) — the hand-curated inventory of governance, settlement, lifecycle, and " +
    "operational processes (public/processes.json), joined against live doc titles/doc_nos. Each row: the doc, its " +
    "category, whether it's a child-document or inline process, active/deferred-stub status, and a step count.",
  promptBlurb: "the curated governance/settlement/lifecycle/ops process inventory.",
  params: ["filter"],
  build: buildProcessesReport,
});
