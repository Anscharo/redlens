import type { HeldBalance } from "../lib/addressTooltip";
import { TipRow } from "./AddressTooltipRow";

function Spinner() {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full border-2 border-[var(--border)] animate-spin align-middle"
      style={{ borderTopColor: "var(--tan-3)" }}
      aria-hidden="true"
    />
  );
}

/** The hover card's "holds" row: non-zero balances, one line per token (and chain when it holds on several); a spinner until they load. */
export function AddressTooltipBalances({ held, loading }: { held: HeldBalance[]; loading: boolean }) {
  if (!loading && held.length === 0) return null;
  return (
    <TipRow label="holds">
      {loading ? (
        <span className="flex items-center gap-1.5 text-tan-3">
          <Spinner />
          Loading balances…
        </span>
      ) : (
        <ul>
          {held.map((h) => (
            <li key={`${h.symbol}-${h.chain ?? ""}`} className="flex justify-between gap-3">
              <span>
                {h.symbol}
                {h.chain ? ` (${h.chain})` : ""}
              </span>
              <span className="text-tan">{h.amount}</span>
            </li>
          ))}
        </ul>
      )}
    </TipRow>
  );
}
