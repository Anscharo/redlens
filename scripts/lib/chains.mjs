/**
 * Canonical chain registry — single source of truth for chain identity in the
 * build pipeline. `normalizeChainLabel` maps an explicit chain *label* (an ICD
 * "Token Address (Base)" parenthetical, a multisig table header, etc.) to a
 * canonical key; `CHAIN_ID` gives the EVM network id per chain.
 *
 * NOTE: chain detection from free *prose* (address-chains.mjs `detectChain` /
 * `CHAIN_HINTS`) is a deliberately separate algorithm — it uses word-boundary
 * regexes and the opposite ordering (ethereum first, so "ethereum mainnet"
 * context wins), whereas label normalization checks specific chains first so a
 * label like "Base Mainnet" resolves to base, not ethereum. Don't merge them.
 */

// Ordered specific → generic: ethereum is last so a label mentioning both a
// specific chain and "mainnet" resolves to the specific chain. Solana has no
// EVM chainId. Keep aliases as lowercase substrings safe to match inside a
// short chain-label string.
//
// rpcUrl: free public HTTPS endpoints — no API key. PublicNode where available;
// Robinhood uses the official public RPC (not on PublicNode yet).
export const CHAINS = [
  { chain: "base", chainId: 8453, aliases: ["base"], rpcUrl: "https://base-rpc.publicnode.com" },
  { chain: "arbitrum", chainId: 42161, aliases: ["arbitrum"], rpcUrl: "https://arbitrum-one-rpc.publicnode.com" },
  { chain: "optimism", chainId: 10, aliases: ["optimism"], rpcUrl: "https://optimism-rpc.publicnode.com" },
  { chain: "solana", aliases: ["solana"] },
  { chain: "avalanche", chainId: 43114, aliases: ["avalanche", "avax"], rpcUrl: "https://avalanche-c-chain-rpc.publicnode.com" },
  { chain: "polygon", chainId: 137, aliases: ["polygon"], rpcUrl: "https://polygon-bor-rpc.publicnode.com" },
  { chain: "gnosis", chainId: 100, aliases: ["gnosis"], rpcUrl: "https://gnosis-rpc.publicnode.com" },
  // Robinhood Chain — Arbitrum Orbit L2, chain id 4663 (0x1237).
  { chain: "robinhood", chainId: 4663, aliases: ["robinhood"], rpcUrl: "https://rpc.mainnet.chain.robinhood.com" },
  { chain: "ethereum", chainId: 1, aliases: ["ethereum", "mainnet"], rpcUrl: "https://ethereum-rpc.publicnode.com" },
];

// Future / testnet chains with no explorer or full support yet — collapse to
// ethereum so every address still resolves to a valid explorer + network id.
// Tracked as `deferred` by classifyChainLabel / census:chains (not "unknown").
export const FUTURE_TO_ETHEREUM = ["monad", "plume", "plasma"];

const DEFAULT_CHAIN = "ethereum";

/**
 * Classify an explicit chain label.
 *   known    — in CHAINS
 *   deferred — in FUTURE_TO_ETHEREUM (intentionally collapsed to ethereum)
 *   unknown  — unrecognized non-empty string (atlas drift signal)
 *   empty    — null/blank
 */
export function classifyChainLabel(raw) {
  if (!raw || !String(raw).trim()) return { kind: "empty", chain: DEFAULT_CHAIN };
  const s = String(raw).toLowerCase();
  for (const { chain, aliases } of CHAINS) {
    if (aliases.some((a) => s.includes(a))) return { kind: "known", chain };
  }
  const deferred = FUTURE_TO_ETHEREUM.find((a) => s.includes(a));
  if (deferred) return { kind: "deferred", chain: DEFAULT_CHAIN, deferred, raw: String(raw).trim() };
  return { kind: "unknown", chain: DEFAULT_CHAIN, raw: String(raw).trim() };
}

/**
 * Map an explicit chain label to a canonical chain key via substring match.
 * Empty/unknown/deferred → ethereum. Pass `warnCtx` to log a warning on an
 * unrecognized non-empty label (used by ICD / multisig parsing).
 */
export function normalizeChainLabel(raw, warnCtx) {
  const c = classifyChainLabel(raw);
  if (c.kind === "unknown" && warnCtx) {
    console.warn(`  ${warnCtx}: unrecognized chain string "${raw}", defaulting to ethereum`);
  }
  return c.chain;
}

export const CHAIN_ID = Object.fromEntries(
  CHAINS.filter((c) => c.chainId != null).map((c) => [c.chain, c.chainId]),
);

/** Public HTTPS RPC URL per EVM chain key. Solana has none. */
export const CHAIN_RPC = Object.fromEntries(
  CHAINS.filter((c) => c.rpcUrl).map((c) => [c.chain, c.rpcUrl]),
);
