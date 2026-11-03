import { useEffect } from "react";
import type { MultisigFact } from "@/lib/addressGraphFacts";
import type { AddressInfo } from "@/types";
import { useSharedBalances } from "../lib/sharedBalances";
import { resolveAddressHoldings } from "../lib/addressTooltip";
import { resolveSafes } from "../lib/addressSafe";
import { AddressTooltipSafe } from "./AddressTooltipSafe";
import { AddressTooltipBalances } from "./AddressTooltipBalances";

/**
 * The hover card's rows read from /api/balances: the Safe setup when the
 * address is one, then its holdings and their USD value. The card's only rows
 * that wait on the balances, so they alone re-render when those arrive.
 */
export function AddressTooltipOnchain({
  address,
  map,
  multisigs,
  onSettled,
}: {
  address: string;
  /** The shared address map, which places the address on its chains. */
  map: Record<string, AddressInfo>;
  /** The atlas's multisig facts for the address, compared against the chain's Safe setup. */
  multisigs: MultisigFact[];
  /** Called once the balances, or a later map, have loaded, so the tooltip re-measures its placement. */
  onSettled: () => void;
}) {
  const { addresses, prices, ready } = useSharedBalances(true);
  // The map can land after the card opened too (useSharedAddressMap).
  useEffect(() => {
    if (ready) onSettled();
  }, [ready, map, onSettled]);
  const { held, value } = resolveAddressHoldings(address, map, addresses, prices);
  return (
    <>
      {resolveSafes(address, map, addresses, multisigs).map((safe) => (
        <AddressTooltipSafe key={safe.chains.join()} safe={safe} />
      ))}
      <AddressTooltipBalances held={held} value={value} loading={!ready} />
    </>
  );
}
