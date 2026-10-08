// The Stale Dates report as an RFC-4180 CSV string. All four buckets are
// flattened with a leading Bucket column; the vote columns stay empty when the
// report was built without the vote record. "Heuristic Said" is filled only
// where the AI overruled the heuristic.

import { toCSV } from "./csv";
import { atlasUrl } from "./routes";
import type { DateClaim, StaleDatesReport } from "./staleDates";
import type { VoteEvidence } from "./votes/evidence";
import { EVIDENCE_LABEL, matchedVia, missingSubject, ruleDisagrees } from "./votes/labels";

const HEADER = [
  "Bucket", "Doc No", "Title", "UUID", "Atlas Link", "Date Text", "Boundary Date", "Precision", "Days Until Stale",
  "Handoff", "Vote Evidence", "Matched Via", "Heuristic Said", "Vote", "Vote Date", "Vote Offset Days", "Vote Link", "Spell", "Subject Not In Vote", "Context",
];

function row(bucket: string, c: DateClaim): Array<string | number> {
  const claim = [bucket, c.docNo, c.title, c.docId, atlasUrl(c.docId), c.raw, c.dateISO, c.precision, c.daysUntilStale, c.transition ? "yes" : ""];
  return [...claim, ...evidenceCells(c.voteEvidence), `${c.contextBefore}${c.raw}${c.contextAfter}`];
}

/** The vote-evidence columns, blank when the claim has none. */
function evidenceCells(e: VoteEvidence | undefined): Array<string | number> {
  return [
    e ? EVIDENCE_LABEL[e.status] : "",
    e ? (matchedVia(e) ?? "") : "",
    e && ruleDisagrees(e) ? EVIDENCE_LABEL[e.judged!.rule] : "",
    e?.vote?.title ?? "",
    e?.vote?.date ?? "",
    e?.vote ? e.vote.offsetDays : "",
    e?.vote?.url ?? "",
    e?.vote?.spell ?? "",
    e ? missingSubject(e).join(", ") : "",
  ];
}

export function staleDatesToCSV(report: StaleDatesReport): string {
  const bucketed: Array<[string, DateClaim[]]> = [
    ["stale", report.stale],
    ["due-soon", report.dueSoon],
    ["upcoming", report.upcoming],
    ["recorded", report.recorded],
  ];
  return toCSV(HEADER, bucketed.flatMap(([bucket, claims]) => claims.map((c) => row(bucket, c))));
}
