// Pure resolution logic for the address hover tooltip (src/components/AddressTooltip.tsx):
// an address's display name + its non-zero held balances, from the shared
// address map and the balances cache.
import type { AddressInfo } from "../types";
import type { BalanceMap, AddressBalances } from "./balances";
import { compactAmount } from "./tokens";
import { shortAddr } from "./format";
import { PRIMARY_BALANCE_SYMBOLS } from "./onchainAddressesIndex";

export interface HeldBalance {
  symbol: string;
  amount: string;
}

// Balances held (> 0), primary symbols (ETH/USDS/SKY) first in that order,
// then everything else alphabetically.
export function heldBalances(balances: BalanceMap): HeldBalance[] {
  const order = PRIMARY_BALANCE_SYMBOLS as readonly string[];
  const rank = (symbol: string) => {
    const i = order.indexOf(symbol);
    return i === -1 ? order.length : i;
  };
  return Object.entries(balances)
    .filter(([, b]) => {
      try {
        return BigInt(b.raw) > 0n;
      } catch {
        return false;
      }
    })
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([symbol, b]) => ({ symbol, amount: compactAmount(b.raw, b.decimals) }));
}

// address (lowercased, falling back to as-written for case-sensitive Solana
// addresses) → its display name and held balances. Mirrors the addrMap lookup
// in explorerUrl() (explorer.ts). balancesByAddress needs no such fallback —
// balances.ts's readCache always lowercases the address half of its keys.
export function resolveAddressTooltip(
  address: string,
  addrMap: Record<string, AddressInfo>,
  balancesByAddress: Record<string, AddressBalances>,
): { name: string; held: HeldBalance[] } {
  const key = address.toLowerCase();
  const info = addrMap[key] ?? addrMap[address];
  const name = info?.label ?? shortAddr(address);
  if (!info) return { name, held: [] };
  const bal = balancesByAddress[`${key}|${info.chain}`];
  return { name, held: bal ? heldBalances(bal.balances) : [] };
}
