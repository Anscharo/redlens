// What governance did about each disagreement and who can change it, worked
// out on the server (GET /api/pau/steps, src/server/pau/value-steps.ts), by
// `valueCheckId`. Resolves to null when the steps cannot be read, and is asked
// again next time; a disagreement without a step is shown as it is.
import type { ValueStep } from "@/lib/pauPending";

let cached: Promise<Map<string, ValueStep> | null> | null = null;

export function loadPauSteps(): Promise<Map<string, ValueStep> | null> {
  cached ??= fetch(`${import.meta.env.BASE_URL}api/pau/steps`)
    .then((r) => (r.ok ? (r.json() as Promise<{ steps?: ValueStep[] }>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => new Map((d.steps ?? []).map((s) => [s.id, s])))
    .catch(() => {
      cached = null;
      return null;
    });
  return cached;
}
