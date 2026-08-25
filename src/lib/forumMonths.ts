// Map an MSC forum title to settlement months (YYYY-MM). Titles name the
// period in prose — "MSC #11 - Settlement Summary (July 2026)" — so the
// month comes from the title, not the post date.

const MONTH_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const MONTH = Object.keys(MONTH_INDEX).join("|");

function ym(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Every month from (fromYear, from) through (toYear, to), inclusive. */
function addSpan(
  out: Set<string>,
  from: number,
  fromYear: number,
  to: number,
  toYear: number,
): void {
  if (toYear < fromYear || (toYear === fromYear && to < from)) return;
  // A settlement thread never covers years; a title parsed into one is a
  // misread, and filling it would bury the real months in noise.
  if (toYear - fromYear > 1) return;
  let year = fromYear;
  for (let m = from; year < toYear || (year === toYear && m <= to); m++) {
    if (m > 12) {
      m = 1;
      year++;
    }
    out.add(ym(year, m));
  }
}

function addRange(out: Set<string>, from: number, to: number, year: number): void {
  // The title carries a single year and it belongs to the month it follows,
  // so a range that wraps ("November - February 2026") starts a year earlier.
  if (from <= to) addSpan(out, from, year, to, year);
  else addSpan(out, from, year - 1, to, year);
}

/** YYYY-MM values named in an MSC thread title. Empty when none parse. */
export function monthsFromMscTitle(title: string): string[] {
  const t = title.toLowerCase().replace(/[\u2013\u2014]/g, "-");
  const found = new Set<string>();

  // Both months carry their own year — the unambiguous cross-year form.
  const spanned = new RegExp(
    `\\b(${MONTH})\\s+(\\d{4})\\s*-\\s*(${MONTH})\\s+(\\d{4})\\b`,
    "g",
  );
  for (const m of t.matchAll(spanned)) {
    addSpan(found, MONTH_INDEX[m[1]!]!, Number(m[2]), MONTH_INDEX[m[3]!]!, Number(m[4]));
  }

  const range = new RegExp(`\\b(${MONTH})\\s*-\\s*(${MONTH})\\s+(\\d{4})\\b`, "g");
  for (const m of t.matchAll(range)) {
    addRange(found, MONTH_INDEX[m[1]!]!, MONTH_INDEX[m[2]!]!, Number(m[3]));
  }

  const pair = new RegExp(`\\b(${MONTH})\\s*(?:&|,|and)\\s*(${MONTH})\\s+(\\d{4})\\b`, "g");
  for (const m of t.matchAll(pair)) {
    found.add(ym(Number(m[3]), MONTH_INDEX[m[1]!]!));
    found.add(ym(Number(m[3]), MONTH_INDEX[m[2]!]!));
  }

  const single = new RegExp(`\\b(${MONTH})\\s+(\\d{4})\\b`, "g");
  for (const m of t.matchAll(single)) {
    found.add(ym(Number(m[2]), MONTH_INDEX[m[1]!]!));
  }

  return [...found].sort();
}

export interface ForumMonthTopic {
  title: string;
  url: string;
  postedAt?: string;
  period?: string[];
}

/** Thread URL for a settlement month. Prefers a single-month "Summary" title. */
export function forumTopicUrlForMonth(
  topics: readonly ForumMonthTopic[],
  month: string,
): string | undefined {
  const hits = topics
    .map((t) => ({
      t,
      months: t.period && t.period.length > 0 ? t.period : monthsFromMscTitle(t.title),
    }))
    .filter((x) => x.months.includes(month));
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => {
    const spec = a.months.length - b.months.length;
    if (spec !== 0) return spec;
    const sum =
      Number(/summary/i.test(b.t.title)) - Number(/summary/i.test(a.t.title));
    if (sum !== 0) return sum;
    return (b.t.postedAt ?? "").localeCompare(a.t.postedAt ?? "");
  });
  return hits[0]!.t.url;
}
