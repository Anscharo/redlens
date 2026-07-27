import type { AtlasNode } from "../types";

// Pure compute for the Atlas Library shape (LibraryData) — an O(n) projection
// of the docs bundle, derived client-side in loadLibrary (src/lib/library.ts).
// This replaced the public/library.json build artifact: the artifact was 2 MB
// (both trees carry refs for essentially the whole corpus) while its only
// input beyond docs.json was a glossary term count, so shipping it alongside
// docs.json cost more than computing it in place. Follows the Stale Dates
// pattern: recompute on visit, nothing to version-skew.

// Curated taxonomy seed — group → article/scope root UUIDs (see docs/atlas-map.md §2).
// This is the embryo of the P1 chunk registry. Exported for the server's
// atlas_describe stats section (src/server/tools-stats.ts).
//
// Two shapes: a plain `roots` list (editorial — hand-picked article UUIDs, or
// a whole-scope root for A.0/A.3–A.6 which aren't partitioned article-by-article),
// or a `complementOf`/`except` pair — "every direct semantic child of this
// UUID except these" — resolved against the semChildren map built in
// computeLibrary. "Support processes" uses the complement form (children(A.2)
// − A.2.2) so a newly-added A.2.x article self-heals into the group instead of
// silently vanishing from the chunkTree.
export type GroupSpec = { name: string; roots: string[] } | { name: string; complementOf: string; except: string[] };

export const GROUPS: GroupSpec[] = [
  { name: "Constitutional core", roots: ["8650a584-01f8-45d6-882b-c14eab9879c4" /* A.0 */, "86a93dab-2f12-4c3f-9285-bcc4520c851b" /* A.1.1 */, "fbd55373-32cc-49a9-a74d-60cfacf6a379" /* A.1.2 */, "f51e410a-f51d-463f-82f2-2bcf289dbbb7" /* A.1.3 */, "08176561-7acf-47e0-bb54-41771d54b15f" /* A.1.4 */, "d607a8e3-17e1-4aab-9e74-11af39767cc7" /* A.1.14 */, "ba97b4dd-c4e0-4d12-8769-423f6ecdc6bf" /* A.1.15 */] },
  { name: "Actor rulebooks", roots: ["df4f9bfd-e743-44b5-9c62-9c5f10b15340" /* A.1.5 */, "75f0063c-ad70-49e4-b356-9b76097ced7b" /* A.1.6 */, "1ce24b08-84ff-4524-9710-49bba429c6ef" /* A.1.7 */, "d6b43720-243e-4610-8c03-cd515ace6247" /* A.1.8 */] },
  { name: "Governance processes", roots: ["1d940c6d-02ce-4c17-8057-cef13c1cc7ad" /* A.1.9 */, "de0cc370-de9c-48a4-b10e-91782df7abcd" /* A.1.10 */, "83edd4e1-692e-4566-a415-b8f272c33c5e" /* A.1.11 */, "7f2ba62c-9b3b-4df6-aa16-189a749cffa3" /* A.1.12 */, "75e8fd51-a540-4c3a-aaa9-1a38502f89b2" /* A.1.13 */] },
  { name: "Primitive spec library", roots: ["fcde2604-a138-4c1b-9d9a-14895835c907" /* A.2.2 */] },
  // children(A.2) − A.2.2 — see the GroupSpec doc comment above.
  { name: "Support processes", complementOf: "1ce14bd8-c7b3-4f74-a152-292a8d8ebed0" /* A.2 */, except: ["fcde2604-a138-4c1b-9d9a-14895835c907" /* A.2.2 */] },
  { name: "Financial machinery", roots: ["d56538fc-2220-491a-a4d2-7ad6e461d707" /* A.3 */] },
  { name: "Protocol machinery", roots: ["5c20d9af-0bb9-4ca1-a944-1e2cb6f8bb6b" /* A.4 */] },
  { name: "Accessibility", roots: ["99b1b47d-3c7a-4859-ac00-8c0849f9070e" /* A.5 */] },
  { name: "Agent artifacts", roots: ["4a08ca6c-e652-49e4-9b79-4831b20e600a" /* A.6 */] },
];

