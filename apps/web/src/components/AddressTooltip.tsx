import { useEffect, useReducer, type ReactElement } from "react";
import { Tooltip } from "./Tooltip";
import { getAddressMap } from "../lib/addressMap";
import { useSharedBalances } from "../lib/sharedBalances";
import { resolveAddressTooltip } from "../lib/addressTooltip";
import { shortLink } from "../lib/format";

function Spinner() {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full border-2 border-[var(--border)] animate-spin align-middle"
      style={{ borderTopColor: "var(--tan-3)" }}
      aria-hidden="true"
    />
  );
}

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
  const loading = !ready;
  // Tooltip only re-measures/repositions when its `content` prop's element
  // *reference* changes (see Tooltip.tsx's placement effect), and that
  // reference is created once by AddressTooltip below — so on its own, this
  // component's balances arriving asynchronously wouldn't reposition an
  // already-open tooltip. onSettled tells AddressTooltip to re-render once
  // loading finishes, producing a fresh reference, without re-triggering the
  // fetch itself (only the very first hover of a session hits this — after
  // that the shared cache is warm and loading starts out false).
  useEffect(() => {
    if (!loading) onSettled();
  }, [loading, onSettled]);
  const { name, held } = resolveAddressTooltip(address, getAddressMap(), addresses);
  return (
    <div className="min-w-[8rem] max-w-[16rem]">
      <div className="font-medium text-tan truncate">{name}</div>
      {loading ? (
        <div className="mt-1 flex items-center gap-1.5">
          <Spinner />
          <span className="mono text-[10px] text-tan-3">Loading balances…</span>
        </div>
      ) : (
        held.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {held.map((h) => (
              <div
                key={`${h.symbol}-${h.chain ?? ""}`}
                className="flex justify-between gap-3 mono text-[10px] text-tan-2"
              >
                <span>
                  {h.symbol}
                  {h.chain ? ` (${h.chain})` : ""}
                </span>
                <span>{h.amount}</span>
              </div>
            ))}
          </div>
        )
      )}
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
 *  address's resolved name, any non-zero token balances, and a shortened
 *  link to the explorer page on hover. */
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
