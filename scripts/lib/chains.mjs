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
export const CHAINS = [
  { chain: "base", chainId: 8453, aliases: ["base"] },
  { chain: "arbitrum", chainId: 42161, aliases: ["arbitrum"] },
  { chain: "optimism", chainId: 10, aliases: ["optimism"] },
  { chain: "solana", aliases: ["solana"] },
  { chain: "avalanche", chainId: 43114, aliases: ["avalanche", "avax"] },
  { chain: "polygon", chainId: 137, aliases: ["polygon"] },
  { chain: "gnosis", chainId: 100, aliases: ["gnosis"] },
  { chain: "robinhood", chainId: 4663, aliases: ["robinhood"] },
  { chain: "ethereum", chainId: 1, aliases: ["ethereum", "mainnet"] },
];

// Future / testnet chains with no explorer or chainId mapping yet — collapse to
// ethereum so every address still resolves to a valid explorer + network id.
const FUTURE_TO_ETHEREUM = ["monad", "plume", "plasma"];

const DEFAULT_CHAIN = "ethereum";

/**
 * Map an explicit chain label to a canonical chain key via substring match.
 * Empty/unknown → ethereum. Pass `warnCtx` to log a warning on an unrecognized
 * non-empty label (used by ICD param parsing to surface new chain strings).
 */
export function normalizeChainLabel(raw, warnCtx) {
  if (!raw) return DEFAULT_CHAIN;
  const s = raw.toLowerCase();
  for (const { chain, aliases } of CHAINS) {
    if (aliases.some((a) => s.includes(a))) return chain;
  }
  if (FUTURE_TO_ETHEREUM.some((a) => s.includes(a))) return DEFAULT_CHAIN;
  if (warnCtx) {
    console.warn(`  ${warnCtx}: unrecognized chain string "${raw}", defaulting to ethereum`);
  }
  return DEFAULT_CHAIN;
}

export const CHAIN_ID = Object.fromEntries(
  CHAINS.filter((c) => c.chainId != null).map((c) => [c.chain, c.chainId]),
);
