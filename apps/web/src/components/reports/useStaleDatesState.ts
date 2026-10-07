// Data loading + filtered buckets for the Stale Dates report.
import { useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { loadVoteIndex } from "../../lib/votes";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUTCDay } from "../../hooks/useUTCDay";
import { buildStaleDatesReport, DUE_SOON_DAYS, type DateClaim, type StaleDatesReport } from "@/lib/staleDates";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import { staleSearchFields } from "@/lib/staleDatesSearch";
import { useReportQuery } from "./useReportQuery";

type BucketKey = "upcoming" | "dueSoon" | "stale" | "recorded";

const SECTIONS: {
  key: BucketKey;
  title: string;
  hint: string;
  tone: string;
  textTone?: string; // heading text when the bar tone is too dark to read on --bg
}[] = [
  {
    key: "upcoming",
    title: "Upcoming",
    hint: "The atlas's live calendar — future claims with dates still ahead.",
    tone: "var(--accent)",
  },
  {
    key: "dueSoon",
    title: `Due within ${DUE_SOON_DAYS} days`,
    hint: "Future claims about to cross today — stale soon unless the atlas is updated.",
    tone: "var(--warn)",
  },
  {
    key: "stale",
    title: "Stale",
    hint: "The date has passed but the atlas still phrases the event as future.",
    tone: "var(--red)", // left bar only — keeps the selected-node idiom
    textTone: "var(--error-text)", // --red is below 3:1 on --bg; use the accessible alias
  },
  {
    key: "recorded",
    title: "Recorded votes",
    hint: "Sentences that say a dated Executive Vote already did something — checked against the vote record, since past tense is not proof.",
    tone: "var(--tan-3)",
  },
];

type Section = (typeof SECTIONS)[number] & { claims: readonly DateClaim[] };

// The CSV exports what's on screen — the filtered buckets, not the full scan
// — so a downloaded file matches the active query (totalDateMentions is the
// scan tally and stays informational).
function onScreenReport(report: StaleDatesReport, sections: Section[]): StaleDatesReport {
  const claimsFor = (key: BucketKey) => [...(sections.find((s) => s.key === key)?.claims ?? [])];
  return {
    ...report,
    upcoming: claimsFor("upcoming"),
    dueSoon: claimsFor("dueSoon"),
    stale: claimsFor("stale"),
    recorded: claimsFor("recorded"),
  };
}

// Wrapped so "still loading" (null) differs from "loaded, but there is no vote record" ({ index: null }).
const loadVotes = () => loadVoteIndex().then((index) => ({ index }));

export function useStaleDatesState(query: string, mode: ReportMode) {
  // A load failure re-throws out of useLoaded into the route's ErrorBoundary,
  // which owns the error + retry UI for every page. The vote record never
  // fails: without it the report renders with no vote evidence.
  const docs = useLoaded(loadDocs);
  const votes = useLoaded(loadVotes);
  const day = useUTCDay();
  // Recomputed from the loaded atlas + the current UTC day — no build step
  // involved, and the day-keyed memo re-buckets a tab left open past midnight.
  const report = useMemo(
    () => (docs && votes ? buildStaleDatesReport(docs, new Date(`${day}T12:00:00Z`), votes.index) : null),
    [docs, votes, day],
  );
  // Text filter applies within each bucket; buckets keep their order/heading.
  const rq = useReportQuery(query, mode);
  const sections = useMemo(
    () =>
      report ? SECTIONS.map((s) => ({ ...s, claims: filterRows(report[s.key], rq, staleSearchFields) })) : null,
    [report, rq],
  );
  const csvReport = useMemo(() => (report && sections ? onScreenReport(report, sections) : null), [report, sections]);
  return {
    report,
    voteRecord: votes?.index ?? null,
    rq,
    sections,
    csvReport,
    anyShown: sections?.some((s) => s.claims.length > 0) ?? false,
  };
}
