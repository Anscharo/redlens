// Pure resolution logic for the address hover tooltip (src/components/AddressTooltip.tsx):
// an address's display name + its non-zero held balances, from the shared
// address map and the balances cache.
import type { AddressInfo } from "@/types";
import type { BalanceMap, AddressBalances } from "@/lib/balances";
import { compactAmount } from "@/lib/tokens";
import { shortAddr } from "./format";
import { PRIMARY_BALANCE_SYMBOLS } from "./onchainAddressesIndex";

export interface HeldBalance {
  symbol: string;
  amount: string;
  // Present only when the address holds balances on more than one chain —
  // see resolveAddressTooltip's multi-chain aggregation below.
  chain?: string;
}

interface RawHeld {
  symbol: string;
  raw: string;
  decimals: number;
  chain?: string;
}

function rank(symbol: string): number {
  const order = PRIMARY_BALANCE_SYMBOLS as readonly string[];
  const i = order.indexOf(symbol);
  return i === -1 ? order.length : i;
}

// Non-zero entries from a single chain's balance map, unsorted, unformatted.
function nonZero(balances: BalanceMap, chain?: string): RawHeld[] {
  return Object.entries(balances)
    .filter(([, b]) => {
      try {
        return BigInt(b.raw) > 0n;
      } catch {
        return false;
      }
    })
    .map(([symbol, b]) => ({ symbol, raw: b.raw, decimals: b.decimals, chain }));
}

// Primary symbols (ETH/USDS/SKY) first in that order, then alphabetical; ties
// on symbol (only possible once chain-tagged, i.e. multi-chain) break by chain.
function sortHeld(items: RawHeld[]): RawHeld[] {
  return [...items].sort(
    (a, b) =>
      rank(a.symbol) - rank(b.symbol) ||
      a.symbol.localeCompare(b.symbol) ||
      (a.chain ?? "").localeCompare(b.chain ?? ""),
  );
}

// address (lowercased, falling back to as-written for case-sensitive Solana
// addresses) → its display name and held balances across every chain the
// atlas places it on (a Safe or deterministically-deployed contract can sit
// at the same address on several chains). Mirrors the addrMap lookup in
// explorerUrl() (explorer.ts) and the registryName the On-Chain Addresses
// report shows: chainlogId or the verified on-chain name only, never the
// heuristic entityLabel (a best-effort proper-noun extraction from
// surrounding prose — too often a stray phrase, not a real name).
export function resolveAddressTooltip(
  address: string,
  addrMap: Record<string, AddressInfo>,
  balancesByAddress: Record<string, AddressBalances>,
): { name: string; held: HeldBalance[] } {
  // Exact case first: addressMap keys EVM addresses lowercased but leaves
  // case-sensitive Solana base58 keys as-written (address-chains.mjs), so an
  // exact match is always correct and a lowercased fallback is only needed to
  // find a mixed-case EVM address (e.g. checksummed in markdown) — never for
  // Solana, where lowercasing first risked resolving a different real pubkey.
  const key = address.toLowerCase();
  const info = addrMap[address] ?? addrMap[key];
  const name = info?.chainlogId ?? info?.etherscanName ?? shortAddr(address);
  if (!info) return { name, held: [] };

  // chains always contains at least info.chain — see AddressInfo's own comment.
  const chains = info.chains;
  const multiChain = chains.length > 1;
  const raw = chains.flatMap((chain) => {
    const bal = balancesByAddress[`${key}|${chain}`];
    return bal ? nonZero(bal.balances, multiChain ? chain : undefined) : [];
  });
  const held = sortHeld(raw).map((h) => ({
    symbol: h.symbol,
    amount: compactAmount(h.raw, h.decimals),
    chain: h.chain,
  }));
  return { name, held };
}
