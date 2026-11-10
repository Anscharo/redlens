// Whether a disagreement between the atlas and the chain is the on-chain step
// still to come, or one governance has already passed by. Governance runs
// vote → atlas edit → on-chain change, so for a while after the atlas changes
// a value the chain still holds the old one. When the atlas wrote the value
// after the chain last set the key, the PAU history decides
// (pauPendingEvidence.ts):
//   - pending while a governance step that can reach the deployment is queued
//     (an action set on its Executor, a star spell on the prime's StarGuard),
//     an executive naming the prime is not yet cast, or the change is younger
//     than the route's expected delay;
//   - else "executed" when governance has changed the deployment since (a spell,
//     or a relayed action set whose spell is not proven yet), dated late enough
//     to have carried the change, and the key is still as it was. Never for a
//     key the Operator may set without a spell.
// With neither, nothing is known about the on-chain step. Pure.
import type { HistoryEntry } from "./history.ts";
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { switchedOffSlope } from "./pauAudit.ts";
import type { PauHistoryResponse } from "./pauHistory.ts";
import { deploymentsOf, landingLag, queuedFor, routeOf, spellSince, type Route } from "./pauPendingEvidence.ts";
import { escapeRegExp, valueChangedAt } from "./pauValueDate.ts";
import { addDays, type IndexedExecutive } from "./votes/vote-index.ts";

export type { Route };

/** Executive Votes run about every two weeks (de178e9a, A.1.11.1.4.1): an edit that just misses one cycle waits for the next. */
export const CYCLE_DAYS = 14;
/** From a cycle's Prime Spell Form, due Monday of week 0 (20ff0ea2, A.1.10.2.3.2.2.3.1.1), to its Executive Vote in week 2 (0dbdbcca, A.1.10.2.3.2.2.3.3.7), a Thursday. */
export const SPELL_LEAD_DAYS = 17;
/** An executive not cast this many days after its date has expired. */
export const SPELL_EXPIRY_DAYS = 30;
/** How long past its execution time a queued action set is still taken as coming; the Executor's own grace period is not read. */
export const ACTION_SET_SLACK_DAYS = 7;

/** An executive as the history or the vote record names it; title, date and url are null for a spell older than every record. */
export interface SpellRef {
  title: string | null;
  date: string | null;
  url: string | null;
}

/** What the change is waiting on, strongest evidence first. */
export type PendingStep =
  | { kind: "queued"; chain: string; tx: string; at: string | null }
  | { kind: "plotted"; starSpell: string; tx: string; at: string | null }
  | { kind: "uncast"; spell: SpellRef }
  | { kind: "window" };

export interface PendingOnchain {
  /** When the atlas last wrote the stated value, YYYY-MM-DD. */
  atlasChanged: string;
  /** The last day the chain is expected to still lag; after it the mismatch stands. */
  expectedBy: string;
  route: Route;
  step: PendingStep;
}

/** "executed": governance changed the deployment since without the change: a spell, or `actionsSet`, an action set relayed whose spell is not proven yet. */
export type OnchainStep = { kind: "pending"; pending: PendingOnchain } | { kind: "executed"; spell: SpellRef; chain: string; tx: string; actionsSet?: number };

export interface PendingContext {
  /** The vote record's executives, for one not yet cast. */
  executives: readonly IndexedExecutive[];
  pau: PauHistoryResponse;
  /** The prime's snapshots. */
  snaps: readonly StoredPauSnapshot[];
  /** The prime's name, as executives name it ("Spark"); null when not known. */
  prime: string | null;
  /** Today, YYYY-MM-DD. */
  today: string;
}

/** The first executive not yet cast, dated on or after `since`, whose text names the prime. */
export function nextSpell(executives: readonly IndexedExecutive[], since: string, prime: string | null): IndexedExecutive | null {
  if (!prime) return null;
  const names = new RegExp(`\\b${escapeRegExp(prime.toLowerCase())}\\b`);
  return executives.find((e) => !e.cast && e.date >= since && names.test(e.text)) ?? null;
}

const day = (iso: string | null, fallback: string) => (iso ?? fallback).slice(0, 10);

/** Every step the change could be waiting on, each with the last day it is expected by, strongest first. */
function candidates(c: ValueCheck, atlasChanged: string, deps: StoredPauSnapshot[], ctx: PendingContext): { step: PendingStep; until: string }[] {
  const lag = landingLag(ctx.pau.entries, c.chain);
  const queued = queuedFor(ctx.pau.queued ?? [], deps, atlasChanged).map((q) =>
    q.kind === "action-set"
      ? { step: { kind: "queued" as const, chain: q.chain, tx: q.tx, at: q.at }, until: addDays(day(q.at, q.time), ACTION_SET_SLACK_DAYS) }
      : { step: { kind: "plotted" as const, starSpell: q.id, tx: q.tx, at: q.at }, until: q.at ? day(q.at, q.time) : addDays(day(null, q.time), SPELL_EXPIRY_DAYS) },
  );
  const spell = nextSpell(ctx.executives, atlasChanged, ctx.prime);
  const uncast = spell ? [{ step: { kind: "uncast" as const, spell: { title: spell.title, date: spell.date, url: spell.url } }, until: addDays(spell.date, SPELL_EXPIRY_DAYS + lag) }] : [];
  return [...queued, ...uncast, { step: { kind: "window" }, until: addDays(atlasChanged, CYCLE_DAYS + SPELL_LEAD_DAYS + lag) }];
}

/**
 * What the record says of an atlas change the chain lacks, for one check. Null
 * when the chain set the key on or after the change, the change is not dated,
 * or nothing is known either way.
 */
export function onchainStep(c: ValueCheck, atlasChanged: string | null, ctx: PendingContext): OnchainStep | null {
  const chainSet = c.limit?.setAt.time.slice(0, 10) ?? null;
  if (!atlasChanged || (chainSet && chainSet >= atlasChanged)) return null;
  const deps = deploymentsOf(c, ctx.snaps);
  const route = routeOf(c, deps);
  const live = candidates(c, atlasChanged, deps, ctx).find((x) => ctx.today <= x.until);
  if (live) return { kind: "pending", pending: { atlasChanged, expectedBy: live.until, route, step: live.step } };
  if (route === "operator") return null;
  const e = spellSince(ctx.pau.entries, deps, addDays(atlasChanged, SPELL_LEAD_DAYS));
  if (!e) return null;
  const relayed = e.origin?.kind === "relayed" && e.origin.relay ? { actionsSet: e.origin.relay.actionsSet } : {};
  return { kind: "executed", spell: { title: e.executive?.title ?? null, date: e.executive?.date ?? null, url: e.executive?.url ?? null }, chain: e.chain, tx: e.tx, ...relayed };
}

/** A mismatch's pending on-chain step, or null when the chain is not waiting on the atlas or is past due. */
export function pendingFor(c: ValueCheck, all: ValueCheck[], atlasChanged: string | null, ctx: PendingContext): PendingOnchain | null {
  if (c.status !== "mismatch" || !c.limit || switchedOffSlope(c, all)) return null;
  const step = onchainStep(c, atlasChanged, ctx);
  return step?.kind === "pending" ? step.pending : null;
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
