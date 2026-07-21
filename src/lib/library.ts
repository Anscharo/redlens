import { fetchJson } from "./verify";
import { liveAtlasBase, handledStale } from "./atlasBase";

export interface LibraryNodeRef {
  id: string;
  doc_no: string;
  title: string;
  docs: number;
  bytes: number;
}

export interface LibraryGroup {
  name: string;
  roots: string[];
  docs: number;
  bytes: number;
}

export interface LibraryTocSection {
  id: string;
  doc_no: string;
  title: string;
  docs: number;
}

export interface LibraryTocArticle extends LibraryTocSection {
  sections: LibraryTocSection[];
}

export interface LibraryTocScope extends LibraryTocSection {
  articles: LibraryTocArticle[];
}

export interface LibraryData {
  atlasCommit: string;
  totals: { docs: number; bytes: number; glossaryTerms: number };
  docTypes: [string, number][];
  scopes: LibraryNodeRef[];
  groups: LibraryGroup[];
  primes: LibraryNodeRef[];
  executors: LibraryNodeRef[];
  neededResearch: { id: string; doc_no: string; title: string }[];
  toc: LibraryTocScope[];
}

// library.json is built by scripts/required/build-library.mjs and served from
// the sha-keyed atlas base (same lifecycle as glossary.json): rebuilt by the
// runtime updater on atlas drift and published into the per-sha bundle.
// Keyed by data-source base like glossary.ts.
const cache = new Map<string, Promise<LibraryData>>();

export function loadLibrary(base: string = liveAtlasBase()): Promise<LibraryData> {
  let cached = cache.get(base);
  if (!cached) {
    cached = fetchJson<LibraryData>(`${base}library.json`, "library.json").catch((err) => {
      cache.delete(base); // don't cache the rejection — retry on next call
      // Stale pinned sha (404 on /api/atlas/<sha>/) → force-forward reload
      // instead of surfacing an error, matching glossary.ts/addresses.ts.
      if (handledStale(err)) return new Promise<LibraryData>(() => {});
      throw err;
    });
    cache.set(base, cached);
  }
  return cached;
}
