import { fetchJson } from "@/lib/verify";
import { EMPTY_SETTLEMENTS, type SettlementsBundle } from "@/lib/settlements";

export * from "@/lib/settlements";

// Browser loader for the baked settlements.json artifact. Server chat/MCP
// reads the same file from disk (src/server/settlements.ts).

let cached: Promise<SettlementsBundle> | null = null;

export function loadSettlements(): Promise<SettlementsBundle> {
  if (!cached) {
    cached = fetchJson<SettlementsBundle>(
      `${import.meta.env.BASE_URL}settlements.json`,
      "settlements.json",
    ).catch(() => {
      cached = null;
      return EMPTY_SETTLEMENTS;
    });
  }
  return cached;
}

/** Test-only: drop the memoised fetch so the next loadSettlements() hits the network again. */
export function resetSettlementsCache(): void {
  cached = null;
}
