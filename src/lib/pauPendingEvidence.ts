// What the PAU history and snapshots prove about one spell and one value
// (pauPending.ts): which deployments hold the value, whether the spell set the
// key, and what governance is queued for the deployments. Who else may set the
// key is pauKeyRoutes.ts. Pure.
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { entriesOfSpell, type PauChange, type PauHistoryEntry, type PauHistoryResponse, type PauQueuedStep } from "./pauHistory.ts";
import { isSvmChain } from "./pauRegistry.ts";

/** The prime's deployments that hold the check's value: its own, or every one on its chain when no contract holds the key. */
export const deploymentsOf = (c: ValueCheck, snaps: readonly StoredPauSnapshot[]): StoredPauSnapshot[] =>
  snaps.filter((s) => s.chain === c.chain && (!c.kind || s.kind === c.kind));

/**
 * The spell's change to the check's key on the contract holding it, latest
 * first; null when the spell did not set it. A Solana limit is its own account
 * (the key), so a change to that account sets it.
 */
export function keySetBy(pau: PauHistoryResponse, spell: string, c: ValueCheck): PauHistoryEntry | null {
  const key = c.key?.toLowerCase();
  if (!key || !c.contract) return null;
  const contract = c.contract.toLowerCase();
  const svm = !!c.chain && isSvmChain(c.chain);
  const sets = (ch: PauChange) => (svm ? ch.contract.toLowerCase() === key : ch.contract.toLowerCase() === contract && ch.subject?.toLowerCase() === key);
  return entriesOfSpell(pau, spell).filter((e) => e.changes.some(sets)).at(-1) ?? null;
}

/** Every account holding a role on one of the deployments' contracts, lowercased. */
const admins = (deps: readonly StoredPauSnapshot[]) =>
  new Set(deps.flatMap((s) => s.contracts.flatMap((x) => (x.roles ?? []).filter((r) => r.holds !== false).map((r) => r.account.toLowerCase()))));

/**
 * An action set queued on an Executor holding a role on the deployments'
 * contracts after the spell executed (`since`) and before the next spell did
 * (`until`, null while none has): the relay of that spell to their chain. The
 * window, not a bridge message, ties the set to the spell, so a later spell's
 * relay is never taken for this one's. Which settings it changes is not decoded.
 */
export function queuedRelay(queued: readonly PauQueuedStep[], deps: readonly StoredPauSnapshot[], since: string, until: string | null): PauQueuedStep | null {
  const roles = admins(deps);
  const inWindow = (t: string) => t >= since && (!until || t < until);
  return queued.find((q) => q.kind === "action-set" && inWindow(q.time) && deps.some((s) => s.chain === q.chain) && roles.has(q.contract.toLowerCase())) ?? null;
}

/**
 * The relay of a spell to a Solana deployment: a LayerZero governance message
 * the Ethereum sender sent after the spell executed (`since`) and before the
 * next spell did (`until`) that no Solana receipt holds yet. LayerZero has no
 * queue on Solana (the governance program runs a message when it is
 * delivered), so this is the message in flight. Its destination is not read,
 * so an undelivered message to another chain counts too; the reader bounds
 * how long one counts (pauSpellStep.ts `dueRelay`).
 */
export function messageInFlight(queued: readonly PauQueuedStep[], since: string, until: string | null): PauQueuedStep | null {
  return queued.find((q) => q.kind === "lz-message" && q.time >= since && (!until || q.time < until)) ?? null;
}
