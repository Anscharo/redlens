// Curated Stale Dates report. Backend port of the /reports/stale-dates page:
// it reuses the exact pure derivation (src/lib/staleDates.ts) against live doc
// content, so the model sees the same future-tense-claims-checked-against-today
// bucketing the UI shows, instead of guessing at a concept the Atlas itself
// never defines (this is SAbR's own computed report, not atlas text).
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { fitToBudget, TRUNCATION_HINT } from "../chat/output-budget.ts";
import { buildStaleDatesReport, type DateClaim } from "../../lib/staleDates.ts";
import { staleSearchFields } from "../../lib/staleDatesSearch.ts";
import { indexesToDocs } from "./ix-adapter.ts";
import { applyReportFilter } from "./report-filter.ts";
import { defineReportTool, type ReportArgs } from "./report-tool.ts";

// The evidence layer here is just the matched snippet text — always useful for
// judging a claim, so include_provenance only trims the surrounding context
// down to the raw date text (still enough to say WHICH date and WHERE).
function stripClaimProvenance(c: DateClaim): DateClaim {
  return { ...c, context: c.raw, contextBefore: "", contextAfter: "" };
}

interface Bucket {
  matchedTotal: number;
  kept: DateClaim[];
  truncated: boolean;
}

function bucket(claims: DateClaim[], opts: ReportArgs): Bucket {
  const matched = applyReportFilter(claims, opts.filter, staleSearchFields);
  const rows = opts.include_provenance ? matched : matched.map(stripClaimProvenance);
  const { kept, truncated } = fitToBudget(rows);
  return { matchedTotal: matched.length, kept, truncated };
}

export function buildStaleDatesReportTool(ix: Indexes, opts: ReportArgs, today: Date = new Date()): ToolResult {
  const report = buildStaleDatesReport(indexesToDocs(ix), today);
  const stale = bucket(report.stale, opts);
  const dueSoon = bucket(report.dueSoon, opts);
  const upcoming = bucket(report.upcoming, opts);
  const truncated = stale.truncated || dueSoon.truncated || upcoming.truncated;

  const result: ToolResult = {
    report: "stale_dates",
    total: stale.matchedTotal + dueSoon.matchedTotal + upcoming.matchedTotal,
    returned: stale.kept.length + dueSoon.kept.length + upcoming.kept.length,
    truncated,
    total_date_mentions: report.totalDateMentions,
    stale: stale.kept,
    due_soon: dueSoon.kept,
    upcoming: upcoming.kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}

export const staleDatesTool = defineReportTool({
  name: "atlas_report_stale_dates",
  title: "Atlas Report Stale Dates",
  description:
    "Curated report (not raw graph calls) — SAbR's OWN computed report, not atlas text: every future-tense dated claim " +
    "in atlas prose checked against today, bucketed stale (date passed) / due_soon (within a week) / upcoming. Each row: " +
    "the doc, the matched date text, its ISO boundary date, and days until/since stale. The Atlas itself never defines " +
    "\"stale\" — this is SAbR's own extraction; say so if asked what the concept means.",
  promptBlurb: "SAbR's own dated-claim scan (stale / due-soon / upcoming) — not an atlas concept.",
  params: ["include_provenance", "filter"],
  build: buildStaleDatesReportTool,
});
