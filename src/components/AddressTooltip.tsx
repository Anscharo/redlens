import type { ReactElement } from "react";
import { Tooltip } from "./Tooltip";
import { useLoaded } from "../hooks/useAtlasData";
import { getAddressMap } from "../lib/addressMap";
import { loadBalancesCached } from "../lib/balances";
import { resolveAddressTooltip } from "../lib/addressTooltip";

function AddressTooltipContent({ address }: { address: string }) {
  // soft: a missing/erroring /api/balances (e.g. dev without a DB) just
  // leaves balances out of the tooltip rather than throwing through it.
  const bal = useLoaded(loadBalancesCached, { soft: true });
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
