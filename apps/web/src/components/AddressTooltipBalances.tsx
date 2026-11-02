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

/** The hover card's "value" and "holds" rows: the holdings' summed USD value
 *  (`≈…+` when some holding has no price), then the non-zero balances, one line
 *  per token (and chain when it holds on several) with its USD value when
 *  priced; a spinner until they load. */
export function AddressTooltipBalances({ held, value, loading }: { held: HeldBalance[]; value: string | null; loading: boolean }) {
  if (!loading && held.length === 0) return null;
  // The USD column only takes room when something in it is priced.
  const priced = held.some((h) => h.usd);
  return (
    <>
      {!loading && value && (
        <TipRow label="value">
          <span className="text-tan" data-value>{value}</span>
        </TipRow>
      )}
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
                <span>
                  <span className="text-tan">{h.amount}</span>
                  {priced && <span className="inline-block min-w-[3.5rem] text-right text-tan-3" data-usd>{h.usd ?? ""}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </TipRow>
    </>
  );
}
