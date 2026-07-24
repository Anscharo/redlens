// Shared compute for the Atlas Library artifact (public/library.json), consumed
// by scripts/required/build-library.mjs.
// No timestamps in the returned data — library.json ships in the reproducible
// build (REPRO=1 pnpm test requires byte-identical artifacts).
import fs from "node:fs";
import path from "node:path";

// Curated taxonomy seed — group → article/scope root UUIDs (see docs/atlas-map.md §2).
// This is the embryo of the P1 chunk registry.
const GROUPS = [
  ["Constitutional core", ["8650a584-01f8-45d6-882b-c14eab9879c4" /* A.0 */, "86a93dab-2f12-4c3f-9285-bcc4520c851b" /* A.1.1 */, "fbd55373-32cc-49a9-a74d-60cfacf6a379" /* A.1.2 */, "f51e410a-f51d-463f-82f2-2bcf289dbbb7" /* A.1.3 */, "08176561-7acf-47e0-bb54-41771d54b15f" /* A.1.4 */, "d607a8e3-17e1-4aab-9e74-11af39767cc7" /* A.1.14 */, "ba97b4dd-c4e0-4d12-8769-423f6ecdc6bf" /* A.1.15 */]],
  ["Actor rulebooks", ["df4f9bfd-e743-44b5-9c62-9c5f10b15340" /* A.1.5 */, "75f0063c-ad70-49e4-b356-9b76097ced7b" /* A.1.6 */, "1ce24b08-84ff-4524-9710-49bba429c6ef" /* A.1.7 */, "d6b43720-243e-4610-8c03-cd515ace6247" /* A.1.8 */]],
  ["Governance processes", ["1d940c6d-02ce-4c17-8057-cef13c1cc7ad" /* A.1.9 */, "de0cc370-de9c-48a4-b10e-91782df7abcd" /* A.1.10 */, "83edd4e1-692e-4566-a415-b8f272c33c5e" /* A.1.11 */, "7f2ba62c-9b3b-4df6-aa16-189a749cffa3" /* A.1.12 */, "75e8fd51-a540-4c3a-aaa9-1a38502f89b2" /* A.1.13 */]],
  ["Primitive spec library", ["fcde2604-a138-4c1b-9d9a-14895835c907" /* A.2.2 */]],
  ["Support processes", ["f83a880f-6440-49ac-8e28-b16b4e2c9912", "6c0af059-5d33-4e2b-90f1-1606957b8f85", "6f8d5065-d6ff-4add-9a28-eadeffa7ed1a", "bb0c23c6-5123-4c35-ac84-fcb018a72cda", "b09e86b1-0e95-4111-b141-7a980eeaef08", "a520fea9-c2b7-4fda-a2b0-254b76504bc0", "104c3543-ce94-4a2f-9968-57f1ee858085", "ac707ae4-65da-4cf9-8a34-8b9304cd9a95", "29b21344-c651-4ea8-9d25-c1b0948c9dca", "2427d573-5e69-4429-a267-97fa6e84ac43", "b888a6f2-df29-4254-bc74-8dff265f2697", "7be35f96-8230-41d6-aab4-0a76bd705a25" /* A.2.1,3..13 */]],
  ["Financial machinery", ["d56538fc-2220-491a-a4d2-7ad6e461d707" /* A.3 */]],
  ["Protocol machinery", ["5c20d9af-0bb9-4ca1-a944-1e2cb6f8bb6b" /* A.4 */]],
  ["Accessibility", ["99b1b47d-3c7a-4859-ac00-8c0849f9070e" /* A.5 */]],
  ["Agent artifacts", ["4a08ca6c-e652-49e4-9b79-4831b20e600a" /* A.6 */]],
];

export function loadInputs(publicDir) {
  const { atlasCommit, nodes } = JSON.parse(fs.readFileSync(path.join(publicDir, "docs.json"), "utf8"));
  const glossary = JSON.parse(fs.readFileSync(path.join(publicDir, "glossary.json"), "utf8"));
  return { atlasCommit, nodes, terms: Object.values(glossary.terms).flat() };
}

