import type { HeldBalance } from "../lib/addressTooltip";

function Spinner() {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full border-2 border-[var(--border)] animate-spin align-middle"
      style={{ borderTopColor: "var(--tan-3)" }}
      aria-hidden="true"
    />
  );
}

/** The address card's non-zero balances, one row per token (and chain when it holds on several); a spinner until they load. */
export function AddressTooltipBalances({ held, loading }: { held: HeldBalance[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <Spinner />
        <span className="mono text-[10px] text-tan-3">Loading balances…</span>
      </div>
    );
  }
  if (held.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {held.map((h) => (
        <div key={`${h.symbol}-${h.chain ?? ""}`} className="flex justify-between gap-3 mono text-[10px] text-tan-2">
          <span>
            {h.symbol}
            {h.chain ? ` (${h.chain})` : ""}
          </span>
          <span>{h.amount}</span>
        </div>
      ))}
    </div>
  );
}
