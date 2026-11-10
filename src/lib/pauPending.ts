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
// When the chain set the key after the atlas last wrote the value, the
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
import { keyRoutes, type KeyRoutes } from "./pauKeyRoutes.ts";
import { moveOrder, valueChange } from "./pauValueDate.ts";
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
  /** When the change merged, ISO; orders it against a spell that executed the same day. */
  at?: string;
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
  /** Now, in ms, for when the Operator may next raise a limit. */
  now: number;
  /** The open atlas pull requests; absent when they could not be read, and a change the chain made first then says nothing. */
  openPrs?: readonly OpenAtlasPr[];
  /** An atlas document's doc_no by UUID, to cite the Operator's rules (pauKeyRoutes.ts); absent where the documents are not at hand. */
  docNo?: (uuid: string) => string | null;
  /** The Prime Snapshot polls that link each atlas PR (primePolls.ts); absent when they could not be read. */
  pollsByPr?: ReadonlyMap<number, readonly PrimePoll[]>;
  /** The executives linking each Snapshot poll (VoteIndex.snapshots). */
  snapshots?: ReadonlyMap<string, readonly IndexedExecutive[]>;
}

const RANK: Record<OnchainStep["kind"], number> = { set: 0, pending: 1, recording: 1, executed: 2, rejected: 2, "off-spell": 2, lapsed: 3, unnamed: 4, unrecorded: 4 };

const mostTelling = (steps: (OnchainStep | null)[]) => steps.filter((s): s is OnchainStep => !!s).sort((a, b) => RANK[a.kind] - RANK[b.kind])[0] ?? null;

/** What the change names its spell by: the Prime polls that link its PR, else the spell dates its own words name; null when it names none. */
function linkedStep(c: ValueCheck, base: Omit<Named, "date">, spells: readonly string[], ctx: PendingContext): OnchainStep | null {
  const polls = base.pr != null ? (ctx.pollsByPr?.get(base.pr) ?? []) : [];
  if (polls.length) return mostTelling(polls.map((p) => pollStep(c, base, p, ctx)));
  return mostTelling(spells.filter((d) => !isThreadRef(d)).map((date) => namedStep(c, { ...base, date }, ctx)));
}

/**
 * The step for a value the chain does not hold, from its document's history.
 * A linked spell that set the key comes first; then, where the chain set the
 * key after the atlas last wrote the value, who made that change; else
 * the spell the writing change is linked to: through its PR's poll even while
 * the PR's own record is unread. Null when the writing change cannot be told
 * apart, neither a poll nor the PR record links it yet, or its PR links only a
 * forum thread (whose items can belong to different spells).
 */
export function onchainStep(c: ValueCheck, entries: readonly HistoryEntry[], ctx: PendingContext): OnchainStep | null {
  const change = valueChange(entries, c.stated);
  if (!change) return null;
  const base = { atlasChanged: change.entry.date.slice(0, 10), at: change.entry.date, pr: change.entry.pr ?? null };
  const spells = change.exact ? change.entry.spells : undefined;
  const linked = change.exact ? linkedStep(c, base, spells ?? [], ctx) : null;
  if (linked?.kind === "set") return linked;
  if (moveOrder(c.limit?.setAt.time, change.entry.date) === "chain") return chainLedStep(c, entries, ctx);
  const polled = base.pr != null && !!ctx.pollsByPr?.get(base.pr)?.length;
  if (linked || polled || !spells || !ctx.pollsByPr || spells.some(isThreadRef)) return linked;
  return { kind: "unnamed", ...base };
}


/** The documents whose history places a value: those stating a mismatch or a limit never set. */
export const datedDocs = (checks: ValueCheck[]): string[] => [...new Set(checks.filter((c) => DATED.has(c.status)).map((c) => c.docId))];

const DATED = new Set<ValueCheck["status"]>(["mismatch", "not-set"]);

/** The checks, each mismatch or limit never set carrying what governance did about it (`onchain`) and who can change it (`routes`). */
export function withOnchain(checks: ValueCheck[], history: ReadonlyMap<string, readonly HistoryEntry[]>, ctx: PendingContext): ValueCheck[] {
  return checks.map((c) => {
    if (!DATED.has(c.status)) return c;
    const routes = keyRoutes(c, ctx.snaps, ctx.pau, ctx.now, ctx.docNo);
    const entries = history.get(c.docId);
    const onchain = entries && !switchedOffSlope(c, checks) ? onchainStep(c, entries, ctx) : null;
    return { ...c, ...(onchain ? { onchain } : {}), ...(routes ? { routes } : {}) };
  });
}

/** One check's identity, the same wherever it is built (the server's steps, the browser's checks): the document, the value, and where the chain holds it. */
export const valueCheckId = (c: ValueCheck): string => [c.docId, c.label, c.field, c.stated, c.chain, c.kind, c.contract, c.key].join("|");

/** What GET /api/pau/steps serves for one check. */
export interface ValueStep {
  id: string;
  onchain?: OnchainStep;
  routes?: KeyRoutes;
}

/** The checks with the steps worked out for them (`withOnchain`, on the server) attached, matched by `valueCheckId`; a check with none comes back as it is. */
export function withSteps(checks: ValueCheck[], steps: ReadonlyMap<string, ValueStep>): ValueCheck[] {
  return checks.map((c) => {
    const s = DATED.has(c.status) ? steps.get(valueCheckId(c)) : undefined;
    return s ? { ...c, ...(s.onchain ? { onchain: s.onchain } : {}), ...(s.routes ? { routes: s.routes } : {}) } : c;
  });
}

/** Whether every certain difference among the checks is pending, and there is at least one. */
export const allPending = (checks: ValueCheck[]): boolean => {
  const off = checks.filter((c) => c.status === "mismatch");
  return off.length > 0 && off.every((c) => isPending(c.onchain));
};
