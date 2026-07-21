// Shared compute for the Atlas Library artifact (public/library.json) and the
// repo-doc renderings in docs/library/. Consumed by:
//   scripts/required/build-library.mjs  (build pass → public/library.json)
//   scripts/aux/atlas-shape.mjs         (docs/library/*.md companions)
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

const PRIME_LIST = "9fb7f1cc-f60b-4195-892d-5e540f969973"; // A.6.1.1 List Of Prime Agent Artifacts
const EXEC_LIST = "df62511d-afe5-42db-8bd4-6452c5a0f464"; // A.6.1.2 List Of Executor Agent Artifacts

export function loadInputs(publicDir) {
  const { atlasCommit, nodes } = JSON.parse(fs.readFileSync(path.join(publicDir, "docs.json"), "utf8"));
  const glossary = JSON.parse(fs.readFileSync(path.join(publicDir, "glossary.json"), "utf8"));
  return { atlasCommit, nodes, terms: Object.values(glossary.terms).flat() };
}

export function computeLibrary({ atlasCommit, nodes, terms }) {
  const all = Object.values(nodes);
  const children = new Map();
  for (const n of all) {
    if (!n.parentId) continue;
    if (!children.has(n.parentId)) children.set(n.parentId, []);
    children.get(n.parentId).push(n);
  }
  for (const kids of children.values()) kids.sort((a, b) => a.order - b.order);

  function subtree(id) {
    let docs = 0, bytes = 0;
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      const n = nodes[cur];
      docs += 1;
      bytes += (n.content || "").length;
      for (const k of children.get(cur) || []) stack.push(k.id);
    }
    return { docs, bytes };
  }

  const scopes = all.filter((n) => n.type === "Scope").sort((a, b) => a.order - b.order);
  const nr = all.filter((n) => n.doc_no.startsWith("NR")).sort((a, b) => a.order - b.order);
  const ref = ({ id, doc_no, title }) => ({ id, doc_no, title });

  // Segment a node's weight by its direct children (for the stacked weight
  // bars): largest first. The parent's own doc is folded into the largest
  // segment implicitly by normalizing against the segment sum at render time.
  const childSegments = (id) =>
    (children.get(id) || [])
      .map((c) => ({ ...ref(c), docs: subtree(c.id).docs }))
      .sort((a, b) => b.docs - a.docs);

  return {
    atlasCommit,
    totals: { docs: all.length, bytes: all.reduce((s, n) => s + (n.content || "").length, 0), glossaryTerms: terms.length },
    docTypes: Object.entries(all.reduce((m, n) => ((m[n.type] = (m[n.type] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]),
    scopes: scopes.map((s) => ({ ...ref(s), ...subtree(s.id), segments: childSegments(s.id) })),
    groups: GROUPS.map(([name, roots]) => {
      const w = roots.map(subtree).reduce((a, b) => ({ docs: a.docs + b.docs, bytes: a.bytes + b.bytes }), { docs: 0, bytes: 0 });
      const segments = roots
        .map((r) => ({ ...ref(nodes[r]), docs: subtree(r).docs }))
        .sort((a, b) => b.docs - a.docs);
      return { name, roots, ...w, segments };
    }),
    primes: (children.get(PRIME_LIST) || []).map((p) => ({ ...ref(p), ...subtree(p.id), segments: childSegments(p.id) })),
    executors: (children.get(EXEC_LIST) || []).map((p) => ({ ...ref(p), ...subtree(p.id), segments: childSegments(p.id) })),
    neededResearch: nr.map((n) => ref(n)),
    toc: scopes.map((s) => ({
      ...ref(s), docs: subtree(s.id).docs,
      articles: (children.get(s.id) || []).map((a) => ({
        ...ref(a), docs: subtree(a.id).docs,
        sections: (children.get(a.id) || []).filter((x) => x.type === "Section").map((sec) => ({ ...ref(sec), docs: subtree(sec.id).docs })),
      })),
    })),
    // Exposed for the docs renderer (not serialized into library.json by build-library).
    _internals: { children, subtree, scopes, nr },
  };
}
