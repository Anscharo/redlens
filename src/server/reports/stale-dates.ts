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
import type { VoteIndex } from "../../lib/votes/vote-index.ts";
import { loadVoteIndexFromDisk } from "../votes.ts";
import { indexesToDocs } from "./ix-adapter.ts";
import { applyReportFilter } from "./report-filter.ts";
import { defineReportTool, type ReportArgs } from "./report-tool.ts";

type ClaimRow = Omit<DateClaim, "vote">;

// The evidence layer here is just the matched snippet text — always useful for
// judging a claim, so include_provenance only trims the surrounding context
// down to the raw date text (still enough to say WHICH date and WHERE). The
// vote reference is the matcher's input; its result, voteEvidence, is what a
// reader needs.
function toRow({ vote: _vote, ...c }: DateClaim, opts: ReportArgs): ClaimRow {
  return opts.include_provenance ? c : { ...c, context: c.raw, contextBefore: "", contextAfter: "" };
}

interface Bucket {
  matchedTotal: number;
  kept: ClaimRow[];
  truncated: boolean;
}

function bucket(claims: DateClaim[], opts: ReportArgs): Bucket {
  const matched = applyReportFilter(claims, opts.filter, staleSearchFields);
  const { kept, truncated } = fitToBudget(matched.map((c) => toRow(c, opts)));
  return { matchedTotal: matched.length, kept, truncated };
}

export function buildStaleDatesReportTool(
  ix: Indexes,
  opts: ReportArgs,
  today: Date = new Date(),
  votes: VoteIndex | null = loadVoteIndexFromDisk(),
): ToolResult {
  const report = buildStaleDatesReport(indexesToDocs(ix), today, votes);
  const buckets = {
    stale: bucket(report.stale, opts),
    due_soon: bucket(report.dueSoon, opts),
    upcoming: bucket(report.upcoming, opts),
    recorded: bucket(report.recorded, opts),
  };
  const all = Object.values(buckets);
  const truncated = all.some((b) => b.truncated);
  const result: ToolResult = {
    report: "stale_dates",
    total: all.reduce((n, b) => n + b.matchedTotal, 0),
    returned: all.reduce((n, b) => n + b.kept.length, 0),
    truncated,
    total_date_mentions: report.totalDateMentions,
    vote_record: votes ? `executives ${votes.first} → ${votes.last}` : "unavailable — no voteEvidence on rows",
    ...Object.fromEntries(Object.entries(buckets).map(([k, b]) => [k, b.kept])),
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}

export const staleDatesTool = defineReportTool({
  name: "atlas_report_stale_dates",
  title: "Atlas Report Stale Dates",
  description:
    "Curated report (not raw graph calls) — the Redline Portal's OWN computed report, not atlas text: every future-tense dated claim " +
    "in atlas prose checked against today, bucketed stale (date passed) / due_soon (within a week) / upcoming, plus " +
    "recorded: past-tense sentences that say a dated Executive Vote did something. Each row: the doc, the matched date " +
    "text, its ISO boundary date, days until/since stale, and voteEvidence — what the Sky vote record (executive votes and " +
    "governance polls) shows: enacted, vote-on-date, pending, subject-missing (an executive on that date never mentions " +
    "what the atlas says it carried), no-vote, not-covered, authorised (a poll links the doc) or unlinked (no evidence " +
    "either way). The Atlas itself never defines \"stale\" — this is the Redline Portal's own extraction; say so if asked " +
    "what the concept means.",
  promptBlurb:
    "The Redline Portal's own dated-claim scan (stale / due-soon / upcoming / recorded), checked against the Sky vote record — not an atlas concept.",
  params: ["include_provenance", "filter"],
  build: buildStaleDatesReportTool,
});
