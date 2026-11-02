import type { AddressInfo } from "@/types";
import { addressHeadlineBalance } from "../lib/addressTooltip";
import { useSharedBalances } from "../lib/sharedBalances";

/** The address pill's inline green balance teaser. The only part of the pill
 *  that reads the balances, so a pill without it never subscribes to them or
 *  re-renders when they arrive. */
export function AddressBalance({ address, addrMap }: { address: string; addrMap: Record<string, AddressInfo> }) {
  const { addresses, prices } = useSharedBalances(true);
  const balance = addressHeadlineBalance(address, addrMap, addresses, prices);
  return balance ? <span className="rl-addr-bal">{balance}</span> : null;
}
