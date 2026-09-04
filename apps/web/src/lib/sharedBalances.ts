// A single, shared, lazily-loaded snapshot of the on-chain balances map, so
// every inline <Address> pill can show a balance without each one firing its own
// fetch. Backed by the same session cache the hover tooltip uses
// (loadBalancesCached), deduped to one request. Exposed for useSyncExternalStore:
// one subscription list, one stable snapshot reference between updates.
//
// Fetch is eager only for callers that pass `eager: true` (a visible teaser, a
// card's holdings list, a hover tooltip). Prose pills with noBalance must not
// kick off GET /api/balances on mount — that's still hover-gated.
import { useEffect, useSyncExternalStore } from "react";
import { loadBalancesCached, peekCachedBalances, type AddressBalances } from "@/lib/balances";

type BalanceMap = Record<string, AddressBalances>;
const EMPTY: BalanceMap = {};

export interface SharedBalancesState {
  addresses: BalanceMap;
  /** False until the first fetch (or peek) settles — tooltip spinner key. */
  ready: boolean;
}

function fromPeek(): SharedBalancesState {
  const peeked = peekCachedBalances();
  return peeked
    ? { addresses: peeked.addresses, ready: true }
    : { addresses: EMPTY, ready: false };
}

let snapshot: SharedBalancesState = fromPeek();
let started = snapshot.ready;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function apply(next: SharedBalancesState) {
  if (snapshot.addresses === next.addresses && snapshot.ready === next.ready) return;
  snapshot = next;
  emit();
}

// Fires the one shared GET. A failed fetch settles to the empty map (same as
// "no balances known") rather than retrying, so a pill just shows no balance
// instead of spinning.
function ensureLoaded() {
  if (started) return;
  started = true;
  let p: ReturnType<typeof loadBalancesCached> | undefined;
  try {
    p = loadBalancesCached();
  } catch {
    apply({ addresses: EMPTY, ready: true });
    return;
  }
  // Defensive: a stubbed/mocked loader (tests) can return a non-promise.
  if (!p || typeof p.then !== "function") {
    apply({ addresses: EMPTY, ready: true });
    return;
  }
  p.then((r) => {
    apply({ addresses: r.addresses, ready: true });
  }).catch(() => {
    apply({ addresses: EMPTY, ready: true });
  });
}

function subscribeBalances(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function balancesSnapshot(): SharedBalancesState {
  return snapshot;
}

/** Test-only: restore the store to whatever peekCachedBalances currently holds. */
export function resetSharedBalances() {
  snapshot = fromPeek();
  started = snapshot.ready;
}

/**
 * Shared balances map. Pass `eager` when this mount actually needs the data
 * (inline teaser, card holdings, hover tooltip). A false `eager` still
 * subscribes so a later teaser on the same page can paint, but does not fetch.
 */
export function useSharedBalances(eager = false): SharedBalancesState {
  const state = useSyncExternalStore(subscribeBalances, balancesSnapshot, balancesSnapshot);
  useEffect(() => {
    if (!eager) return;
    // Re-read the session cache on each eager mount so a report refresh
    // (requestBalancesRefresh updates peek) lands on the next hover/card.
    const peeked = peekCachedBalances();
    if (peeked) apply({ addresses: peeked.addresses, ready: true });
    ensureLoaded();
  }, [eager]);
  return state;
}
