// Whether a disagreement between the atlas and the chain is only the on-chain
// step still to come. Governance runs vote → atlas edit → spell, so for a while
// after the atlas changes a value the chain still holds the old one. A mismatch
// is pending when the atlas wrote the stated value after the chain last set
// the key, and either an executive not yet cast, filed on or after that edit,
// names the prime (the spell expected to carry it), or the edit is younger
// than PENDING_DAYS. Past both, it is an ordinary mismatch again. Pure.
import type { DiffLine, HistoryEntry } from "./history.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { switchedOffSlope } from "./pauAudit.ts";
import { addDays, type IndexedExecutive } from "./votes/vote-index.ts";

/**
 * How long after an atlas edit the chain may still lag it. Executive Votes run
 * about every two weeks (de178e9a, A.1.11.1.4.1), and a Prime Agent submits its
 * spell items by Monday of week 0 for the vote that cycle builds
 * (20ff0ea2, A.1.10.2.3.2.2.3.1.1), so an edit that just misses one cycle's
 * submission lands in the next: two cycles.
 */
export const PENDING_DAYS = 28;
/** An executive not cast this many days after its filing date has expired. */
export const SPELL_EXPIRY_DAYS = 30;

export interface PendingOnchain {
  /** When the atlas last wrote the stated value, YYYY-MM-DD. */
  atlasChanged: string;
  /** The last day the chain is expected to still lag; after it the mismatch stands. */
  expectedBy: string;
  /** The executive expected to carry the change: not yet cast, filed on or after the edit, naming the prime. */
  spell: { title: string; date: string; url: string } | null;
}

export interface PendingContext {
  executives: readonly IndexedExecutive[];
  /** The prime's name, as executives name it ("Spark"); null when not known. */
  prime: string | null;
  /** Today, YYYY-MM-DD. */
  today: string;
}

const CONTENT = new Set(["added", "modified"]);
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

/** One side of a diff: the lines an edit added ("+") or removed ("-"), a word-level line rebuilt for that side. */
function sideLines(diff: DiffLine[], keep: "+" | "-"): string[] {
  return diff.flatMap((l) => {
    if (l[0] === "~") return [l[1].filter(([k]) => k === "=" || k === keep).map(([, t]) => t).join("")];
    return l[0] === keep ? [l[1]] : [];
  });
}

/** Whether an edit wrote the stated text: a line it added holds it and no line it removed did. */
function writes(diff: DiffLine[], stated: string): boolean {
  const has = (lines: string[]) => lines.some((t) => norm(t).includes(norm(stated)));
  return has(sideLines(diff, "+")) && !has(sideLines(diff, "-"));
}

/**
 * When the document last wrote the stated value, YYYY-MM-DD: its newest content
 * change whose diff adds the value, or that carries no diff to tell by. An edit
 * whose diff leaves the value alone is passed over. Null when none wrote it.
 */
export function valueChangedAt(entries: readonly HistoryEntry[], stated: string): string | null {
  const content = entries.filter((e) => CONTENT.has(e.changeType) && e.changeKind !== "lint" && e.changeKind !== "typo" && e.date);
  const newest = [...content].sort((a, b) => b.date.localeCompare(a.date));
  return newest.find((e) => !e.diff?.length || writes(e.diff, stated))?.date.slice(0, 10) ?? null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first executive not yet cast, filed on or after `since`, whose text names the prime. */
export function nextSpell(executives: readonly IndexedExecutive[], since: string, prime: string | null): IndexedExecutive | null {
  if (!prime) return null;
  const names = new RegExp(`\\b${escape(prime.toLowerCase())}\\b`);
  return executives.find((e) => !e.cast && e.date >= since && names.test(e.text)) ?? null;
}

/** A mismatch's pending on-chain step, or null when the chain is not waiting on the atlas or is past due. */
export function pendingFor(c: ValueCheck, all: ValueCheck[], atlasChanged: string | null, ctx: PendingContext): PendingOnchain | null {
  if (c.status !== "mismatch" || !atlasChanged || !c.limit || switchedOffSlope(c, all)) return null;
  if (c.limit.setAt.time.slice(0, 10) >= atlasChanged) return null;
  const spell = nextSpell(ctx.executives, atlasChanged, ctx.prime);
  const byWindow = addDays(atlasChanged, PENDING_DAYS);
  const bySpell = spell ? addDays(spell.date, SPELL_EXPIRY_DAYS) : "";
  const expectedBy = bySpell > byWindow ? bySpell : byWindow;
  if (ctx.today > expectedBy) return null;
  return { atlasChanged, expectedBy, spell: spell && { title: spell.title, date: spell.date, url: spell.url } };
}

/** The documents whose history places a mismatch: those stating one. */
export const mismatchDocs = (checks: ValueCheck[]): string[] => [...new Set(checks.filter((c) => c.status === "mismatch").map((c) => c.docId))];

/** The checks, each mismatch the chain is still expected to catch up on carrying its `pending` step. */
export function withPending(checks: ValueCheck[], history: ReadonlyMap<string, readonly HistoryEntry[]>, ctx: PendingContext): ValueCheck[] {
  return checks.map((c) => {
    const entries = c.status === "mismatch" ? history.get(c.docId) : undefined;
    const pending = entries ? pendingFor(c, checks, valueChangedAt(entries, c.stated), ctx) : null;
    return pending ? { ...c, pending } : c;
  });
}

/** Whether every certain difference among the checks is pending, and there is at least one. */
export const allPending = (checks: ValueCheck[]): boolean => {
  const off = checks.filter((c) => c.status === "mismatch");
  return off.length > 0 && off.every((c) => !!c.pending);
};
