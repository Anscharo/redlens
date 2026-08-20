import { liveAtlasBase } from "./atlasBase";
import { loadAtlas } from "./docs";
import { loadGlossary } from "./glossary";
import { computeCrossView } from "@/lib/crossviewShape";
import { toCSV } from "@/lib/csv";

// ChunkNode/CrossViewData live in crossviewShape.ts (DOM-free, server-importable);
// re-exported here so frontend imports keep one entry point.
export type { ChunkNode, CrossViewData } from "@/lib/crossviewShape";
import type { ChunkNode, CrossViewData } from "@/lib/crossviewShape";

export interface CrossViewSegment {
  id: string;
  doc_no: string;
  title: string;
  docs: number;
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

export function crossviewChunksToCSV(tree: ChunkNode[], atlasTotal: number): string {
  const rows = flattenChunkTree(tree, atlasTotal);
  return toCSV(
    ["path", "doc_no", "title", "depth", "docs", "pct_of_atlas"],
    rows.map((r) => [r.path, r.doc_no, r.title, r.depth, r.docs, r.pctOfAtlas]),
  );
}

// Derived in place from the docs bundle + glossary — there is no crossview.json
// artifact (it was a pure 2 MB projection of docs.json; see crossviewShape.ts).
// loadAtlas/loadGlossary handle per-base caching and stale-sha reloads, and
// because the compute lives in the JS bundle there is no artifact/bundle
// version skew to guard against. Keyed by data-source base, so the crossview
// works over previews too.
const cache = new Map<string, Promise<CrossViewData>>();

export function loadCrossView(base: string = liveAtlasBase()): Promise<CrossViewData> {
  let cached = cache.get(base);
  if (!cached) {
    cached = Promise.all([loadAtlas(base), loadGlossary(base)])
      .then(([bundle, glossary]) =>
        computeCrossView({
          atlasCommit: bundle.atlasCommit ?? "unknown",
          nodes: bundle.docs,
          glossaryTerms: Object.values(glossary).flat().length,
        }),
      )
      .catch((err) => {
        cache.delete(base); // don't cache the rejection — retry on next call
        throw err;
      });
    cache.set(base, cached);
  }
  return cached;
}
