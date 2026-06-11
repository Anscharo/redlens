// Stale-date analysis — finds dated claims in atlas prose and classifies them
// against "today". A future-tense sentence whose date has passed means the
// atlas asserts something will happen that should already have happened
// (executed-but-not-retensed, or slipped). Pure data logic: the report
// component recomputes on every load, so it tracks both atlas updates (fresh
// docs.json) and the actual date — no build step or stored artifact.

import type { AtlasNode } from "../types";

export type DatePrecision = "day" | "month" | "quarter";

export interface DateClaim {
  docId: string;
  docNo: string;
  title: string;
  raw: string; // matched date text
  dateISO: string; // staleness boundary (month/quarter → period end)
  precision: DatePrecision;
  context: string;
  daysUntilStale: number; // negative = already stale
}

export interface StaleDatesReport {
  stale: DateClaim[]; // future-tense, date passed
  dueSoon: DateClaim[]; // future-tense, passes within the next 7 days
  upcoming: DateClaim[]; // future-tense, further out
  totalDateMentions: number;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const M = "(January|February|March|April|May|June|July|August|September|October|November|December)";

type RawMatch = { start: number; end: number; raw: string; y: number; mo: number; day: number | null; precision: DatePrecision };

// Ordered most-precise-first; overlap dedupe keeps the first hit per span.
const DATE_RES: { re: RegExp; map: (m: RegExpMatchArray) => [number, number, number | null, DatePrecision] }[] = [
  { re: new RegExp(`\\b${M}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi"), map: (m) => [+m[3], MONTHS[m[1].toLowerCase()], +m[2], "day"] },
  { re: new RegExp(`\\b(\\d{1,2})\\s+${M}\\s+(\\d{4})\\b`, "gi"), map: (m) => [+m[3], MONTHS[m[2].toLowerCase()], +m[1], "day"] },
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, map: (m) => [+m[1], +m[2], +m[3], "day"] },
  { re: /\bQ([1-4])\s+(\d{4})\b/g, map: (m) => [+m[2], +m[1] * 3, null, "quarter"] },
  { re: new RegExp(`\\b${M}\\s+(\\d{4})\\b`, "gi"), map: (m) => [+m[2], MONTHS[m[1].toLowerCase()], null, "month"] },
];

// Future-tense markers checked in a link-stripped window around the date.
// "by {date}" is handled separately (bare "by" matches "posted by" etc.).
const FUTURE_RE =
  /\b(will|shall|scheduled|planned|upcoming|expected|estimated|beginning|begins|starting|takes? effect|no later than|to be\s+\w+(?:ed|en))\b/i;
const BY_DATE_RE = /(?:^|\s)by\s*$/i;

// Markdown links carry URL slugs ("derecognition-due-to-…") that poison tense
// detection — replace each link with its visible text before any matching.
const stripLinks = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

// Staleness boundary: a claim about "December 2025" is stale only after the
// period ends, so month/quarter precision resolves to the period's last day.
function boundaryUTC(y: number, mo: number, day: number | null): number {
  return Date.UTC(y, mo - 1, day ?? daysInMonth(y, mo));
}

const fmtISO = (utc: number) => new Date(utc).toISOString().slice(0, 10);

export function extractDateClaims(doc: AtlasNode, todayUTC: number): { claims: DateClaim[]; mentions: number } {
  const content = stripLinks(doc.content ?? "");
  if (!content) return { claims: [], mentions: 0 };

  const matches: RawMatch[] = [];
  for (const { re, map } of DATE_RES) {
    re.lastIndex = 0;
    for (const m of content.matchAll(re)) {
      const [y, mo, day, precision] = map(m);
      if (y < 2015 || y > 2100 || mo < 1 || mo > 12) continue;
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (matches.some((o) => start < o.end && end > o.start)) continue; // overlap → keep more precise
      matches.push({ start, end, raw: m[0], y, mo, day, precision });
    }
  }

  const claims: DateClaim[] = [];
  for (const t of matches) {
    const before = content.slice(Math.max(0, t.start - 140), t.start);
    const after = content.slice(t.end, t.end + 80);
    if (!FUTURE_RE.test(before + " " + after) && !BY_DATE_RE.test(before)) continue;
    const utc = boundaryUTC(t.y, t.mo, t.day);
    claims.push({
      docId: doc.id,
      docNo: doc.doc_no,
      title: doc.title,
      raw: t.raw,
      dateISO: fmtISO(utc),
      precision: t.precision,
      context: (before.slice(-110) + t.raw + after).replace(/\s+/g, " ").trim(),
      daysUntilStale: Math.round((utc - todayUTC) / 86_400_000),
    });
  }
  return { claims, mentions: matches.length };
}

export function buildStaleDatesReport(
  docs: Record<string, AtlasNode>,
  today: Date = new Date(),
): StaleDatesReport {
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const report: StaleDatesReport = { stale: [], dueSoon: [], upcoming: [], totalDateMentions: 0 };
  for (const doc of Object.values(docs)) {
    const { claims, mentions } = extractDateClaims(doc, todayUTC);
    report.totalDateMentions += mentions;
    for (const c of claims) {
      if (c.daysUntilStale < 0) report.stale.push(c);
      else if (c.daysUntilStale <= 7) report.dueSoon.push(c);
      else report.upcoming.push(c);
    }
  }
  const byDate = (a: DateClaim, b: DateClaim) =>
    a.dateISO.localeCompare(b.dateISO) || a.docNo.localeCompare(b.docNo);
  report.stale.sort(byDate);
  report.dueSoon.sort(byDate);
  report.upcoming.sort(byDate);
  return report;
}
