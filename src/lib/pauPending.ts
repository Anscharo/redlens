// What governance did about an atlas value the chain does not hold, followed
// link by link and never guessed. Either side can move first: most edits merge
// once their vote passes and a spell carries them out later, while a
// spell-update PR waits for its spell to execute and then records it.
//
// When the atlas wrote the value after the chain last set the key, the change
// that wrote it is linked to its spell directly (pauSpellStep.ts):
//   - a Prime proposal's PR through the Snapshot poll that links it
//     (primePolls.ts), which an executive's Prime Agent Proxy Spells section
//     links in turn, item by item;
//   - any other PR by the spell date its own words name (atlasPrSpell.ts,
//     HistoryEntry.spells), through that date's executive.
// The spell is pending while its poll is open, its executive is not filed or
// not cast, or its relay is queued or its changes are still being read; else
// it set the key to another value ("set"), executed without setting it, never
// carried it ("lapsed"), or there is no spell to carry it: an artifact or Sky
// Core item ("off-spell"), or a poll that did not pass ("rejected").
// `recorded` marks a spell that had executed before the edit merged: the edit
// records it, so a disagreement is the atlas recording what the spell did not do.
//
// When the chain set the key on or after the atlas last wrote the value, the
// key's last change says who made it (pauChainLed.ts): "recording" while an
// open atlas PR belongs to that spell, else "unrecorded" (with the merged PR
// that belonged to it and left this value, when one did).
//
// Nothing is said when the writing change cannot be told apart, its PR record
// or the polls are not read yet, or its PR links only a forum thread, whose
// items can belong to different spells. Pure.
import type { HistoryEntry } from "./history.ts";
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { switchedOffSlope } from "./pauAudit.ts";
import type { PauHistoryResponse } from "./pauHistory.ts";
import { isThreadRef } from "./atlasPrSpell.ts";
import { chainLedStep, type OpenAtlasPr } from "./pauChainLed.ts";
import { namedStep, pollStep } from "./pauSpellStep.ts";
import { valueChange } from "./pauValueDate.ts";
import type { PrimePoll } from "./primePolls.ts";
import type { IndexedExecutive } from "./votes/vote-index.ts";

/** An executive as the vote record names it. */
export interface SpellRef {
  title: string;
  date: string;
  url: string;
}

/** The change that wrote the value: its pull request, when, the spell date it names, and the Prime Snapshot poll it was named through. */
export interface Named {
  atlasChanged: string;
  pr: number | null;
  date: string;
  poll?: { id: string; title: string; space: string };
}

export type PendingStep =
  | { kind: "polling" }
  | { kind: "unfiled" }
  | { kind: "uncast"; spell: SpellRef }
  | { kind: "queued"; spell: SpellRef; chain: string; tx: string; at: string | null }
  | { kind: "reading"; spell: SpellRef; executed: string };

export interface PendingOnchain extends Named {
  /** The last day this step is expected to last; after it the vote record or the chain is read again. */
  expectedBy: string;
  step: PendingStep;
}

/** A change the chain made that the atlas has not recorded: where, when, and who made it. */
export interface ChainChange {
  chain: string;
  tx: string;
  setOn: string;
  /** A spell (its executive when the record names it), the Operator, or anything else (a deployment, a direct call, not attributed yet). */
  by: { kind: "spell"; spell: { title: string | null; date: string; url: string | null } | null } | { kind: "operator" } | { kind: "other" };
}

export type OnchainStep =
  | { kind: "pending"; pending: PendingOnchain }
  | { kind: "set"; named: Named; spell: SpellRef; chain: string; tx: string; recorded: boolean }
  | { kind: "executed"; named: Named; spell: SpellRef; executed: string | null; recorded: boolean }
  /** The spell never carried it: its executive expired uncast, was filed without the change's poll, or the vote record has none. */
  | { kind: "lapsed"; named: Named; spell: SpellRef | null; why: "expired" | "not-carried" | "none" }
  /** The change's poll is an artifact or Sky Core item, which no Prime spell carries. */
  | { kind: "off-spell"; named: Named }
  /** The change's poll did not pass. */
  | { kind: "rejected"; named: Named }
  | { kind: "unnamed"; atlasChanged: string; pr: number | null }
  | { kind: "recording"; change: ChainChange; pr: { number: number; title: string; url: string } }
  | { kind: "unrecorded"; change: ChainChange; missedBy?: { pr: number; date: string } };

