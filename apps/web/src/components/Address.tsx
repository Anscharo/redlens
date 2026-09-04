import { type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { AddressInfo } from "@/types";
import { explorerUrl } from "@/lib/explorer";
import { shortAddr } from "../lib/format";
import { getAddressMap } from "../lib/addressMap";
import { addressHeadlineBalance } from "../lib/addressTooltip";
import { useSharedBalances } from "../lib/sharedBalances";
import { AddressTooltip } from "./AddressTooltip";
import { track } from "../lib/analytics";

export interface AddressProps extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
  /** The on-chain address to link and, unless `children` is given, display. */
  address: string;
  /** Chain hint(s) used to resolve the explorer URL when the address isn't in the map. */
  chain?: string | Array<string | undefined>;
  /** Address map for explorer resolution. Defaults to the shared singleton (getAddressMap). */
  addrMap?: Record<string, AddressInfo>;
  /** Render the full address rather than a shortened `0x1234…cdef`. @default false */
  full?: boolean;
  /** Suppress the balance-on-hover tooltip (and the hover-affordance icon). @default false */
  noTooltip?: boolean;
  /** Hide the inline green balance teaser even when one is known. @default false */
  noBalance?: boolean;
  /** Hide the hover-affordance icon while keeping the tooltip (e.g. in prose). @default false */
  noHint?: boolean;
  /** Display content; overrides the default (short/full address) — e.g. a <Highlight>. */
  children?: ReactNode;
}

// A tiny "hover for details" affordance shown on the right of the pill whenever
// the balance tooltip is active. aria-hidden — the anchor's title carries the name.
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
  addrMap,
  full = false,
  noTooltip = false,
  noBalance = false,
  noHint = false,
  className,
  children,
  onClick,
  ...props
}: AddressProps) {
  const map = addrMap ?? getAddressMap();
  const { addresses } = useSharedBalances(!noBalance);
  const href = explorerUrl(address, { chain, addrMap: map });
  const balance = noBalance ? null : addressHeadlineBalance(address, map, addresses);
  const showHint = !noTooltip && !noHint;
  // With no balance and no hint, the pill holds only the address text. Render it
  // as `display: inline` (rl-addr-plain) so it selects and copies exactly like
  // the surrounding prose — an inline-flex pill breaks text selection and can
  // drag adjacent content into the copy. See index.css.
  const plain = !balance && !showHint;
  const link = (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      className={`rl-addr mono ${plain ? "rl-addr-plain" : ""} ${className ?? ""}`}
      onClick={(e) => {
        const trackChain = Array.isArray(chain) ? chain.find(Boolean) : chain;
        track("address_explorer_out", { address, chain: trackChain ?? map[address.toLowerCase()]?.chain });
        onClick?.(e);
      }}
      {...props}
    >
      <span className="rl-addr-text">{children ?? (full ? address : shortAddr(address))}</span>
      {balance && (
        <span className="rl-addr-bal" style={{ color: "var(--terminal-green)" }}>
          {balance}
        </span>
      )}
      {showHint && <HoverHint />}
    </a>
  );
  return noTooltip ? link : (
    <AddressTooltip address={address} href={href}>
      {link}
    </AddressTooltip>
  );
}
