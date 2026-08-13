import { fetchJson } from "./verify";

interface ChainState {
  block: string;
  values: Record<string, Record<string, ChainValue>>;
  /** When the worker took the snapshot (absent on the empty fallback). */
  fetchedAt?: string | null;
}

// A single view function result — string for uint/address/bytes, bool,
// array, object for tuples, or null when the call reverted.
export type ChainScalar = string | boolean | null;
export type ChainValue = ChainScalar | ChainValue[] | { [key: string]: ChainValue };

let cached: Promise<ChainState> | null = null;

export function loadChainState(): Promise<ChainState> {
  if (!cached) {
    // Root-relative, deliberately NOT the sha-keyed atlas base: the snapshot is
    // on-chain data shared by every atlas version, and a preview reuses main's
    // (same-origin /api). 503 until the worker has stored its first snapshot.
    cached = fetchJson<ChainState>("/api/chain-state", "chain-state").catch(() => {
      // Don't cache the failure — a blip (or a server whose worker hasn't
      // stored a snapshot yet) should be retried on the next call instead of
      // permanently resolving to empty values for the rest of the session.
      cached = null;
      return { block: "", values: {} };
    });
  }
  return cached;
}