// Types live here (not in library.ts) so the server can import this module
// without pulling in the frontend loader stack (atlasBase/window).
export interface ChunkNode {
  /** Present when the chunk maps to a single atlas node (drives the reader link). */
  id?: string;
  doc_no?: string;
  title: string;
  docs: number;
  /** Sub-chunks, largest first. Absent on leaves (below the recursion threshold). */
  children?: ChunkNode[];
}

export interface LibraryData {
  atlasCommit: string;
  totals: { docs: number; bytes: number; glossaryTerms: number };
  docTypes: [string, number][];
  /** The seven scopes as recursive chunk nodes (editorial axis). */
  scopeTree: ChunkNode[];
  neededResearch: { id: string; doc_no: string; title: string }[];
  /** Hierarchical chunk taxonomy — groups at the top, semantic subtree below. */
  chunkTree: ChunkNode[];
}

export interface LibraryInputs {
  atlasCommit: string;
  nodes: Record<string, AtlasNode>;
  glossaryTerms: number;
}

// `groups` is a test seam — production callers always use the curated GROUPS.
export function computeLibrary(
  { atlasCommit, nodes, glossaryTerms }: LibraryInputs,
  groups: GroupSpec[] = GROUPS,
): LibraryData {
  const all = Object.values(nodes);
  const scopes = all.filter((n) => n.type === "Scope").sort((a, b) => a.order - b.order);
  const nr = all.filter((n) => n.doc_no.startsWith("NR")).sort((a, b) => a.order - b.order);
  const ref = ({ id, doc_no, title }: AtlasNode) => ({ id, doc_no, title });

  // ── Semantic tree (doc_no-based) ──────────────────────────────────────────
  // Inside agent artifacts the heading depth caps at 6 and parentId goes flat
  // (thousands of nodes parent straight to the depth-capped "Sky Primitives"
  // node). The real nesting is encoded in the doc_no, so the chunk tree is
  // built from doc_no segments instead of parentId. Structural suffixes
  // (.varX) are spec-guaranteed — see CLAUDE.md doc_no rules.
  const byDocNo = new Map(all.map((n) => [n.doc_no, n]));
  const semParent = (doc_no: string): string | null => {
    let p = doc_no.replace(/\.var\d+$/, "");
    while (p.includes(".")) {
      p = p.slice(0, p.lastIndexOf("."));
      if (byDocNo.has(p)) return p;
    }
    return null;
  };
  const semChildren = new Map<string, AtlasNode[]>();
  for (const n of all) {
    const p = semParent(n.doc_no);
    if (!p) continue; // scope roots (A.0…A.6) and NR-* have no semantic parent
    let kids = semChildren.get(p);
    if (!kids) semChildren.set(p, (kids = []));
    kids.push(n);
  }
  const semWeight = new Map<string, number>();
  const semSubtree = (doc_no: string): number => {
    const memo = semWeight.get(doc_no);
    if (memo !== undefined) return memo;
    let docs = 1;
    for (const c of semChildren.get(doc_no) ?? []) docs += semSubtree(c.doc_no);
    semWeight.set(doc_no, docs);
    return docs;
  };

  // Recursive chunk node. Every direct child is included — a bar's visible
  // composition must be fully expandable (no phantom "smaller sections" mass
  // that can't be opened). MIN_CHUNK_DOCS only limits RECURSION: children
  // below it are emitted as leaf entries (their own sub-structure, if any,
  // is not descended into), keeping the tree bounded.
  const MIN_CHUNK_DOCS = 5;
  const sortedKids = (doc_no: string): AtlasNode[] =>
    (semChildren.get(doc_no) ?? [])
      .slice()
      .sort((a, b) => semSubtree(b.doc_no) - semSubtree(a.doc_no));
  const chunkNode = (n: AtlasNode): ChunkNode => {
    const entry: ChunkNode = { ...ref(n), docs: semSubtree(n.doc_no) };
    // Hoist pass-through levels: a node whose only child is a wrapper
    // (A.6 → A.6.1 "Agent Artifacts") adds no information — descend until a
    // real branching (prime list / executor list) so every expansion reveals
    // distinct chunks, never a child one doc smaller than its parent.
    let kids = sortedKids(n.doc_no);
    while (kids.length === 1) {
      const inner = sortedKids(kids[0].doc_no);
      if (inner.length === 0) break;
      kids = inner;
    }
    if (kids.length > 0) {
      entry.children = kids.map((c) =>
        semSubtree(c.doc_no) >= MIN_CHUNK_DOCS ? chunkNode(c) : { ...ref(c), docs: semSubtree(c.doc_no) },
      );
    }
    return entry;
  };
  // Hoist single-child chains at the group root (A.6 → A.6.1 → the two agent
  // lists) so expanding a group goes straight to the first real branching.
  const groupChildren = (roots: string[]): ChunkNode[] => {
    if (roots.length === 0) return [];
    if (roots.length > 1) return roots.map((r) => chunkNode(nodes[r]));
    let node = chunkNode(nodes[roots[0]]);
    while (node.children && node.children.length === 1) node = node.children[0];
    return node.children ?? [node];
  };

  const typeCounts = new Map<string, number>();
  for (const n of all) typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1);

  // Resolve each GroupSpec to a concrete root-id list. Complement specs read
  // straight children off the semChildren map built above, so a new A.2.x
  // article self-heals into "Support processes" without a code change.
  const resolveRoots = (g: GroupSpec): string[] => {
    if ("roots" in g) return g.roots;
    const parent = nodes[g.complementOf];
    if (!parent) return [];
    const exceptSet = new Set(g.except);
    return (semChildren.get(parent.doc_no) ?? []).filter((c) => !exceptSet.has(c.id)).map((c) => c.id);
  };
  const resolvedGroups = groups.map((g) => ({ name: g.name, roots: resolveRoots(g) }));

  // Completeness diff: A.1 and A.2 are partitioned article-by-article (unlike
  // A.0/A.3–A.6, each captured by a single whole-scope root) — every direct
  // semantic child of those two scopes must be claimed by SOME group's roots,
  // or a newly-added top-level article silently vanishes from the chunkTree.
  // Surface any gap as a visible "Ungrouped" catch-all plus a console.warn
  // (drift surfaces in the UI on next visit) rather than dropping it.
  const claimed = new Set(resolvedGroups.flatMap((g) => g.roots));
  const partitioned = [...(semChildren.get("A.1") ?? []), ...(semChildren.get("A.2") ?? [])];
  const unclaimed = partitioned.filter((n) => !claimed.has(n.id));
  if (unclaimed.length > 0) {
    console.warn(
      `[libraryShape] ${unclaimed.length} article(s) under A.1/A.2 not claimed by any GROUPS entry — ` +
        `${unclaimed.map((n) => n.doc_no).join(", ")}. Shown under "Ungrouped"; extend GROUPS in src/lib/libraryShape.ts.`,
    );
  }

  return {
    atlasCommit,
    totals: { docs: all.length, bytes: all.reduce((s, n) => s + (n.content || "").length, 0), glossaryTerms },
    docTypes: [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
    // Scope-rooted chunk tree for the "Doc mass by scope" view — same recursive
    // chunk semantics as chunkTree, but along the editorial scope axis.
    scopeTree: scopes.map(chunkNode),
    // Hierarchical chunk tree: curated taxonomy groups at the top, then the
    // semantic (doc_no-based) tree beneath, pruned at MIN_CHUNK_DOCS.
    chunkTree: [
      ...resolvedGroups.map(({ name, roots }) => {
        const docs = roots.reduce((s, r) => s + semSubtree(nodes[r].doc_no), 0);
        const single = roots.length === 1 ? nodes[roots[0]] : null;
        return {
          title: name,
          ...(single ? { id: single.id, doc_no: single.doc_no } : {}),
          docs,
          children: groupChildren(roots),
        };
      }),
      ...(unclaimed.length > 0
        ? [
            {
              title: "Ungrouped",
              docs: unclaimed.reduce((s, n) => s + semSubtree(n.doc_no), 0),
              children: groupChildren(unclaimed.map((n) => n.id)),
            },
          ]
        : []),
    ],
    neededResearch: nr.map((n) => ref(n)),
  };
}
