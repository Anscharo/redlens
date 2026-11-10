// Whether a disagreement between the atlas and the chain is only the on-chain
// step still to come, or a step a spell has already passed by. Governance runs
// vote → atlas edit → spell, so for a while after the atlas changes a value the
// chain still holds the old one. When the atlas wrote the stated value after
// the chain last set the key, the change is pending while an executive not yet
// cast, filed on or after that edit, names the prime (the spell expected to
// carry it), or while the edit is younger than PENDING_DAYS. Past both, an
// executive naming the prime that has been cast since says a spell executed
// without the change; with none, nothing is known about the spell. Pure.
import type { DiffLine, HistoryEntry } from "./history.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { lastContentChange, switchedOffSlope } from "./pauAudit.ts";
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
  spell: SpellRef | null;
}

/** An executive as a pending or executed spell names it. */
export interface SpellRef {
  title: string;
  date: string;
  url: string;
}

/**
 * What the vote record says about a change the chain does not hold yet:
 * "pending", still expected; "executed", a spell naming the prime was cast
 * since the edit and past the expected delay, without the change.
 */
export type SpellState = { kind: "pending"; pending: PendingOnchain } | { kind: "executed"; spell: SpellRef };

export interface PendingContext {
  executives: readonly IndexedExecutive[];
  /** The prime's name, as executives name it ("Spark"); null when not known. */
  prime: string | null;
  /** Today, YYYY-MM-DD. */
  today: string;
}

const CONTENT = new Set(["added", "modified"]);
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The stated text as a whole value: not a digit run's middle ("0" is not in "20,000"). */
const valuePattern = (stated: string) => new RegExp(`(?<![\\w.,])${escape(norm(stated))}(?![\\w]|[.,]\\d)`);

/** One side of a diff: the lines an edit added ("+") or removed ("-"), a word-level line rebuilt for that side. */
function sideLines(diff: DiffLine[], keep: "+" | "-"): string[] {
  return diff.flatMap((l) => {
    if (l[0] === "~") return [l[1].filter(([k]) => k === "=" || k === keep).map(([, t]) => t).join("")];
    return l[0] === keep ? [l[1]] : [];
  });
}

/** Whether an edit wrote the stated text: a line it added holds it and no line it removed did. */
function writes(diff: DiffLine[], stated: string): boolean {
  const re = valuePattern(stated);
  const has = (lines: string[]) => lines.some((t) => re.test(norm(t)));
  return has(sideLines(diff, "+")) && !has(sideLines(diff, "-"));
}

/**
 * When the document last wrote the stated value, YYYY-MM-DD: its newest content
 * change whose diff adds the value, or that carries no diff to tell by. An edit
 * whose diff leaves the value alone is passed over. Where no diff is found to
 * write it (the atlas writes it differently from the parsed value), the
 * document's last content change stands in; null when it has none.
 */
export function valueChangedAt(entries: readonly HistoryEntry[], stated: string): string | null {
  const content = entries.filter((e) => CONTENT.has(e.changeType) && e.changeKind !== "lint" && e.changeKind !== "typo" && e.date);
  const newest = [...content].sort((a, b) => b.date.localeCompare(a.date));
  return newest.find((e) => !e.diff?.length || writes(e.diff, stated))?.date.slice(0, 10) ?? lastContentChange(entries);
}

const ref = (e: IndexedExecutive): SpellRef => ({ title: e.title, date: e.date, url: e.url });
const namesPrime = (prime: string) => new RegExp(`\\b${escape(prime.toLowerCase())}\\b`);

/** The first executive not yet cast, filed on or after `since`, whose text names the prime. */
export function nextSpell(executives: readonly IndexedExecutive[], since: string, prime: string | null): IndexedExecutive | null {
  if (!prime) return null;
  const names = namesPrime(prime);
  return executives.find((e) => !e.cast && e.date >= since && names.test(e.text)) ?? null;
}

/** The latest executive already cast, filed on or after `since`, whose text names the prime. */
export function lastCastSpell(executives: readonly IndexedExecutive[], since: string, prime: string | null): IndexedExecutive | null {
  if (!prime) return null;
  const names = namesPrime(prime);
  return executives.filter((e) => e.cast && e.date >= since && names.test(e.text)).at(-1) ?? null;
}

/** The change's pending step: while the window runs, or the spell expected to carry it is not cast or expired. */
function pendingSince(atlasChanged: string, ctx: PendingContext): PendingOnchain | null {
  const spell = nextSpell(ctx.executives, atlasChanged, ctx.prime);
  const byWindow = addDays(atlasChanged, PENDING_DAYS);
  const bySpell = spell ? addDays(spell.date, SPELL_EXPIRY_DAYS) : "";
  const expectedBy = bySpell > byWindow ? bySpell : byWindow;
  return ctx.today > expectedBy ? null : { atlasChanged, expectedBy, spell: spell && ref(spell) };
}

/**
 * What the vote record says of an atlas change the chain lacks, given when the
 * chain last set the key (null: never). Null when the chain moved on or after
 * the change, the change is not dated, or the record says nothing either way.
 */
export function spellState(atlasChanged: string | null, chainSet: string | null, ctx: PendingContext): SpellState | null {
  if (!atlasChanged || (chainSet && chainSet >= atlasChanged)) return null;
  const pending = pendingSince(atlasChanged, ctx);
  if (pending) return { kind: "pending", pending };
  const cast = lastCastSpell(ctx.executives, atlasChanged, ctx.prime);
  return cast ? { kind: "executed", spell: ref(cast) } : null;
}

/** A mismatch's pending on-chain step, or null when the chain is not waiting on the atlas or is past due. */
export function pendingFor(c: ValueCheck, all: ValueCheck[], atlasChanged: string | null, ctx: PendingContext): PendingOnchain | null {
  if (c.status !== "mismatch" || !c.limit || switchedOffSlope(c, all)) return null;
  const state = spellState(atlasChanged, c.limit.setAt.time.slice(0, 10), ctx);
  return state?.kind === "pending" ? state.pending : null;
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
