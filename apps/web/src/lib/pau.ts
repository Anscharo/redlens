import { fetchJson } from "@/lib/verify";
import { EMPTY_PAU, type PauResponse } from "@/lib/pau";
import { EMPTY_PAU_HISTORY, type PauHistoryResponse } from "@/lib/pauHistory";

export * from "@/lib/pau";
export * from "@/lib/pauView";
export * from "@/lib/pauAddressKeys";
export * from "@/lib/pauHistory";
export * from "@/lib/pauTimeline";
export * from "@/lib/pauOriginText";

let cached: Promise<PauResponse> | null = null;

// Root-relative, like /api/chain-state: on-chain state is shared by every atlas
// version, and a preview reads main's. A failure resolves to no deployments and
// is not cached, so a server whose worker has not run yet is asked again.
export function loadPau(): Promise<PauResponse> {
  if (!cached) {
    cached = fetchJson<PauResponse>("/api/pau", "pau").catch(() => {
      cached = null;
      return EMPTY_PAU;
    });
  }
  return cached;
}

let history: Promise<PauHistoryResponse> | null = null;

/** GET /api/pau/history, cached like loadPau; a failure resolves to no entries and is asked again next time. */
export function loadPauHistory(): Promise<PauHistoryResponse> {
  if (!history) {
    history = fetchJson<PauHistoryResponse>("/api/pau/history", "pau history").catch(() => {
      history = null;
      return EMPTY_PAU_HISTORY;
    });
  }
  return history;
}
