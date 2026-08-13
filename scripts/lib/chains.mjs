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
import { readFileSync } from "node:fs";

// The registry is data, not code: src/data/chain-registry.json is the single
// source of truth, and CHAINS / CHAIN_HINTS / EXPLORER / NATIVE_TOKEN all
// derive from it. Read with fs rather than an import assertion so this module
// loads identically under node, bun and vitest; it is never bundled for the
// browser (src/ does not import scripts/), so there is no cost to that.
const REGISTRY = JSON.parse(
  readFileSync(new URL("../../src/data/chain-registry.json", import.meta.url), "utf8"),
);

// Ordered specific → generic: ethereum is last so a label mentioning both a
// specific chain and "mainnet" resolves to the specific chain. Solana has no
// EVM chainId. Aliases are lowercase substrings safe to match inside a short
// chain-label string.
//
// rpcUrl: free public HTTPS endpoints — no API key. PublicNode where available;
// Robinhood uses the official public RPC (not on PublicNode yet).
//
// blockscoutApi: Etherscan-compatible Blockscout `/api` base (no key). Used by
// address-enrich as the *primary* contract-metadata source for chains Etherscan
// v2 doesn't cover (robinhood, flagged `etherscan: false`), and as a *fallback*
// for chains that do (ethereum) when the Etherscan call hard-fails.
//
// Shaped to the historical object so every existing consumer is unchanged:
// optional keys stay absent rather than becoming explicit undefined.
export const CHAINS = REGISTRY.chains.map((c) => ({
  chain: c.chain,
  ...(c.chainId != null && { chainId: c.chainId }),
  aliases: c.aliases,
  ...(c.rpcUrl && { rpcUrl: c.rpcUrl }),
  ...(c.solanaRpcUrl && { solanaRpcUrl: c.solanaRpcUrl }),
  ...(c.blockscoutApi && { blockscoutApi: c.blockscoutApi }),
  ...(c.etherscan === false && { etherscan: false }),
}));

// Future / testnet chains with no explorer or full support yet — collapse to
// ethereum so every address still resolves to a valid explorer + network id.
// Tracked as `deferred` by classifyChainLabel / census:chains (not "unknown").
export const FUTURE_TO_ETHEREUM = REGISTRY.deferred;

/**
 * Prose chain-hint specs, ethereum FIRST — the opposite of CHAINS' ordering,
 * because a prose window mentioning "ethereum mainnet" should resolve there
 * while a *label* naming a specific chain should not. Consumed by
 * address-chains.mjs, which compiles them to word-boundary regexes.
 * A chain with no proseHints (solana) is deliberately omitted.
 */
export const CHAIN_HINT_SPECS = [
  ...REGISTRY.chains.filter((c) => c.chain === "ethereum"),
  ...REGISTRY.chains.filter((c) => c.chain !== "ethereum"),
]
  .filter((c) => c.proseHints?.length)
  .map((c) => ({
    chain: c.chain,
    hints: c.proseHints,
    exclusions: c.proseHintExclusions ?? {},
  }));

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

/** Solana's JSON-RPC endpoint — a different protocol, so deliberately not in CHAIN_RPC. */
export const SOLANA_RPC = CHAINS.find((c) => c.chain === "solana")?.solanaRpcUrl;

/**
 * Blockscout Etherscan-compatible `/api` base per chain. Used by address-enrich
 * as the primary contract-metadata source for chains Etherscan v2 doesn't cover
 * (robinhood) and as a fallback for chains that do (ethereum) when Etherscan
 * hard-fails. An optional BLOCKSCOUT_API_KEY raises Blockscout's rate limit.
 */
export const CHAIN_BLOCKSCOUT = Object.fromEntries(
  CHAINS.filter((c) => c.blockscoutApi).map((c) => [c.chain, c.blockscoutApi]),
);

/**
 * Chains whose contract metadata is fetched from Etherscan v2 (has a chainId and
 * is not flagged `etherscan: false`). robinhood is excluded — Etherscan v2 has
 * no endpoint for chain 4663, so Blockscout is its only source.
 */
export const CHAIN_SUPPORTS_ETHERSCAN = new Set(
  CHAINS.filter((c) => c.chainId != null && c.etherscan !== false).map((c) => c.chain),
);
