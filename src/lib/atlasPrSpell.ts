// The spell an atlas pull request says it belongs to, in its own words: its
// title ("October 8 spell changes", "Aug 13 Spell Update", an ISO date before
// "Spell Updates" or after "spell"), or
// the bullet that names a document's edit ("Update Grove Artifact For April 9
// Spell"). Only a date written next to the word "spell" counts; a date beside
// "Executive Vote" says when something takes effect, not which spell carries
// it. A reference without a year is kept as "--MM-DD" and given the year that
// puts it nearest the edit (`resolveSpellRefs`).
//
// A Prime proposal links its forum thread, whose slug names a spell date
// ("…/september-24-2026-proposed-changes-to-grove-for-upcoming-spell/…"). That
// is the thread's spell, not the PR's: a thread lists several items, an
// artifact item is carried by no spell, and an item can be re-proposed for
// another. So it is kept as "thread:YYYY-MM-DD", which says only that the PR
// links such a thread; the PR's own spell comes from its Snapshot poll
// (primePolls.ts). Pure.

/** Raised when the parser below reads a PR differently, so every stored PR is read again (src/server/history/pr-spells.ts). */
export const SPELL_REFS_VERSION = 2;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** A month, written out or cut short ("Aug", "Sept.", "October"). */
const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const pad = (n: number) => String(n).padStart(2, "0");
const ref = (month: string | number, day: string, year?: string) => {
  const m = typeof month === "number" ? month : MONTHS.indexOf(month.slice(0, 3).toLowerCase()) + 1;
  return `${year ?? "-"}-${pad(m)}-${pad(Number(day))}`;
};
/** What may stand between a date and the word "spell": "Executive", "Executive Vote". */
const BEFORE_SPELL = "(?:\\s+executive(?:\\s+vote)?)?\\s+spells?\\b";

const ONE_DATE = `(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*\\d{4})?`;
const DATE_PARTS = new RegExp(`(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(\\d{4}))?`, "gi");

const THREAD = new RegExp(`(${MONTH})-(\\d{1,2})-(\\d{4})-proposed-changes-to-[a-z0-9-]+-for-upcoming-spell`, "i");

/** The spell date a "Proposed Changes … for Upcoming Spell" thread's slug names, YYYY-MM-DD; null for any other. */
export function threadSpellDate(slug: string): string | null {
  const m = THREAD.exec(slug);
  return m ? ref(m[1], m[2], m[3]) : null;
}

/** Whether a reference is a linked forum thread's date, not a spell the PR names. */
export const isThreadRef = (r: string): boolean => r.startsWith("thread:");

const PATTERNS: Array<{ re: RegExp; read: (m: RegExpExecArray) => string[] }> = [
  { re: new RegExp(`/t/(${MONTH})-(\\d{1,2})-(\\d{4})-proposed-changes-to-[a-z0-9-]+-for-upcoming-spell`, "gi"), read: (m) => [`thread:${ref(m[1], m[2], m[3])}`] },
  // An ISO date before "Spell Updates" or "Executive Spell", or after the word "spell"
  { re: new RegExp(`\\b(\\d{4})-(\\d{2})-(\\d{2})${BEFORE_SPELL}`, "gi"), read: (m) => [`${m[1]}-${m[2]}-${m[3]}`] },
  { re: /\bspell\s+(?:of\s+)?(\d{4})-(\d{2})-(\d{2})\b/gi, read: (m) => [`${m[1]}-${m[2]}-${m[3]}`] },
  // "April 9 Spell", "Aug 13 Spell Update", "Oct 16th spell", "September 24, 2026 spell", "July 6, August 17 spell changes"
  {
    re: new RegExp(`\\b(${ONE_DATE}(?:\\s*(?:,|and|&)\\s*${ONE_DATE})*)${BEFORE_SPELL}`, "gi"),
    read: (m) => [...m[1].matchAll(DATE_PARTS)].map((d) => ref(d[1], d[2], d[3])),
  },
];

/** Every spell the text names, as "YYYY-MM-DD" or "--MM-DD", and every spell thread it links, as "thread:YYYY-MM-DD", in the order written, each once. */
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
