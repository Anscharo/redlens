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

function addRange(out: Set<string>, from: number, to: number, year: number): void {
  if (from <= to) {
    for (let m = from; m <= to; m++) out.add(ym(year, m));
    return;
  }
  for (let m = from; m <= 12; m++) out.add(ym(year, m));
  for (let m = 1; m <= to; m++) out.add(ym(year, m));
}

/** YYYY-MM values named in an MSC thread title. Empty when none parse. */
export function monthsFromMscTitle(title: string): string[] {
  const t = title.toLowerCase().replace(/[\u2013\u2014]/g, "-");
  const found = new Set<string>();

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
