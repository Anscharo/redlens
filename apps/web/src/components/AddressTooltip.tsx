import { useEffect, useReducer, type ReactElement } from "react";
import { useLocation } from "wouter";
import { ROUTES } from "@/lib/routes";
import { Tooltip } from "./Tooltip";
import { AddressTooltipMultisig } from "./AddressTooltipMultisig";
import { AddressTooltipDocs } from "./AddressTooltipDocs";
import { AddressTooltipBalances } from "./AddressTooltipBalances";
import { getAddressMap } from "../lib/addressMap";
import { useSharedBalances } from "../lib/sharedBalances";
import { resolveAddressTooltip } from "../lib/addressTooltip";
import { useAddressGraphFacts } from "../hooks/useAddressGraphFacts";
import { shortLink } from "../lib/format";

function AddressTooltipContent({
  address,
  href,
  onSettled,
}: {
  address: string;
  href?: string;
  onSettled: () => void;
}) {
  const { addresses, ready } = useSharedBalances(true);
  const facts = useAddressGraphFacts(address);
  const [location] = useLocation();
  const loading = !ready;
  // Tooltip only re-measures/repositions when its `content` prop's element
  // *reference* changes (see Tooltip.tsx's placement effect), and that
  // reference is created once by AddressTooltip below — so on its own, this
  // component's balances arriving asynchronously wouldn't reposition an
  // already-open tooltip. onSettled tells AddressTooltip to re-render once
  // loading finishes, producing a fresh reference, without re-triggering the
  // fetch itself (only the very first hover of a session hits this — after
  // that the shared cache is warm and loading starts out false). The graph
  // facts (multisig setup, mentioning docs) land the same way.
  useEffect(() => {
    if (!loading) onSettled();
  }, [loading, facts, onSettled]);
  const { name, named, held } = resolveAddressTooltip(address, getAddressMap(), addresses);
  // In the reader the address already sits in its document; elsewhere the
  // mentioning docs are the way back to the atlas.
  const inAtlas = location.startsWith(ROUTES.ATLAS);
  return (
    <div className="min-w-[8rem] max-w-[18rem]">
      {named ? (
        <div className="font-medium text-tan truncate">{name}</div>
      ) : (
        <div className="mono text-tan break-all" data-full-address>{address}</div>
      )}
      {facts?.multisigs.map((ms) => <AddressTooltipMultisig key={ms.name} ms={ms} />)}
      <AddressTooltipBalances held={held} loading={loading} />
      {!inAtlas && facts && <AddressTooltipDocs docs={facts.docs} />}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="link-accent mono text-[10px] block mt-1.5 truncate"
        >
          {shortLink(href)}
        </a>
      )}
    </div>
  );
}

/** Wraps an on-chain address link with the shared Tooltip, showing the
 *  address's resolved name (or the full address when it has none), the
 *  multisig setup when it is one, any non-zero token balances, the atlas
 *  documents naming it (outside the reader) and a shortened explorer link. */
export function AddressTooltip({
  address,
  href,
  children,
}: {
  address: string;
  href?: string;
  children: ReactElement;
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  return (
    <Tooltip content={<AddressTooltipContent address={address} href={href} onSettled={bump} />}>
      {children}
    </Tooltip>
  );
}
