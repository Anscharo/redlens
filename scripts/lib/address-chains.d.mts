// Ambient types for the canonical address-chain helpers (address-chains.mjs),
// so TS consumers (e.g. src/server/doc-rows.ts) get types without a rewrite.
export const ETH_ADDR_RE: RegExp;
export const SOL_ADDR_RE: RegExp;
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
