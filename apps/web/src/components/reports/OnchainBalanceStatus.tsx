// The balance Refresh button and the balances-freshness caption shown in the
// On-chain Addresses report's count row.
import type { BalancesResponse } from "@/lib/balances";

export function OnchainBalanceRefresh({
  bal,
  refreshing,
  canRefresh,
  refresh,
}: {
  bal: BalancesResponse | null;
  refreshing: boolean;
  canRefresh: boolean;
  refresh: () => void;
}) {
  return (
    <button
      type="button"
      onClick={refresh}
      disabled={!canRefresh}
      className="mono text-xs px-3 py-1 rounded border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      title={
        canRefresh
          ? "Fetch balances last checked more than an hour ago"
          : bal?.nextRefreshAt
            ? `Next refresh available ${new Date(bal.nextRefreshAt).toLocaleString()}`
            : undefined
      }
    >
      {refreshing ? "Refreshing balances…" : "Refresh balances"}
    </button>
  );
}

// The OLDEST reading, not the newest: the worker refreshes a batch at a time,
// so the newest is always minutes old while a given address can be a day
// behind. This says what's true of every row.
export function OnchainBalanceAge({ bal, error }: { bal: BalancesResponse | null; error: string | null }) {
  return (
    <span className="mono text-[10px] text-tan-3">
      {error
        ? "balances unavailable"
        : bal?.oldestCheckedAt
          ? `balances updated since ${new Date(bal.oldestCheckedAt).toLocaleString()}`
          : "balances not yet fetched"}
    </span>
  );
}
