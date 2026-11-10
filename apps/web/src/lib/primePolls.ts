// The Prime Snapshot polls (GET /api/prime-polls), by the atlas PRs they link,
// for the on-chain steps (src/lib/pauSpellStep.ts). Resolves to null when they
// cannot be read, so a step that needs them says nothing rather than "names no
// spell", and is asked again next time.
import { pollsByPr, type PrimePoll } from "@/lib/primePolls";

let cached: Promise<Map<number, PrimePoll[]> | null> | null = null;

export function loadPrimePolls(): Promise<Map<number, PrimePoll[]> | null> {
  cached ??= fetch("/api/prime-polls")
    .then((r) => (r.ok ? (r.json() as Promise<{ polls?: PrimePoll[] }>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => pollsByPr(d.polls ?? []))
    .catch(() => {
      cached = null;
      return null;
    });
  return cached;
}
