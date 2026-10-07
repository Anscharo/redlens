// The Stale Dates report as an RFC-4180 CSV string. All four buckets are
// flattened with a leading Bucket column; the vote columns stay empty when the
// report was built without the vote record. "Rules Said" is filled only where
// an AI judge overruled the matching rules.

import { toCSV } from "./csv";
import { atlasUrl } from "./routes";
import type { DateClaim, StaleDatesReport } from "./staleDates";
import { EVIDENCE_LABEL, evidenceSource, missingSubject, ruleDisagrees } from "./votes/labels";

const HEADER = [
  "Bucket", "Doc No", "Title", "UUID", "Atlas Link", "Date Text", "Boundary Date", "Precision", "Days Until Stale",
  "Handoff", "Vote Evidence", "Evidence Source", "Rules Said", "Vote", "Vote Date", "Vote Offset Days", "Vote Link", "Subject Not In Vote", "Context",
];

function row(bucket: string, c: DateClaim): Array<string | number> {
  const e = c.voteEvidence;
  return [
    bucket,
    c.docNo,
    c.title,
    c.docId,
    atlasUrl(c.docId),
    c.raw,
    c.dateISO,
    c.precision,
    c.daysUntilStale,
    c.transition ? "yes" : "",
    e ? EVIDENCE_LABEL[e.status] : "",
    e ? evidenceSource(e) : "",
    e && ruleDisagrees(e) ? EVIDENCE_LABEL[e.judged!.rule] : "",
    e?.vote?.title ?? "",
    e?.vote?.date ?? "",
    e?.vote ? e.vote.offsetDays : "",
    e?.vote?.url ?? "",
    e ? missingSubject(e).join(", ") : "",
    `${c.contextBefore}${c.raw}${c.contextAfter}`,
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
