// The spell an atlas pull request says it belongs to, in its own words: its
// title ("October 8 spell changes", or an ISO date before "Spell Updates"), or
// the bullet that names a document's edit ("Update Grove Artifact For April 9
// Spell"). Only a date written next to the word "spell" counts; a date beside
// "Executive Vote" says when something takes effect, not which spell carries
// it. A reference without a year is kept as "--MM-DD" and given the year that
// puts it nearest the edit (`resolveSpellRefs`).
//
// The forum thread a Prime proposal links names a spell date in its slug
// ("…/september-24-2026-proposed-changes-to-grove-for-upcoming-spell/…"), but
// that is the thread's spell, not each item's: an item can be an artifact
// change no spell carries, or move to another spell. `threadSpellDate` reads it
// apart for the item path (forumSpellItems.ts), which follows each item's own
// Snapshot poll; until that path is wired in, a PR's spells still include it.
// Pure.

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = MONTHS.join("|");
const pad = (n: number) => String(n).padStart(2, "0");
const ref = (month: string | number, day: string, year?: string) => {
  const m = typeof month === "number" ? month : MONTHS.indexOf(month.toLowerCase()) + 1;
  return `${year ?? "-"}-${pad(m)}-${pad(Number(day))}`;
};

const ONE_DATE = `(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*\\d{4})?`;
const DATE_PARTS = new RegExp(`(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(\\d{4}))?`, "gi");

const THREAD = new RegExp(`(${MONTH})-(\\d{1,2})-(\\d{4})-proposed-changes-to-[a-z0-9-]+-for-upcoming-spell`, "i");

/** The spell date a "Proposed Changes … for Upcoming Spell" thread's slug names, YYYY-MM-DD; null for any other. */
export function threadSpellDate(slug: string): string | null {
  const m = THREAD.exec(slug);
  return m ? ref(m[1], m[2], m[3]) : null;
}

/** The forum topics a text links, by id, each once. */
export const forumTopics = (text: string | null | undefined): number[] =>
  [...new Set([...(text ?? "").matchAll(/forum\.(?:skyeco|sky\.money|makerdao)\.com\/t\/(?:(?!\d+(?:[/\s)]|$))[^/\s)]+\/)?(\d+)/g)].map((m) => Number(m[1])))];

const PATTERNS: Array<{ re: RegExp; read: (m: RegExpExecArray) => string[] }> = [
  // The thread's spell, until each item's own spell is read from its Snapshot poll (forumSpellItems.ts).
  { re: new RegExp(`/t/(${MONTH})-(\\d{1,2})-(\\d{4})-proposed-changes-to-[a-z0-9-]+-for-upcoming-spell`, "gi"), read: (m) => [ref(m[1], m[2], m[3])] },
  { re: /\b(\d{4})-(\d{2})-(\d{2})(?:\s+executive\s+vote)?\s+spell\b/gi, read: (m) => [`${m[1]}-${m[2]}-${m[3]}`] },
  // "April 9 Spell", "September 24, 2026 spell", "July 6, August 17 spell changes"
  {
    re: new RegExp(`\\b(${ONE_DATE}(?:\\s*(?:,|and|&)\\s*${ONE_DATE})*)(?:\\s+executive\\s+vote)?\\s+spells?\\b`, "gi"),
    read: (m) => [...m[1].matchAll(DATE_PARTS)].map((d) => ref(d[1], d[2], d[3])),
  },
];

/** Every spell the text names, as "YYYY-MM-DD" or "--MM-DD", in the order written, each once. */
export function spellRefs(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: { at: number; refs: string[] }[] = [];
  for (const { re, read } of PATTERNS) for (const m of text.matchAll(re)) found.push({ at: m.index ?? 0, refs: read(m as RegExpExecArray) });
  return [...new Set(found.sort((a, b) => a.at - b.at).flatMap((f) => f.refs))];
}

/** A pull request's spells: those its title names, and, for a body that is not a list of edits, those its body names. */
export function prSpellRefs(title: string | null, body: string | null): string[] {
  const listed = /^\s*[-*]\s+\*\*/m.test(body ?? "");
  return [...new Set([...spellRefs(title), ...(listed ? [] : spellRefs(body))])];
}

/** References as dates: a "--MM-DD" takes the year that puts it nearest `near` (YYYY-MM-DD). */
export function resolveSpellRefs(refs: readonly string[], near: string): string[] {
  const year = Number(near.slice(0, 4));
  const resolve = (r: string) => {
    if (!r.startsWith("--")) return r;
    const days = (y: number) => Math.abs(Date.parse(`${y}${r.slice(1)}`) - Date.parse(near));
    return `${[year - 1, year, year + 1].reduce((best, y) => (days(y) < days(best) ? y : best))}${r.slice(1)}`;
  };
  return [...new Set(refs.map(resolve))];
}
