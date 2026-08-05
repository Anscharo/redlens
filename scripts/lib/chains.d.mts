// Type declarations for the canonical chain registry (chains.mjs), so server
// TypeScript (tsconfig.server.json) can import it. Runtime stays chains.mjs.
export interface ChainEntry {
  chain: string;
  chainId?: number;
  aliases: string[];
  rpcUrl?: string;
  blockscoutApi?: string;
  etherscan?: boolean;
}
export const CHAINS: ChainEntry[];
export const FUTURE_TO_ETHEREUM: string[];
export function classifyChainLabel(
  raw: unknown,
): { kind: "empty" | "known" | "deferred" | "unknown"; chain: string; deferred?: string; raw?: string };
export function normalizeChainLabel(raw: unknown, warnCtx?: string): string;
export const CHAIN_ID: Record<string, number>;
export const CHAIN_RPC: Record<string, string>;
export const CHAIN_BLOCKSCOUT: Record<string, string>;
export const CHAIN_SUPPORTS_ETHERSCAN: Set<string>;
