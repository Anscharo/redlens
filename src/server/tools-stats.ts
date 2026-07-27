// atlas_describe "stats" section — a trimmed doc-mass map of the corpus,
// computed from the same semantic doc_no tree as /reports/library
// (src/lib/libraryShape.ts). Fills a gap the primitive tools can't: subtree
// mass via atlas_filter walks parentId, which goes flat inside agent
// artifacts, so "which part of the atlas is biggest" was previously not
// answerable server-side.
import type { Indexes } from "./indexes.ts";
import { computeLibrary, GROUPS, type ChunkNode, type GroupSpec } from "../lib/libraryShape.ts";

// Presentation trim: the full trees carry a ref for nearly every doc (the
// reason the 2 MB library.json artifact was folded away) — a tool answer
// needs orientation, not the corpus. Two levels below the groups; a child is
// listed only if it carries ≥ MIN_ROW_PCT of the atlas (and at most
// MAX_CHILDREN per node) — everything else rolls up so the masses still sum.
// Without the pct floor the level-2 long tail alone was ~15 KB of sub-0.2%
// sliver rows.
const MAX_DEPTH = 2;
const MAX_CHILDREN = 12;
const MIN_ROW_PCT = 0.002;

interface ShapeRow {
  doc_no?: string;
  title: string;
  docs: number;
  pct: number; // % of the whole atlas, one decimal
  children?: ShapeRow[];
  child_count?: number; // present when children exist but the depth cap hid them
}

// Exported for direct unit tests of the pct floor (the statsSection fixture is
// too small to cross a 0.2% threshold meaningfully).
export function trim(nodes: ChunkNode[], atlasTotal: number, depth: number): ShapeRow[] {
  return nodes.map((n) => {
    const row: ShapeRow = {
      ...(n.doc_no ? { doc_no: n.doc_no } : {}),
      title: n.title,
      docs: n.docs,
      pct: Math.round((n.docs / atlasTotal) * 1000) / 10,
    };
    if (!n.children?.length) return row;
    if (depth === 0) {
      row.child_count = n.children.length;
      return row;
    }
    const kept = n.children.filter((c) => c.docs / atlasTotal >= MIN_ROW_PCT).slice(0, MAX_CHILDREN);
    const rest = n.children.filter((c) => !kept.includes(c));
    row.children = trim(kept, atlasTotal, depth - 1);
    if (rest.length) {
      const docs = rest.reduce((s, c) => s + c.docs, 0);
      row.children.push({ title: `(+${rest.length} smaller)`, docs, pct: Math.round((docs / atlasTotal) * 1000) / 10 });
    }
    return row;
  });
}

// Memoized per Indexes instance — the updater swaps in a fresh Indexes on
// atlas drift, which naturally invalidates this.
const cache = new WeakMap<Indexes, Record<string, unknown>>();

export function statsSection(ix: Indexes): Record<string, unknown> {
  const hit = cache.get(ix);
  if (hit) return hit;

  const nodes = Object.fromEntries(ix.docMap);
  // ix.glossary is the alias-flattened lookup; alias keys share entry objects,
  // so identity-dedupe recovers the real term-entry count.
  const glossaryTerms = new Set([...ix.glossary.values()].flat()).size;
  // Unlike the frontend (which surfaces a restructured atlas as a visible
  // "Ungrouped" catch-all — accepted-risk locked decision), the tool degrades:
  // it drops missing roots (or a whole complement group whose anchor vanished)
  // so atlas_describe keeps working while the UI surfaces the drift.
  const groups: GroupSpec[] = GROUPS.map((g): GroupSpec =>
    "roots" in g ? { name: g.name, roots: g.roots.filter((r) => r in nodes) } : g,
  ).filter((g) => ("roots" in g ? g.roots.length > 0 : g.complementOf in nodes));
  const lib = computeLibrary({ atlasCommit: ix.meta.atlasCommit ?? "unknown", nodes, glossaryTerms }, groups);
  const total = lib.totals.docs;

  const out: Record<string, unknown> = {
    note:
      "Doc mass over the SEMANTIC doc_no tree (parentId goes flat inside agent artifacts). " +
      "`docs` counts a node plus all its descendants; `pct` is % of the whole atlas. " +
      "`groups` is a curated taxonomy; children under 0.2% of the atlas are rolled into `(+N smaller)` rows so masses still sum.",
    total_docs: total,
    content_bytes: lib.totals.bytes,
    glossary_terms: glossaryTerms,
    needed_research_docs: lib.neededResearch.length,
    scopes: lib.scopeTree.map((s) => ({ doc_no: s.doc_no, title: s.title, docs: s.docs, pct: Math.round((s.docs / total) * 1000) / 10 })),
    groups: trim(lib.chunkTree, total, MAX_DEPTH),
  };
  cache.set(ix, out);
  return out;
}
