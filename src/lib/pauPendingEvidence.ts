// What the PAU history and snapshots prove about the on-chain step an atlas
// change waits for (pauPending.ts): which deployments hold the value, whether
// the Operator may set its key without a spell, what governance is queued for
// them, which spells have changed them since, and how long spells on a chain
// have taken to land after their executive. Pure.
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import type { PauHistoryEntry, PauQueuedStep } from "./pauHistory.ts";
import { offset } from "./votes/vote-index.ts";

/** How a key's value reaches the chain: the Operator within BeamState's bounds, a spell on Ethereum, or a spell relayed to another chain. */
export type Route = "operator" | "spell" | "relayed";

/** Days from an executive's date to its change landing, used where a chain's history has no spell to measure: passing plus the 48-hour GSM Pause Delay (db442d8a, A.1.10.3.1.2). */
export const DEFAULT_LAG_DAYS = 7;
/** How many of a chain's latest spell changes its landing lag is measured over. */
const LAG_SAMPLE = 10;

/** The prime's deployments that hold the check's value: its own, or every one on its chain when no contract holds the key. */
export const deploymentsOf = (c: ValueCheck, snaps: readonly StoredPauSnapshot[]): StoredPauSnapshot[] =>
  snaps.filter((s) => s.chain === c.chain && (!c.kind || s.kind === c.kind));

/** Whether BeamState lets the Configurator set the key on the contract holding it: the RateLimits is registered and holds a default for the key. */
export function operatorAdjustable(c: ValueCheck, deps: readonly StoredPauSnapshot[]): boolean {
  const key = c.key?.toLowerCase();
  if (!key || !c.contract) return false;
  const rl = deps.flatMap((s) => s.contracts).find((x) => x.address.toLowerCase() === c.contract!.toLowerCase());
  return !!rl?.beam?.defaults.some((d) => d.key.toLowerCase() === key);
}

export const routeOf = (c: ValueCheck, deps: readonly StoredPauSnapshot[]): Route =>
  operatorAdjustable(c, deps) ? "operator" : c.chain === "ethereum" ? "spell" : "relayed";

/** The longest of the chain's latest spell changes, in days from its executive's date to the change; DEFAULT_LAG_DAYS with none. */
export function landingLag(entries: readonly PauHistoryEntry[], chain: string | null): number {
  const lags = entries
    .filter((e) => e.chain === chain && e.origin?.kind === "spell" && e.executive?.date)
    .slice(-LAG_SAMPLE)
    .map((e) => offset(e.executive!.date!, e.time.slice(0, 10)));
  return lags.length ? Math.max(0, ...lags) : DEFAULT_LAG_DAYS;
}

/** Every account holding a role on one of the deployments' contracts, lowercased. */
const admins = (deps: readonly StoredPauSnapshot[]) =>
  new Set(deps.flatMap((s) => s.contracts.flatMap((x) => (x.roles ?? []).filter((r) => r.holds !== false).map((r) => r.account.toLowerCase()))));

/**
 * Governance queued since `since` that can reach the deployments: an action set
 * on an Executor holding a role on their contracts, or a star spell on the
 * prime's StarGuard. Which settings it changes is not decoded.
 */
export function queuedFor(queued: readonly PauQueuedStep[], deps: readonly StoredPauSnapshot[], since: string): PauQueuedStep[] {
  const roles = admins(deps);
  const prime = deps[0]?.prime;
  return queued.filter((q) => q.time.slice(0, 10) >= since && (q.kind === "action-set" ? deps.some((s) => s.chain === q.chain) && roles.has(q.contract.toLowerCase()) : !!prime && q.primes.includes(prime)));
}

/** Governance that ran on a deployment: a proven spell, or an action set an Executor ran whose Ethereum spell is not proven yet. */
const GOVERNANCE = new Set(["spell", "relayed"]);

/** The latest change governance made to any of the deployments whose executive is dated on or after `since` (the change's own date where no executive is known). */
export function spellSince(entries: readonly PauHistoryEntry[], deps: readonly StoredPauSnapshot[], since: string): PauHistoryEntry | null {
  const ids = new Set(deps.map((s) => s.deployment));
  const mine = entries.filter((e) => GOVERNANCE.has(e.origin?.kind ?? "") && (e.executive?.date ?? e.time.slice(0, 10)) >= since && e.changes.some((ch) => ch.deployments.some((d) => ids.has(d))));
  return mine.at(-1) ?? null;
}
