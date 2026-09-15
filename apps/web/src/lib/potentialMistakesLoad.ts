// Browser-side loader for potential-mistakes.json. Split out of
// potentialMistakesIndex.ts so that module stays pure and testable — mirrors
// processesLoad.ts's split from processesIndex.ts.
//
// Note the deliberate use of import.meta.env.BASE_URL rather than the
// atlas-versioned data base: this artifact is curated and hand-run, NOT built
// per atlas sha, so it must not be fetched from /api/atlas/<sha>/.
import { fetchJson } from "@/lib/verify";
import type { MistakesFile } from "@/lib/potentialMistakesIndex";

let cache: Promise<MistakesFile> | null = null;

export function loadPotentialMistakes(): Promise<MistakesFile> {
  if (!cache) {
    cache = fetchJson<MistakesFile>(
      `${import.meta.env.BASE_URL}potential-mistakes.json`,
      "potential-mistakes.json",
    ).catch((err) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}
