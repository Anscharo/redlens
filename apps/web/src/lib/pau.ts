import { fetchJson } from "@/lib/verify";
import { EMPTY_PAU, type PauResponse } from "@/lib/pau";

export * from "@/lib/pau";
export * from "@/lib/pauView";

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