/** Whether the step is still coming on one side or the other: the clock, not a ✗. */
export const isPending = (s: OnchainStep | undefined | null): boolean => s?.kind === "pending" || s?.kind === "recording";

export interface PendingContext {
  /** The vote record's executives, oldest first. */
  executives: readonly IndexedExecutive[];
  pau: PauHistoryResponse;
  /** The prime's snapshots. */
  snaps: readonly StoredPauSnapshot[];
  /** Today, YYYY-MM-DD. */
  today: string;
  /** The open atlas pull requests; absent or empty when they could not be read. */
  openPrs?: readonly OpenAtlasPr[];
  /** The Prime Snapshot polls that link each atlas PR (primePolls.ts); absent when they could not be read. */
  pollsByPr?: ReadonlyMap<number, readonly PrimePoll[]>;
  /** The executives linking each Snapshot poll (VoteIndex.snapshots). */
  snapshots?: ReadonlyMap<string, readonly IndexedExecutive[]>;
}

const RANK: Record<OnchainStep["kind"], number> = { set: 0, pending: 1, recording: 1, executed: 2, rejected: 2, "off-spell": 2, lapsed: 3, unnamed: 4, unrecorded: 4 };

const mostTelling = (steps: OnchainStep[]) => steps.sort((a, b) => RANK[a.kind] - RANK[b.kind])[0] ?? null;

/** What the change names its spell by: the Prime polls that link its PR, else the spell dates its own words name; null when it names none. */
function linkedStep(c: ValueCheck, base: Omit<Named, "date">, spells: readonly string[], ctx: PendingContext): OnchainStep | null {
  const polls = base.pr != null ? (ctx.pollsByPr?.get(base.pr) ?? []) : [];
  if (polls.length) return mostTelling(polls.map((p) => pollStep(c, base, p, ctx)));
  return mostTelling(spells.filter((d) => !isThreadRef(d)).map((date) => namedStep(c, { ...base, date }, ctx)));
}

/**
 * The step for a value the chain does not hold, from its document's history.
 * A linked spell that set the key comes first; then, where the chain set the
 * key on or after the atlas last wrote the value, who made that change; else
 * the spell the writing change is linked to. Null when the writing change
 * cannot be told apart, its PR or the polls are not read yet, or its PR links
 * only a forum thread (whose items can belong to different spells).
 */
export function onchainStep(c: ValueCheck, entries: readonly HistoryEntry[], ctx: PendingContext): OnchainStep | null {
  const change = valueChange(entries, c.stated);
  if (!change) return null;
  const base = { atlasChanged: change.entry.date.slice(0, 10), pr: change.entry.pr ?? null };
  const spells = change.exact ? change.entry.spells : undefined;
  const linked = spells ? linkedStep(c, base, spells, ctx) : null;
  if (linked?.kind === "set") return linked;
  if (chainMoved(c, base.atlasChanged)) return chainLedStep(c, entries, ctx);
  if (linked || !spells || !ctx.pollsByPr || spells.some(isThreadRef)) return linked;
  return { kind: "unnamed", ...base };
}

/** Whether the chain set the key on or after the atlas change. */
const chainMoved = (c: ValueCheck, atlasChanged: string) => !!c.limit && c.limit.setAt.time.slice(0, 10) >= atlasChanged;

/** The documents whose history places a value: those stating a mismatch or a limit never set. */
export const datedDocs = (checks: ValueCheck[]): string[] => [...new Set(checks.filter((c) => c.status === "mismatch" || c.status === "not-set").map((c) => c.docId))];

/** The checks, each mismatch or limit never set carrying what governance did about it (`onchain`). */
export function withOnchain(checks: ValueCheck[], history: ReadonlyMap<string, readonly HistoryEntry[]>, ctx: PendingContext): ValueCheck[] {
  return checks.map((c) => {
    const entries = c.status === "mismatch" || c.status === "not-set" ? history.get(c.docId) : undefined;
    if (!entries || switchedOffSlope(c, checks)) return c;
    const onchain = onchainStep(c, entries, ctx);
    return onchain ? { ...c, onchain } : c;
  });
}

/** Whether every certain difference among the checks is pending, and there is at least one. */
export const allPending = (checks: ValueCheck[]): boolean => {
  const off = checks.filter((c) => c.status === "mismatch");
  return off.length > 0 && off.every((c) => isPending(c.onchain));
};