export function computeLibrary({ atlasCommit, nodes, terms }) {
  const all = Object.values(nodes);
  const scopes = all.filter((n) => n.type === "Scope").sort((a, b) => a.order - b.order);
  const nr = all.filter((n) => n.doc_no.startsWith("NR")).sort((a, b) => a.order - b.order);
  const ref = ({ id, doc_no, title }) => ({ id, doc_no, title });

  // ── Semantic tree (doc_no-based) ──────────────────────────────────────────
  // Inside agent artifacts the heading depth caps at 6 and parentId goes flat
  // (thousands of nodes parent straight to the depth-capped "Sky Primitives"
  // node). The real nesting is encoded in the doc_no, so the chunk tree is
  // built from doc_no segments instead of parentId. Structural suffixes
  // (.varX) are spec-guaranteed — see CLAUDE.md doc_no rules.
  const byDocNo = new Map(all.map((n) => [n.doc_no, n]));
  const semParent = (doc_no) => {
    let p = doc_no.replace(/\.var\d+$/, "");
    while (p.includes(".")) {
      p = p.slice(0, p.lastIndexOf("."));
      if (byDocNo.has(p)) return p;
    }
    return null;
  };
  const semChildren = new Map();
  for (const n of all) {
    const p = semParent(n.doc_no);
    if (!p) continue; // scope roots (A.0…A.6) and NR-* have no semantic parent
    if (!semChildren.has(p)) semChildren.set(p, []);
    semChildren.get(p).push(n);
  }
  const semWeight = new Map();
  const semSubtree = (doc_no) => {
    if (semWeight.has(doc_no)) return semWeight.get(doc_no);
    let docs = 1;
    for (const c of semChildren.get(doc_no) || []) docs += semSubtree(c.doc_no);
    semWeight.set(doc_no, docs);
    return docs;
  };

  // Recursive chunk node. Every direct child is included — a bar's visible
  // composition must be fully expandable (no phantom "smaller sections" mass
  // that can't be opened). MIN_CHUNK_DOCS only limits RECURSION: children
  // below it are emitted as leaf entries (their own sub-structure, if any,
  // is not descended into), keeping the artifact bounded.
  const MIN_CHUNK_DOCS = 5;
  const sortedKids = (doc_no) =>
    (semChildren.get(doc_no) || [])
      .slice()
      .sort((a, b) => semSubtree(b.doc_no) - semSubtree(a.doc_no));
  const chunkNode = (n) => {
    const entry = { ...ref(n), docs: semSubtree(n.doc_no) };
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
  const groupChildren = (roots) => {
    if (roots.length > 1) return roots.map((r) => chunkNode(nodes[r]));
    let node = chunkNode(nodes[roots[0]]);
    while (node.children && node.children.length === 1) node = node.children[0];
    return node.children || [node];
  };

  return {
    atlasCommit,
    totals: { docs: all.length, bytes: all.reduce((s, n) => s + (n.content || "").length, 0), glossaryTerms: terms.length },
    docTypes: Object.entries(all.reduce((m, n) => ((m[n.type] = (m[n.type] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]),
    // Scope-rooted chunk tree for the "Doc mass by scope" view — same recursive
    // chunk semantics as chunkTree, but along the editorial scope axis.
    scopeTree: scopes.map(chunkNode),
    // Hierarchical chunk tree: curated taxonomy groups at the top, then the
    // semantic (doc_no-based) tree beneath, pruned at MIN_CHUNK_DOCS.
    chunkTree: GROUPS.map(([name, roots]) => {
      const docs = roots.reduce((s, r) => s + semSubtree(nodes[r].doc_no), 0);
      const single = roots.length === 1 ? nodes[roots[0]] : null;
      return {
        title: name,
        ...(single ? { id: single.id, doc_no: single.doc_no } : {}),
        docs,
        children: groupChildren(roots),
      };
    }),
    neededResearch: nr.map((n) => ref(n)),
  };
}
