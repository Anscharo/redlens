// DOM-free chain-snapshot value shapes. Extracted from chainstate.ts — which
// fetches over the network and so pulls in the browser-coupled loader layer —
// so type-only consumers can name these without dragging that in. chainstate.ts
// re-exports them for existing callers. Same arrangement as docsTypes.ts.

/** A single view-function result: string for uint/address/bytes, bool, or null when the call reverted. */
export type ChainScalar = string | boolean | null;
export type ChainValue = ChainScalar | ChainValue[] | { [key: string]: ChainValue };
