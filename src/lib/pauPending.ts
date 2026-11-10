// What governance has done about an atlas value the chain does not hold,
// followed link by link and never guessed. Governance runs vote → atlas edit →
// spell, and each atlas pull request names the spell it belongs to
// (atlasPrSpell.ts, served as HistoryEntry.spells). So for a value the chain
// lacks, the change that wrote it names a spell date; the vote record holds
// that date's executive and its spell; the PAU history holds what the spell
// changed. The step is:
//   - "set" when that spell set the key, to a value other than the atlas states;
//   - pending while the spell is not filed yet, filed and not cast, or cast with
//     its relay queued on the deployment's Executor or its changes still being
//     read (READ_DAYS);
//   - "executed" when it ran and did not set the key;
//   - "lapsed" when its executive never appeared or expired uncast;
//   - "unnamed" when the pull request names no spell.
// Nothing is said when the writing change cannot be told apart, or its PR
// record is not read yet. Pure.
import type { HistoryEntry } from "./history.ts";
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { switchedOffSlope } from "./pauAudit.ts";
import type { PauHistoryResponse } from "./pauHistory.ts";
import { deploymentsOf, keySetBy, queuedRelay } from "./pauPendingEvidence.ts";
import { valueChange } from "./pauValueDate.ts";
import { addDays, executiveFor, SLIP_DAYS, type IndexedExecutive } from "./votes/vote-index.ts";

/** An executive not cast this many days after its date has expired. */
export const SPELL_EXPIRY_DAYS = 30;
/** How long after a spell executes its changes may still be unread or unattributed: the worker retries an unproven origin every six hours, and a relay waits its Executor's delay. */
export const READ_DAYS = 3;

/** An executive as the vote record names it. */
export interface SpellRef {
  title: string;
  date: string;
  url: string;
}

/** The change that wrote the value: its pull request, when, and the spell date it names. */
export interface Named {
  atlasChanged: string;
  pr: number | null;
  date: string;
}

export type PendingStep =
  | { kind: "unfiled" }
  | { kind: "uncast"; spell: SpellRef }
  | { kind: "queued"; spell: SpellRef; chain: string; tx: string; at: string | null }
  | { kind: "reading"; spell: SpellRef; executed: string };

export interface PendingOnchain extends Named {
  /** The last day this step is expected to last; after it the vote record or the chain is read again. */
  expectedBy: string;
  step: PendingStep;
}

export type OnchainStep =
  | { kind: "pending"; pending: PendingOnchain }
  | { kind: "set"; named: Named; spell: SpellRef; chain: string; tx: string }
  | { kind: "executed"; named: Named; spell: SpellRef; executed: string | null }
  | { kind: "lapsed"; named: Named; spell: SpellRef | null }
  | { kind: "unnamed"; atlasChanged: string; pr: number | null };

export interface PendingContext {
  /** The vote record's executives, oldest first. */
  executives: readonly IndexedExecutive[];
  pau: PauHistoryResponse;
  /** The prime's snapshots. */
  snaps: readonly StoredPauSnapshot[];
  /** Today, YYYY-MM-DD. */
  today: string;
}

const ref = (e: IndexedExecutive): SpellRef => ({ title: e.title, date: e.date, url: e.url });
const pending = (named: Named, expectedBy: string, step: PendingStep): OnchainStep => ({ kind: "pending", pending: { ...named, expectedBy, step } });

/** What became of a cast spell: it set the key, its relay or its changes are still coming, or it ran without the change. */
function afterCast(c: ValueCheck, named: Named, x: IndexedExecutive, ctx: PendingContext): OnchainStep {
  const spell = ref(x);
  const set = x.spell ? keySetBy(ctx.pau, x.spell, c) : null;
  if (set) return { kind: "set", named, spell, chain: set.chain, tx: set.tx };
  const executed = x.executed ?? null;
  const since = executed ?? x.date;
  const relay = c.chain === "ethereum" ? null : queuedRelay(ctx.pau.queued ?? [], deploymentsOf(c, ctx.snaps), since);
  if (relay) return pending(named, addDays((relay.at ?? relay.time).slice(0, 10), READ_DAYS), { kind: "queued", spell, chain: relay.chain, tx: relay.tx, at: relay.at });
  if (ctx.today <= addDays(since, READ_DAYS)) return pending(named, addDays(since, READ_DAYS), { kind: "reading", spell, executed: since });
  return { kind: "executed", named, spell, executed };
}

/** What became of the spell one change names. */
export function namedStep(c: ValueCheck, named: Named, ctx: PendingContext): OnchainStep {
  const x = executiveFor(ctx, named.date, false);
  if (!x) return ctx.today <= addDays(named.date, SLIP_DAYS) ? pending(named, addDays(named.date, SLIP_DAYS), { kind: "unfiled" }) : { kind: "lapsed", named, spell: null };
  if (x.cast) return afterCast(c, named, x, ctx);
  const until = addDays(x.date, SPELL_EXPIRY_DAYS);
  return ctx.today <= until ? pending(named, until, { kind: "uncast", spell: ref(x) }) : { kind: "lapsed", named, spell: ref(x) };
}

const RANK: Record<OnchainStep["kind"], number> = { set: 0, pending: 1, executed: 2, lapsed: 3, unnamed: 4 };

/**
 * The step for a value the chain does not hold, from its document's history:
 * the change that wrote it and every spell that change names, the most telling
 * first. Null when the chain set the key on or after that change (and no named
 * spell set it), the change cannot be told apart, or its PR is not read yet.
 */
export function onchainStep(c: ValueCheck, entries: readonly HistoryEntry[], ctx: PendingContext): OnchainStep | null {
  const change = valueChange(entries, c.stated);
  if (!change?.exact || !change.entry.spells) return null;
  const atlasChanged = change.entry.date.slice(0, 10);
  const pr = change.entry.pr ?? null;
  if (change.entry.spells.length === 0) return chainMoved(c, atlasChanged) ? null : { kind: "unnamed", atlasChanged, pr };
  const steps = change.entry.spells.map((date) => namedStep(c, { atlasChanged, pr, date }, ctx)).sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  return steps[0].kind !== "set" && chainMoved(c, atlasChanged) ? null : steps[0];
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
  return off.length > 0 && off.every((c) => c.onchain?.kind === "pending");
};
