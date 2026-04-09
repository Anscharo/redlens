export interface ChainState {
  generatedAt: string;
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
    cached = fetch(`${import.meta.env.BASE_URL}chain-state.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`chain-state.json: ${r.status}`);
        return r.json() as Promise<ChainState>;
      })
      .catch(() => ({ generatedAt: "", block: "", values: {} }));
  }
  return cached;
}
