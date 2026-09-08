// Pure resolution logic for the address hover tooltip (src/components/AddressTooltip.tsx):
// an address's display name + its non-zero held balances, from the shared
// address map and the balances cache.
import type { AddressInfo } from "@/types";
import type { BalanceMap, AddressBalances } from "@/lib/balances";
import { compactAmount } from "@/lib/tokens";
import { resolveAddressName } from "./addressName";
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
// Symbols we can treat as ~$1 to show a real dollar figure. Everything else has
// no price feed in this app, so it can only be shown as a token amount.
const STABLES = new Set(["USDS", "SUSDS", "USDC", "USDT", "DAI", "USDP", "PYUSD", "RLUSD"]);

function compactUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/**
 * A single compact "headline" balance for an address, for the inline pill:
 * the summed stablecoin value as `$3.2K` when it's ≥ $1 (a true dollar figure),
 * otherwise the largest-priority non-stable holding as `35.4M SKY`. Null when the
 * address holds nothing worth showing. Full detail still lives in the tooltip;
 * this is only the teaser. No price feed exists, so non-stables can't be valued
 * in USD — that's why they show the token amount, not a dollar figure.
 */
export function addressHeadlineBalance(
  address: string,
  addrMap: Record<string, AddressInfo>,
  balancesByAddress: Record<string, AddressBalances>,
): string | null {
  const key = address.toLowerCase();
  const info = addrMap[address] ?? addrMap[key];
  const chains = info?.chains ?? (info?.chain ? [info.chain] : []);
  if (chains.length === 0) return null;
  let usd = 0;
  const others: RawHeld[] = [];
  for (const chain of chains) {
    const bal = balancesByAddress[`${key}|${chain}`];
    if (!bal) continue;
    for (const [symbol, b] of Object.entries(bal.balances)) {
      let v: bigint;
      try {
        v = BigInt(b.raw);
      } catch {
        continue;
      }
      if (v <= 0n) continue;
      if (STABLES.has(symbol.toUpperCase())) usd += Number(v) / 10 ** b.decimals;
      else others.push({ symbol, raw: b.raw, decimals: b.decimals });
    }
  }
  if (usd >= 1) return compactUsd(usd);
  if (others.length === 0) return null;
  const top = sortHeld(others)[0];
  // Floor dust at "<0.01": a pill is a teaser, so sub-cent amounts all read the
  // same rather than exposing "<0.0001"-style precision. Exact holdings still
  // live in the hover tooltip.
  const n = Number(top.raw) / 10 ** top.decimals;
  const amount = n <= 0.01 ? "<0.01" : compactAmount(top.raw, top.decimals);
  return `${amount} ${top.symbol}`;
}

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
  const name = resolveAddressName(address, info);
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
