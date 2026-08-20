// On-demand on-chain balances for the addresses report. Balances are dynamic
// (server /api/balances), not a build artifact: the cache loads on mount and
// the Refresh button re-fetches, rate-limited server-side to once an hour. A
// missing server (dev without the API) just leaves balances empty — the report
// still renders.
import { useEffect, useState } from "react";
import { loadBalances, requestBalancesRefresh, type BalancesResponse } from "@/lib/balances";
import { track } from "../../lib/analytics";

export function useBalances(report: string) {
  const [bal, setBal] = useState<BalancesResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadBalances()
      .then((b) => live && setBal(b))
      .catch(() => live && setBal(null));
    return () => {
      live = false;
    };
  }, []);

  const nextRefreshMs = bal?.nextRefreshAt ? Date.parse(bal.nextRefreshAt) : 0;
  // Re-render once the cooldown boundary passes — canRefresh otherwise only
  // updates on the next unrelated render (a tab left open would never re-enable
  // the button on its own).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const delay = nextRefreshMs - Date.now();
    if (delay <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(t);
  }, [nextRefreshMs]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    track("balances_refresh", { report });
    try {
      setBal(await requestBalancesRefresh());
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  return { bal, refreshing, error, canRefresh: !refreshing && now >= nextRefreshMs, refresh };
}
