import type { AddressInfo } from "@/types";
import type { ChainValue } from "../lib/chainstate";
import { Address } from "./Address";
import { resolveAddressName, resolveOwner, hasResolvedName } from "../lib/addressName";
import { resolveAddressHoldings } from "../lib/addressTooltip";
import { useSharedBalances } from "../lib/sharedBalances";
import { AddressTooltipBalances } from "./AddressTooltipBalances";
import { AddressCardBadges, AddressCardChainValues } from "./AddressCardParts";

/** The card's holdings and their USD value. The one part that waits on
 *  /api/balances, so it alone re-renders when they arrive. */
function AddressCardHoldings({ address, info }: { address: string; info: AddressInfo }) {
  const { addresses, prices } = useSharedBalances(true);
  const { held, value } = resolveAddressHoldings(address, { [address]: info }, addresses, prices);
  if (held.length === 0) return null;
  return (
    <dl className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 mono text-[11px]">
      <AddressTooltipBalances held={held} value={value} loading={false} />
    </dl>
  );
}

/** One address in the Onchain panel: its name, owner and aliases, the explorer
 *  link, its proxy and role badges, holdings, and view-function values. */
export function AddressCard({
  address,
  info,
  chainValues,
  byName = false,
}: {
  address: string;
  info: AddressInfo;
  chainValues?: Record<string, ChainValue>;
  /** This section named the address only by its chainlog key, not a 0x literal. */
  byName?: boolean;
}) {
  const owner = resolveOwner(info);
  return (
    <div className="py-3 border-b border-border">
      {/* Only show a bold name when it's an authoritative identifier — otherwise
          it would just repeat the address shown on the explorer line below. */}
      {hasResolvedName(info) && <p className="text-sm font-semibold mb-1 text-tan">{resolveAddressName(address, info)}</p>}
      {owner && <p className="text-xs mb-1 text-tan-2">{owner}</p>}
      {byName && info.chainlogId && (
        <p className="text-[10px] mono mb-1 text-tan-3">referenced by chainlog name · {info.chainlogId}</p>
      )}
      {info.aliases.length > 0 && (
        <p className="text-xs mb-1 text-tan-3">also known as {info.aliases.join(" · ")}</p>
      )}
      {/* The hover carries what the card does not (Safe owners and threshold,
          the explorer link); the inline balance teaser is left off because the
          card lists the holdings and their value right below. */}
      <Address address={address} chain={info.chain} full noBalance className="text-xs mb-2" />
      <AddressCardBadges info={info} />
      <AddressCardHoldings address={address} info={info} />
      {chainValues && <AddressCardChainValues chainValues={chainValues} chain={info.chain} />}
    </div>
  );
}
