// Ambient types for the canonical address-chain helpers (address-chains.mjs),
// so TS consumers (e.g. src/server/doc-rows.ts) get types without a rewrite.
/** Bare address body, no boundary assertion — compose into a larger pattern. */
export const ETH_ADDR_SRC: string;
export const SOL_ADDR_SRC: string;
export const ETH_ADDR_RE: RegExp;
export const SOL_ADDR_RE: RegExp;
/** Non-global sibling of ETH_ADDR_RE for callers that want the first match only. */
export const ETH_ADDR_FIRST_RE: RegExp;
/** Whole-string ("is this value, in its entirety, an address?") forms. */
export const ETH_ADDR_EXACT_RE: RegExp;
export const SOL_ADDR_EXACT_RE: RegExp;
/** Prose chain-hint regexes, compiled from the registry's proseHints. */
export const CHAIN_HINTS: Array<{ chain: string; patterns: RegExp[] }>;
export function chainFromLabel(label: string | undefined | null): string | null;
export function detectChainOrNull(content: string, matchIndex: number): string | null;
export function detectChainSignal(
  content: string,
  matchIndex: number,
): { chain: string; explicit: boolean; deferred?: string } | null;
export function normalizeAddress(addr: string): string;
export function annotationWindow(content: string, matchIndex: number, addrLength: number): string;
export function findTableContext(content: string, matchIndex: number): string | null;
export function detectChain(content: string, matchIndex: number): string;
