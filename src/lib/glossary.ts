import { fetchJson } from "./verify";
import { liveAtlasBase, handledStale } from "./atlasBase";
import type { Glossary } from "./glossaryLookup";

// Types + buildLookup live in glossaryLookup.ts (pure, server-importable);
// re-exported here so existing frontend imports keep working.
export { buildLookup, type Glossary, type GlossaryEntry } from "./glossaryLookup";

// Keyed by data-source base (default = live atlas; a preview passes its bundle base).
const cache = new Map<string, Promise<Glossary>>();

export function loadGlossary(base: string = liveAtlasBase()): Promise<Glossary> {
  let cached = cache.get(base);
  if (!cached) {
    const p: Promise<Glossary> = fetchJson<{ atlasCommit?: string | null; terms: Glossary }>(
      `${base}glossary.json`,
      "glossary.json",
    )
      .then((f) => f.terms)
      .catch((err) => {
        cache.delete(base); // don't cache the rejection — retry on next call
        // Stale pinned sha (404 on /api/atlas/<sha>/) → force-forward reload
        // instead of surfacing an error, matching addresses.ts/graph.ts.
        if (handledStale(err)) return new Promise<Glossary>(() => {});
        throw err;
      });
    cached = p;
    cache.set(base, cached);
  }
  return cached;
}
