import { useEffect, useReducer, type ReactElement } from "react";
import { Tooltip } from "./Tooltip";
import { AddressTooltipOnchain } from "./AddressTooltipOnchain";
import { AddressTooltipDocs } from "./AddressTooltipDocs";
import { TipRow } from "./AddressTooltipRow";
import { useSharedAddressMap } from "../hooks/useSharedAddressMap";
import { resolveAddressLabel } from "../lib/addressTooltip";
import { useAddressGraphFacts } from "../hooks/useAddressGraphFacts";
import { shortLink } from "../lib/format";

// Tooltip only re-measures its placement when its `content` element reference
// changes (Tooltip.tsx's placement effect), and AddressTooltip creates that
// element once. So each row whose data arrives after the card opened calls
// `onSettled`, which re-renders AddressTooltip into a fresh reference without
// refetching anything. Only the first hover of a session waits; after that the
// shared caches are warm.
function AddressTooltipContent({ address, href, onSettled }: { address: string; href?: string; onSettled: () => void }) {
  // The graph facts and the address map feed several rows, so they load here,
  // the lowest point those rows share.
  const facts = useAddressGraphFacts(address);
  const map = useSharedAddressMap();
  useEffect(() => {
    if (facts) onSettled();
  }, [facts, onSettled]);
  const { name, named, owner } = resolveAddressLabel(address, map);
  return (
    <div className="min-w-[10rem] max-w-[20rem]">
      <div className={named ? "font-medium text-tan truncate" : "mono text-tan break-all"} data-full-address={named ? undefined : ""}>
        {named ? name : address}
      </div>
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 mono text-[10px]">
        {named && <TipRow label="address"><span className="break-all">{address}</span></TipRow>}
        {owner && <TipRow label="owner">{owner}</TipRow>}
        <AddressTooltipOnchain address={address} map={map} multisigs={facts?.multisigs ?? []} onSettled={onSettled} />
        {facts && <AddressTooltipDocs docs={facts.docs} />}
        {href && (
          <TipRow label="explorer">
            <a href={href} target="_blank" rel="noopener noreferrer" className="link-accent block truncate">{shortLink(href)}</a>
          </TipRow>
        )}
      </dl>
    </div>
  );
}

/** Wraps an on-chain address link with the shared Tooltip, showing the
 *  address's resolved name (or the full address when it has none), its live
 *  Safe owners and threshold when it is one, any non-zero token balances with
 *  their USD value, the atlas documents naming it (outside the reader) and a
 *  shortened explorer link. */
export function AddressTooltip({ address, href, children }: { address: string; href?: string; children: ReactElement }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  return (
    <Tooltip content={<AddressTooltipContent address={address} href={href} onSettled={bump} />}>
      {children}
    </Tooltip>
  );
}
