// A single, shared, lazily-loaded snapshot of the on-chain balances map, so
// every inline <Address> pill can show a balance without each one firing its own
// fetch. Backed by the same session cache the hover tooltip uses
// (loadBalancesCached), deduped to one request. Exposed for useSyncExternalStore:
// one subscription list, one stable snapshot reference between updates.
import { loadBalancesCached, peekCachedBalances, type AddressBalances } from "@/lib/balances";

type BalanceMap = Record<string, AddressBalances>;
const EMPTY: BalanceMap = {};

let snapshot: BalanceMap = peekCachedBalances()?.addresses ?? EMPTY;
let started = !!peekCachedBalances();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Fires the one shared GET the first time any pill subscribes. A failed fetch
// settles to the empty map (same as "no balances known") rather than retrying,
// so a pill just shows no balance instead of spinning.
function ensureLoaded() {
  if (started) return;
  started = true;
  let p: ReturnType<typeof loadBalancesCached> | undefined;
  try {
    p = loadBalancesCached();
  } catch {
    snapshot = EMPTY;
    return;
  }
  // Defensive: a stubbed/mocked loader (tests) can return a non-promise.
  if (!p || typeof p.then !== "function") {
    snapshot = EMPTY;
    return;
  }
  p.then((r) => {
    snapshot = r.addresses;
    emit();
  }).catch(() => {
    snapshot = EMPTY;
    emit();
  });
}

export function subscribeBalances(cb: () => void): () => void {
  listeners.add(cb);
  ensureLoaded();
  return () => {
    listeners.delete(cb);
  };
}

export function balancesSnapshot(): BalanceMap {
  return snapshot;
}
