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

// The evidence layer here is just the matched snippet text — always useful for
// judging a claim, so include_provenance only trims the surrounding context
// down to the raw date text (still enough to say WHICH date and WHERE).
function stripClaimProvenance(c: DateClaim): DateClaim {
  return { ...c, context: c.raw, contextBefore: "", contextAfter: "" };
}

export function buildStaleDatesReportTool(
  ix: Indexes,
  opts: { include_provenance: boolean; filter?: string },
  today: Date = new Date(),
): ToolResult {
  const report = buildStaleDatesReport(indexesToDocs(ix), today);
  const bucket = (claims: DateClaim[], name: string) => {
    const matched = applyReportFilter(claims, opts.filter, staleSearchFields);
    const rows = opts.include_provenance ? matched : matched.map(stripClaimProvenance);
    const { kept, truncated } = fitToBudget(rows);
    return { matchedTotal: matched.length, kept, truncated, name };
  };

  const stale = bucket(report.stale, "stale");
  const dueSoon = bucket(report.dueSoon, "due_soon");
  const upcoming = bucket(report.upcoming, "upcoming");
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
