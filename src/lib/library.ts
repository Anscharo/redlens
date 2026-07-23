import { fetchJson } from "./verify";
import { liveAtlasBase, handledStale } from "./atlasBase";
import { toCSV } from "./csv";

export interface LibrarySegment {
  id: string;
  doc_no: string;
  title: string;
  docs: number;
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
  /** The seven scopes as recursive chunk nodes (editorial axis). */
  scopeTree: ChunkNode[];
  neededResearch: { id: string; doc_no: string; title: string }[];
  toc: LibraryTocScope[];
  /** Hierarchical chunk taxonomy — groups at the top, semantic subtree below. */
  chunkTree: ChunkNode[];
}

export interface ChunkRow {
  path: string; // "Agent artifacts › List Of Prime Agent Artifacts › Spark"
  doc_no: string;
  title: string;
  depth: number;
  docs: number;
  pctOfAtlas: number; // 0–100, one decimal
}

/** Depth-first flatten of the chunk tree into stable, CSV-ready rows. */
export function flattenChunkTree(tree: ChunkNode[], atlasTotal: number): ChunkRow[] {
  const rows: ChunkRow[] = [];
  const walk = (node: ChunkNode, ancestors: string[], depth: number) => {
    const path = [...ancestors, node.title].join(" › ");
    rows.push({
      path,
      doc_no: node.doc_no ?? "",
      title: node.title,
      depth,
      docs: node.docs,
      pctOfAtlas: Math.round((node.docs / atlasTotal) * 1000) / 10,
    });
    for (const c of node.children ?? []) walk(c, [...ancestors, node.title], depth + 1);
  };
  for (const g of tree) walk(g, [], 0);
  return rows;
}

export function libraryChunksToCSV(tree: ChunkNode[], atlasTotal: number): string {
  const rows = flattenChunkTree(tree, atlasTotal);
  return toCSV(
    ["path", "doc_no", "title", "depth", "docs", "pct_of_atlas"],
    rows.map((r) => [r.path, r.doc_no, r.title, r.depth, r.docs, r.pctOfAtlas]),
  );
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
const SCHEMA_V = 4;
const cache = new Map<string, Promise<LibraryData>>();

export function loadLibrary(base: string = liveAtlasBase()): Promise<LibraryData> {
  let cached = cache.get(base);
  if (!cached) {
    cached = fetchJson<LibraryData>(`${base}library.json?v=${SCHEMA_V}`, "library.json")
      .then((d) => {
        // Version-skew guard: the JS bundle and the atlas artifact update
        // independently (live updater, long-open tabs across deploys). On a
        // shape mismatch, self-heal with ONE reload — fresh HTML brings JS and
        // artifact back in sync. The sessionStorage latch prevents a reload
        // loop if the mismatch persists (e.g. a server genuinely serving an
        // old artifact); the second attempt surfaces the readable error.
        if (!Array.isArray(d.chunkTree) || !Array.isArray(d.scopeTree) || !Array.isArray(d.toc)) {
          const LATCH = "library-schema-reloaded";
          if (typeof window !== "undefined" && !sessionStorage.getItem(LATCH)) {
            sessionStorage.setItem(LATCH, "1");
            window.location.reload();
            return new Promise<LibraryData>(() => {}); // reloading — never resolves
          }
          throw new Error("library.json does not match this app version — a redeploy may be in progress; try again shortly");
        }
        if (typeof window !== "undefined") sessionStorage.removeItem("library-schema-reloaded");
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
