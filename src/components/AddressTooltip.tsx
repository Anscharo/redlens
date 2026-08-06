import { useEffect, useState, type ReactElement } from "react";
import { Tooltip } from "./Tooltip";
import { getAddressMap } from "../lib/addressMap";
import { loadBalancesCached, peekCachedBalances, type BalancesResponse } from "../lib/balances";
import { resolveAddressTooltip } from "../lib/addressTooltip";

// Tooltip mounts/unmounts this component fresh on every hover. Fetching is
// deliberately lazy — the first hover of any address on the page triggers the
// one shared /api/balances request (loadBalancesCached), so a session where
// nothing is ever hovered costs nothing; that first hover can show the name
// only for a moment before balances arrive. Seeding from the already-resolved
// cache (peekCachedBalances) means every hover *after* that first one paints
// with balances already in place instead of flashing empty-then-filled.
function useBalances(): BalancesResponse | null {
  const [bal, setBal] = useState(peekCachedBalances);
  useEffect(() => {
    if (bal) return;
    let live = true;
    loadBalancesCached()
      .then((res) => { if (live) setBal(res); })
      .catch(() => {});
    return () => { live = false; };
  }, [bal]);
  return bal;
}

function AddressTooltipContent({ address }: { address: string }) {
  const bal = useBalances();
  const { name, held } = resolveAddressTooltip(address, getAddressMap(), bal?.addresses ?? {});
  return (
    <div className="min-w-[8rem] max-w-[16rem]">
      <div className="font-medium text-tan truncate">{name}</div>
      {held.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {held.map((h) => (
            <div key={h.symbol} className="flex justify-between gap-3 mono text-[10px] text-tan-2">
              <span>{h.symbol}</span>
              <span>{h.amount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Wraps an on-chain address link with the shared Tooltip, showing the
 *  address's resolved name and any non-zero token balances on hover. */
export function AddressTooltip({ address, children }: { address: string; children: ReactElement }) {
  return <Tooltip content={<AddressTooltipContent address={address} />}>{children}</Tooltip>;
}
