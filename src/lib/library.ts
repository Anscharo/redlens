import { fetchJson } from "./verify";
import { liveAtlasBase, handledStale } from "./atlasBase";

export interface LibrarySegment {
  id: string;
  doc_no: string;
  title: string;
  docs: number;
}

export interface LibraryNodeRef {
  id: string;
  doc_no: string;
  title: string;
  docs: number;
  bytes: number;
  /** Direct-child weights, largest first — drives the stacked weight bars. */
  segments: LibrarySegment[];
}

export interface ChunkNode {
  /** Present when the chunk maps to a single atlas node (drives the reader link). */
  id?: string;
  doc_no?: string;
  title: string;
  docs: number;
  /** Sub-chunks, largest first. Absent on leaves (below the build threshold). */
  children?: ChunkNode[];
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
  neededResearch: { id: string; doc_no: string; title: string }[];
  toc: LibraryTocScope[];
  /** Hierarchical chunk taxonomy — groups at the top, semantic subtree below. */
  chunkTree: ChunkNode[];
}

// library.json is built by scripts/required/build-library.mjs and served from
// the sha-keyed atlas base (same lifecycle as glossary.json): rebuilt by the
// runtime updater on atlas drift and published into the per-sha bundle.
// Keyed by data-source base like glossary.ts.
//
// SCHEMA_V busts the browser's immutable cache (per-sha URLs ship
// cache-control: immutable, max-age=1y) when the artifact's SHAPE changes
// under an unchanged atlas sha — e.g. the flat→chunkTree migration stranded
// returning clients on year-cached old bytes. Bump it in the same commit as
// any breaking change to LibraryData; the shape guard below is the backstop
// for a forgotten bump.
const SCHEMA_V = 2;
const cache = new Map<string, Promise<LibraryData>>();

export function loadLibrary(base: string = liveAtlasBase()): Promise<LibraryData> {
  let cached = cache.get(base);
  if (!cached) {
    cached = fetchJson<LibraryData>(`${base}library.json?v=${SCHEMA_V}`, "library.json")
      .then((d) => {
        // Version-skew guard: the JS bundle and the atlas artifact update
        // independently (live updater, long-open tabs across deploys). An
        // artifact missing fields this UI needs must surface as a readable
        // load error, not a render crash inside the page.
        if (!Array.isArray(d.chunkTree) || !Array.isArray(d.scopes) || !Array.isArray(d.toc)) {
          throw new Error("library.json is from an older build — reload the page to pick up the current version");
        }
        return d;
      })
      .catch((err) => {
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
