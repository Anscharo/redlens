import { useEffect, useState, type ReactElement } from "react";
import { Tooltip } from "./Tooltip";
import { getAddressMap } from "../lib/addressMap";
import { loadBalancesCached, peekCachedBalances, type BalancesResponse } from "../lib/balances";
import { resolveAddressTooltip } from "../lib/addressTooltip";

// "loading" until the shared fetch settles, then either the response or null
// (a failed fetch resolves to null — same as "no balances known" — rather
// than leaving the tooltip spinning forever).
type BalState = "loading" | BalancesResponse | null;

// Tooltip mounts/unmounts this component fresh on every hover. Fetching is
// deliberately lazy — the first hover of any address on the page triggers the
// one shared /api/balances request (loadBalancesCached), so a session where
// nothing is ever hovered costs nothing; that first hover shows a brief
// loading spinner. Seeding from the already-resolved cache
// (peekCachedBalances) means every hover *after* that first one paints with
// balances already in place instead of spinning again.
function useBalances(): BalState {
  const [state, setState] = useState<BalState>(() => peekCachedBalances() ?? "loading");
  useEffect(() => {
    if (state !== "loading") return;
    let live = true;
    loadBalancesCached()
      .then((res) => { if (live) setState(res); })
      .catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [state]);
  return state;
}

function Spinner() {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full border-2 border-[var(--border)] animate-spin align-middle"
      style={{ borderTopColor: "var(--tan-3)" }}
      aria-hidden="true"
    />
  );
}

function AddressTooltipContent({ address }: { address: string }) {
  const bal = useBalances();
  const loading = bal === "loading";
  const { name, held } = resolveAddressTooltip(address, getAddressMap(), loading ? {} : (bal?.addresses ?? {}));
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
    </div>
  );
}

/** Wraps an on-chain address link with the shared Tooltip, showing the
 *  address's resolved name and any non-zero token balances on hover. */
export function AddressTooltip({ address, children }: { address: string; children: ReactElement }) {
  return <Tooltip content={<AddressTooltipContent address={address} />}>{children}</Tooltip>;
}
