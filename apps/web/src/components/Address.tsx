import { type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from "react";
import { explorerUrl } from "@/lib/explorer";
import { shortAddr } from "../lib/format";
import { useSharedAddressMap } from "../hooks/useSharedAddressMap";
import { AddressBalance } from "./AddressBalance";
import { AddressTooltip } from "./AddressTooltip";
import { track } from "../lib/analytics";

export interface AddressProps extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
  /** The on-chain address to link and, unless `children` is given, display. */
  address: string;
  /** Chain hint(s) used to resolve the explorer URL when the address isn't in the map. */
  chain?: string | Array<string | undefined>;
  /** Render the full address rather than a shortened `0x1234…cdef`. @default false */
  full?: boolean;
  /** Hide the inline green balance teaser even when one is known. @default false */
  noBalance?: boolean;
  /** Hide the hover-affordance icon (e.g. in prose); the hover card still opens. @default false */
  noHint?: boolean;
  /** Display content; overrides the default (short/full address) — e.g. a <Highlight>. */
  children?: ReactNode;
}

// A tiny "hover for details" affordance on the right of the pill, unless noHint.
// aria-hidden: the hover card itself carries the name.
function HoverHint() {
  return (
    <svg className="rl-addr-hint" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="8" r="1.4" fill="currentColor" />
      <path d="M12 11.5v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The one way to render an on-chain address: a pill with a chain-correct explorer
 * link, an inline green balance teaser, and balance-on-hover. Every address
 * surface renders through this so the anchor, explorer resolution, hover, and
 * analytics stay identical. The naming/owner *rule* lives in src/lib/addressName
 * and the balance figure in src/lib/addressTooltip — this owns only the rendering.
 */
export function Address({
  address,
  chain,
  full = false,
  noBalance = false,
  noHint = false,
  className,
  children,
  onClick,
  ...props
}: AddressProps) {
  // The shared map (lib/addressMap.ts), loaded on demand: it places the address
  // on its chains for the explorer link, the teaser and the hover card.
  const map = useSharedAddressMap();
  const href = explorerUrl(address, { chain, addrMap: map });
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    const trackChain = Array.isArray(chain) ? chain.find(Boolean) : chain;
    track("address_explorer_out", { address, chain: trackChain ?? map[address.toLowerCase()]?.chain });
    onClick?.(e);
  }
  return (
    <AddressTooltip address={address} href={href}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-address={address}
        className={`rl-addr mono ${className ?? ""}`}
        onClick={handleClick}
        {...props}
      >
        <span className="rl-addr-text">{children ?? (full ? address : shortAddr(address))}</span>
        {!noBalance && <AddressBalance address={address} addrMap={map} />}
        {!noHint && <HoverHint />}
      </a>
    </AddressTooltip>
  );
}
