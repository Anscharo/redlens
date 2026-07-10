import { fetchJson } from "./verify";
import { liveAtlasBase, handledStale } from "./atlasBase";

export interface GlossaryEntry {
  term: string;
  content: string;
  nodeId: string;
  docNo: string;
  sourceDocNo: string;
  sourceContext: string | null;
}

export type Glossary = Record<string, GlossaryEntry[]>;

type GlossaryLookup = Record<string, GlossaryEntry[]>;

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

export function buildLookup(glossary: Glossary): GlossaryLookup {
  const lookup: GlossaryLookup = {};
  const add = (key: string, entries: GlossaryEntry[]) => {
    const k = key.toLowerCase();
    if (lookup[k]) return;
    lookup[k] = entries;
  };

  for (const entries of Object.values(glossary)) {
    for (const e of entries) {
      add(e.term, entries);
      // Parenthetical alias: "Accessibility Scope (ACC)" → add "Accessibility
      // Scope" and "ACC" as separate keys pointing to the same entries.
      const m = e.term.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (m) {
        add(m[1].trim(), entries);
        add(m[2].trim(), entries);
      }
    }
  }
  return lookup;
}
