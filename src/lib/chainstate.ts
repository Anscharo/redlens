import { fetchJson } from "./verify";

interface ChainState {
  block: string;
  values: Record<string, Record<string, ChainValue>>;
}

// A single view function result — string for uint/address/bytes, bool,
// array, object for tuples, or null when the call reverted.
export type ChainScalar = string | boolean | null;
export type ChainValue = ChainScalar | ChainValue[] | { [key: string]: ChainValue };

let cached: Promise<ChainState> | null = null;

export function loadChainState(): Promise<ChainState> {
  if (!cached) {
    cached = fetchJson<ChainState>(
      `${import.meta.env.BASE_URL}chain-state.json`,
      "chain-state.json",
    ).catch(() => {
      // Don't cache the failure — a blip (or a build that hasn't produced
      // chain-state.json yet) should be retried on the next call instead of
      // permanently resolving to empty values for the rest of the session.
      cached = null;
      return { block: "", values: {} };
    });
  }
  return cached;
}
