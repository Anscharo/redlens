import { useCallback, useEffect, useState } from "react";
import { apiUrl, type UsageWindow } from "./api";

// Fetches the caller's token window from /api/usage. Refetched when the panel
// opens and after each completed turn; can also be primed from a 429 body.
export function useUsage(enabled: boolean) {
  const [usage, setUsage] = useState<UsageWindow | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("usage"), { credentials: "same-origin" });
      if (!res.ok) return;
      const body = (await res.json()) as { window: UsageWindow };
      setUsage(body.window);
    } catch {
      // best-effort; the meter just stays on its last value
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { usage, refresh, setUsage };
}
