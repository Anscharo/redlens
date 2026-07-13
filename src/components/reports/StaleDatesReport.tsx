import { useEffect, useMemo, useState } from "react";
import type { AtlasNode } from "../../types";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import { loadDocs } from "../../lib/docs";
import { useUTCDay } from "../../hooks/useUTCDay";
import { buildStaleDatesReport, staleDatesToCSV, DUE_SOON_DAYS, type DateClaim } from "../../lib/staleDates";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { filterRows, hiddenMatches, parseReportQuery, type ReportMode, type ReportQuery, type SearchField } from "../../lib/reportFilter";
import { NoRowsMatch } from "./NoRowsMatch";
import { FilterSummary } from "./FilterSummary";
import { Highlight, MatchAside } from "./Highlight";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2026-07-31" → "July 2026", so month-name queries ("july", "july 2026",
// "jul") match the row through its month POSITION only — never through a
// same-numbered day like 2026-02-07. Rendered as a hidden field: the row
// shows the ISO date, and the aside explains a month-name match.
const monthLabel = (iso: string): string => {
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${iso.slice(0, 4)}` : "";
};

// Header-box text filter: date (ISO + the raw atlas text + a derived
// month-name form), doc title/number, snippet prose, and the "handoff"
// badge word for transition rows.
const searchFields = (c: DateClaim): SearchField[] => [
  { label: "date", value: c.dateISO },
  { label: "month", value: monthLabel(c.dateISO), hidden: true },
  { label: "date text", value: c.raw },
  { label: "title", value: c.title },
  { label: "doc no", value: c.docNo },
  { label: "context", value: c.context },
  { label: "handoff", value: c.transition ? "handoff" : "" },
];
const SEARCHES = "date (ISO + month name) · date text · title · doc no · snippet text";

function staleness(c: DateClaim): string {
  // The viewer's local day and the day the atlas text was written against can
  // differ by a day either way, so near the boundary hedge with "~1d" rather
  // than claiming "today".
  if (Math.abs(c.daysUntilStale) <= 1) return "(~1d)";
  if (c.daysUntilStale < 0) return `(${-c.daysUntilStale}d overdue)`;
  return `(in ${c.daysUntilStale}d)`;
}

const SECTIONS: {
  key: "upcoming" | "dueSoon" | "stale";
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
];

function ClaimRow({ c, tone, rq }: { c: DateClaim; tone: string; rq: ReportQuery }) {
  // The tone lives on a left bar (the selected-node idiom) — --red on the
  // dark background is unreadable as small text, so the date stays tan.
  // The whole row is one link to the doc; the doc number renders as plain
  // text on the right (nested anchors are invalid HTML).
  return (
    <AtlasLink
      to={atlasHref(c.docId)}
      title={c.title}
      className="relative block py-4 px-3 border-b border-l-2 last:border-b-0 no-underline transition-colors hover:bg-[var(--hover)]"
      style={{ borderColor: "var(--border)", borderLeftColor: tone }}
    >
      <MatchAside matches={hiddenMatches(searchFields(c), rq)} rq={rq} />
      <div className="flex items-baseline gap-6 flex-wrap">
        <span className="flex items-baseline gap-2">
          <span className="mono text-base font-semibold text-tan"><Highlight text={c.dateISO} rq={rq} /></span>
          <span className="mono text-base text-tan-2">{staleness(c)}</span>
        </span>
        <span className="text-lg text-tan"><Highlight text={c.title} rq={rq} /></span>
        {c.transition && (
          <span
            className="mono text-xs px-1.5 py-0.5 rounded"
            style={{ background: "var(--hover)", color: "var(--accent)" }}
            title="Operational control handoff — checked against the date the transition was estimated for"
          >
            handoff
          </span>
        )}
        <span className="mono text-xs text-accent ml-auto"><Highlight text={c.docNo} rq={rq} /></span>
      </div>
      <p className="text-sm mt-1 ml-4 text-tan-2" style={{ maxWidth: "95ch" }}>
        …<Highlight text={c.contextBefore} rq={rq} />
        <em><Highlight text={c.raw} rq={rq} /></em>
        <Highlight text={c.contextAfter} rq={rq} />…
      </p>
    </AtlasLink>
  );
}

function Section({ title, hint, claims, tone, textTone, rq }: { title: string; hint: string; claims: readonly DateClaim[]; tone: string; textTone?: string; rq: ReportQuery }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-0.5" style={{ color: textTone ?? tone }}>
        {title} <span className="mono text-base text-tan-3">({claims.length})</span>
      </h2>
      <p className="text-base text-tan-3 mb-2">{hint}</p>
      {claims.length === 0 ? (
        <p className="mono text-base text-tan-3">none</p>
      ) : (
        claims.map((c, i) => <ClaimRow key={`${c.docId}:${c.dateISO}:${i}`} c={c} tone={tone} rq={rq} />)
      )}
    </section>
  );
}

export function StaleDatesReport({ query, mode }: { query: string; mode: ReportMode }) {
  useDocumentTitle("Stale Dates: Sky Atlas by Redline");
  const [docs, setDocs] = useState<Record<string, AtlasNode> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const day = useUTCDay();

  useEffect(() => {
    setError(null);
    loadDocs().then(setDocs).catch((err) => setError(String(err)));
  }, [attempt]);

  // Recomputed from the loaded atlas + the current UTC day — no build step
  // involved, and the day-keyed memo re-buckets a tab left open past midnight.
  const report = useMemo(
    () => (docs ? buildStaleDatesReport(docs, new Date(`${day}T12:00:00Z`)) : null),
    [docs, day],
  );

  // Text filter applies within each bucket; buckets keep their order/heading.
  const rq = useMemo(() => parseReportQuery(query, mode), [query, mode]);
  const sections = useMemo(
    () =>
      report
        ? SECTIONS.map((s) => ({ ...s, claims: filterRows(report[s.key], rq, searchFields) }))
        : null,
    [report, rq],
  );
  const anyShown = sections?.some((s) => s.claims.length > 0) ?? false;

  return (
    <div className="px-6 py-6">
      <div className="max-w-4xl mx-auto">
        <p className="mono text-base text-tan-3 mb-1">report</p>
        <h1 className="text-2xl font-semibold mb-1 text-tan">Stale Dates</h1>
        <p className="text-lg text-tan-3 mb-6">
          Future-tense claims in atlas prose ("will be included in the … Executive Vote") checked
          against today's date. An overdue claim means the event happened and the text was never
          updated — or it slipped.
          {report && (
            <span className="mono text-base"> {report.totalDateMentions} dated mentions scanned.</span>
          )}
        </p>
        <FilterSummary query={query} searches={SEARCHES} />
        {report && (
          <div className="flex justify-end mb-4">
            <DownloadCsvButton
              report="stale-dates"
              filename="stale-dates.csv"
              rowCount={report.stale.length + report.dueSoon.length + report.upcoming.length}
              build={() => staleDatesToCSV(report)}
            />
          </div>
        )}
        {error ? (
          <div className="flex items-center gap-3">
            <p className="text-sm mono" style={{ color: "var(--error-text)" }}>
              Failed to load report.
            </p>
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="text-xs mono text-accent hover:underline"
            >
              retry
            </button>
          </div>
        ) : !report || !sections ? (
          <p className="mono text-base text-tan-3">loading…</p>
        ) : !anyShown && query.trim() ? (
          <NoRowsMatch query={query} />
        ) : (
          sections.map((s) => (
            <Section key={s.key} title={s.title} hint={s.hint} claims={s.claims} tone={s.tone} textTone={s.textTone} rq={rq} />
          ))
        )}
      </div>
    </div>
  );
}
