// What became of the spell a change belongs to (pauPending.ts), from the vote
// record and the PAU history: named by date in the pull request's own words
// (`namedStep`), or by the Prime Snapshot poll that links the pull request
// (`pollStep`, primePolls.ts), which an executive's Prime Agent Proxy Spells
// section links in turn. A poll names the spell item by item: a thread lists
// several items, an artifact item is carried by no spell, and an item can be
// re-proposed for another spell. Pure.
import type { ValueCheck } from "./pauAtlasValues.ts";
import type { Named, OnchainStep, PendingContext, PendingStep, SpellRef } from "./pauPending.ts";
import { deploymentsOf, keySetBy, queuedRelay } from "./pauPendingEvidence.ts";
import { offSpellPoll, type PrimePoll } from "./primePolls.ts";
import { addDays, executiveFor, SLIP_DAYS, type IndexedExecutive } from "./votes/vote-index.ts";

/** An executive not cast this many days after its date has expired. */
export const SPELL_EXPIRY_DAYS = 30;
/** How long after a spell executes its changes may still be unread or unattributed: the worker retries an unproven origin every six hours, and a relay waits its Executor's delay. */
export const READ_DAYS = 3;

const ref = (e: IndexedExecutive): SpellRef => ({ title: e.title, date: e.date, url: e.url });
const pending = (named: Named, expectedBy: string, step: PendingStep): OnchainStep => ({ kind: "pending", pending: { ...named, expectedBy, step } });

/** What became of a cast spell: it set the key, its relay or its changes are still coming, or it ran without the change. */
function afterCast(c: ValueCheck, named: Named, x: IndexedExecutive, ctx: PendingContext): OnchainStep {
  const spell = ref(x);
  const executed = x.executed ?? null;
  const recorded = !!executed && executed <= named.atlasChanged;
  const set = x.spell ? keySetBy(ctx.pau, x.spell, c) : null;
  if (set) return { kind: "set", named, spell, chain: set.chain, tx: set.tx, recorded };
  const since = executed ?? x.date;
  const relay = c.chain === "ethereum" ? null : queuedRelay(ctx.pau.queued ?? [], deploymentsOf(c, ctx.snaps), since);
  if (relay) return pending(named, addDays((relay.at ?? relay.time).slice(0, 10), READ_DAYS), { kind: "queued", spell, chain: relay.chain, tx: relay.tx, at: relay.at });
  if (ctx.today <= addDays(since, READ_DAYS)) return pending(named, addDays(since, READ_DAYS), { kind: "reading", spell, executed: since });
  return { kind: "executed", named, spell, executed, recorded };
}

/** An executive carrying the change: what it did once cast, else pending until it expires uncast. */
function carriedBy(c: ValueCheck, named: Named, x: IndexedExecutive, ctx: PendingContext): OnchainStep {
  if (x.cast) return afterCast(c, named, x, ctx);
  const until = addDays(x.date, SPELL_EXPIRY_DAYS);
  return ctx.today <= until ? pending(named, until, { kind: "uncast", spell: ref(x) }) : { kind: "lapsed", named, spell: ref(x), why: "expired" };
}

/** What became of the spell one change names by date. */
export function namedStep(c: ValueCheck, named: Named, ctx: PendingContext): OnchainStep {
  const x = executiveFor(ctx, named.date, false);
  if (x) return carriedBy(c, { ...named, date: x.date }, x, ctx);
  return ctx.today <= addDays(named.date, SLIP_DAYS) ? pending(named, addDays(named.date, SLIP_DAYS), { kind: "unfiled" }) : { kind: "lapsed", named, spell: null, why: "none" };
}

/**
 * A passed spell item no executive links yet: still coming while the spell its
 * thread names is not filed (within the slip), else lapsed, naming that spell
 * when it was filed without the poll.
 */
function unlinked(named: Named, ctx: PendingContext): OnchainStep {
  const x = executiveFor(ctx, named.date, false);
  if (x) return { kind: "lapsed", named, spell: ref(x), why: "not-carried" };
  return ctx.today <= addDays(named.date, SLIP_DAYS) ? pending(named, addDays(named.date, SLIP_DAYS), { kind: "unfiled" }) : { kind: "lapsed", named, spell: null, why: "none" };
}

/** What became of the spell item one Snapshot poll stands for. */
export function pollStep(c: ValueCheck, base: Omit<Named, "date">, poll: PrimePoll, ctx: PendingContext): OnchainStep {
  const named: Named = { ...base, date: poll.threadDate ?? poll.end, poll: { id: poll.id, title: poll.title, space: poll.space } };
  const xs = ctx.snapshots?.get(poll.id) ?? [];
  const x = xs.find((e) => e.cast) ?? xs.at(-1);
  if (x) return carriedBy(c, { ...named, date: x.date }, x, ctx);
  if (poll.passed === null) return pending(named, poll.end, { kind: "polling" });
  if (!poll.passed) return { kind: "rejected", named };
  return offSpellPoll(poll) ? { kind: "off-spell", named } : unlinked(named, ctx);
}
