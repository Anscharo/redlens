import { useCallback, useEffect, useState } from "react";
import { apiUrl, type UsageWindow, type CommonsPool } from "./api";

// Fetches the meter state from /api/usage: the caller's private token `window`
// plus the shared `global` commons pool (same for all users; may be absent when
// the feature is off). Refetched when the panel opens and after each completed
// turn; the window can also be primed from a 429 body.
export function useUsage(enabled: boolean) {
  const [usage, setUsage] = useState<UsageWindow | null>(null);
  const [commons, setCommons] = useState<CommonsPool | null>(null);
  // The model's context window (tokens), to meter the context pie against —
  // a different denominator than `usage` (the rate-limit window). Null when
  // unknown; a server-sent 0 is also treated as unknown by ratioPct().
  const [contextWindow, setContextWindow] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("usage"), { credentials: "same-origin" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        window: UsageWindow;
        global?: CommonsPool;
        contextWindowTokens?: number;
      };
      setUsage(body.window);
      setCommons(body.global ?? null);
      setContextWindow(body.contextWindowTokens ?? null);
    } catch {
      // best-effort; the meter just stays on its last value
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { usage, commons, contextWindow, refresh, setUsage };
}
