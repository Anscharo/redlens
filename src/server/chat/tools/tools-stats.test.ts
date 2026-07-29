// Pure unit tests for the atlas_describe stats section. Run under `bun test`
// (src/server is excluded from vitest). Only docMap/glossary/meta are used.
import { test, expect } from "bun:test";
import { atlasDescribe } from "./tools.ts";
import { statsSection, trim } from "./tools-stats.ts";
import type { Indexes, AtlasNode } from "../../retrieval/indexes.ts";
import type { GlossaryEntry } from "../../../lib/glossaryLookup.ts";

let order = 0;
function node(id: string, doc_no: string, type: string): AtlasNode {
  return { id, doc_no, title: `T ${doc_no}`, type, depth: 1, parentId: null, order: order++, content: "xx", addressRefs: [] } as AtlasNode;
}

function makeIx(): Indexes {
  const docs: AtlasNode[] = [
    // Real GROUPS root uuid for "Agent artifacts" so exactly one curated group
    // survives the missing-root filter in the fixture.
    node("4a08ca6c-e652-49e4-9b79-4831b20e600a", "A.6", "Scope"),
    node("w", "A.6.1", "Article"), // single wrapper — hoisted
    node("big", "A.6.1.1", "Section"),
    node("mid", "A.6.1.1.1", "Section"),
    ...[1, 2, 3, 4, 5].map((i) => node(`leaf${i}`, `A.6.1.1.1.${i}`, "Core")),
    ...[2, 3, 4].map((i) => node(`sib${i}`, `A.6.1.1.${i}`, "Core")),
    ...Array.from({ length: 13 }, (_, i) => node(`flat${i}`, `A.6.1.${i + 2}`, "Section")),
    node("s2", "A.5", "Scope"),
    node("s2c", "A.5.1", "Article"),
  ];
  const entries: GlossaryEntry[] = [
    { term: "Alpha", content: "", nodeId: "x", docNo: "A.5", sourceDocNo: "A.5", sourceContext: null },
  ];
  const entries2: GlossaryEntry[] = [
    { term: "Beta", content: "", nodeId: "y", docNo: "A.5", sourceDocNo: "A.5", sourceContext: null },
  ];
  return {
    docMap: new Map(docs.map((d) => [d.id, d])),
    // "acc" is an alias key sharing Alpha's entry objects — must not double-count.
    glossary: new Map([["alpha", entries], ["acc", entries], ["beta", entries2]]),
    meta: { atlasCommit: "deadbeef" },
    // atlasDescribe's default sections iterate these.
    edges: [],
    entities: [],
    entityById: new Map(),
  } as unknown as Indexes;
}

test("stats totals, scope masses, and glossary alias dedupe", () => {
  const s = statsSection(makeIx()) as { total_docs: number; glossary_terms: number; scopes: { doc_no: string; docs: number; pct: number }[] };
  expect(s.total_docs).toBe(27);
  expect(s.glossary_terms).toBe(2);
  expect(s.scopes.map((x) => [x.doc_no, x.docs])).toEqual([["A.6", 25], ["A.5", 2]]);
  expect(s.scopes[0].pct).toBe(92.6);
});

test("groups drop missing roots, hoist wrappers, cap children with a rollup, and depth-cap with child_count", () => {
  const s = statsSection(makeIx()) as { groups: { title: string; doc_no?: string; docs: number; children: { title: string; doc_no?: string; docs: number; children?: { doc_no?: string; child_count?: number }[] }[] }[] };
  expect(s.groups).toHaveLength(1); // every other GROUPS root is absent from the fixture
  const g = s.groups[0];
  expect(g).toMatchObject({ title: "Agent artifacts", doc_no: "A.6", docs: 25 });
  // Wrapper A.6.1 hoisted; its 14 children trimmed to 12 + a rollup that keeps sums intact.
  expect(g.children).toHaveLength(13);
  expect(g.children[0].doc_no).toBe("A.6.1.1"); // largest first
  expect(g.children[12]).toMatchObject({ title: "(+2 smaller)", docs: 2 });
  // Grandchild level is the depth cap: nodes with deeper structure expose child_count only.
  const mid = g.children[0].children?.find((c) => c.doc_no === "A.6.1.1.1");
  expect(mid?.child_count).toBe(5);
});

test("trim rolls sub-0.2% children into the rollup row, keeping masses summable", () => {
  // atlasTotal 10000 → floor is 20 docs. Children sorted largest-first.
  const rows = trim(
    [
      {
        title: "G",
        docs: 100,
        children: [
          { title: "big", docs: 60 },
          { title: "small1", docs: 19 },
          { title: "small2", docs: 12 },
        ],
      },
    ],
    10000,
    2,
  );
  expect(rows[0].children?.map((c) => c.title)).toEqual(["big", "(+2 smaller)"]);
  expect(rows[0].children?.[1]).toMatchObject({ docs: 31, pct: 0.3 });
});

test("atlas_describe exposes stats as an opt-in section only", () => {
  const ix = makeIx();
  expect(atlasDescribe(ix, ["stats"]).stats).toBeDefined();
  expect(atlasDescribe(ix).stats).toBeUndefined();
});

test("atlas_describe: sections:['all'] also includes stats", () => {
  const ix = makeIx();
  const out = atlasDescribe(ix, ["all"]);
  expect(out.stats).toBeDefined();
  expect(out.entity_type_graph).toBeDefined();
  expect(out.type_specifications).toBeDefined();
});

// ── Real-GROUPS-UUID fixture: exercises statsSection's own degrade filter
// (distinct from anatomyShape's internal completeness diff) —
//   GROUPS.map(...).filter((g) => "roots" in g ? g.roots.length > 0 : g.complementOf in nodes)
// — for both branches: a roots-based group with a partially-missing root list,
// and the complementOf/except group ("Support processes").
const A0 = "8650a584-01f8-45d6-882b-c14eab9879c4"; // Constitutional core root
const A1_1 = "86a93dab-2f12-4c3f-9285-bcc4520c851b"; // Constitutional core root
const A2 = "1ce14bd8-c7b3-4f74-a152-292a8d8ebed0"; // Support scope (complementOf anchor)
const A2_2 = "fcde2604-a138-4c1b-9d9a-14895835c907"; // Primitive spec anatomy root == the "except" entry

function makeGroupsIx(opts: { includeA2: boolean }): Indexes {
  const docs: AtlasNode[] = [
    node(A0, "A.0", "Scope"),
    node(A1_1, "A.1.1", "Article"), // only 2 of "Constitutional core"'s 7 roots present
    node(A2_2, "A.2.2", "Article"), // "Primitive spec anatomy" root, also the complement's "except" entry
    ...(opts.includeA2 ? [node(A2, "A.2", "Scope"), node("a29", "A.2.9", "Article")] : []),
  ];
  return {
    docMap: new Map(docs.map((d) => [d.id, d])),
    glossary: new Map(),
    meta: { atlasCommit: "deadbeef" },
    edges: [],
    entities: [],
    entityById: new Map(),
  } as unknown as Indexes;
}

test("roots-based group degrades to its present roots only (partial-missing, not all-or-nothing)", () => {
  const s = statsSection(makeGroupsIx({ includeA2: true })) as { groups: { title: string; docs: number }[] };
  const core = s.groups.find((g) => g.title === "Constitutional core");
  // Only A.0 + A.1.1 of the 7 curated roots exist in this fixture; the group
  // still surfaces (not dropped) with docs summed from just those two.
  expect(core).toMatchObject({ title: "Constitutional core", docs: 2 });
});

test("complementOf group resolves children(A.2) minus the except set when the anchor exists", () => {
  const s = statsSection(makeGroupsIx({ includeA2: true })) as {
    groups: { title: string; docs: number; doc_no?: string }[];
  };
  const support = s.groups.find((g) => g.title === "Support processes");
  const primitiveLib = s.groups.find((g) => g.title === "Primitive spec anatomy");
  // A.2.2 is excluded from "Support processes" (it has its own group) — only
  // A.2.9 remains under the complement.
  expect(support).toMatchObject({ title: "Support processes", docs: 1 });
  expect(primitiveLib).toMatchObject({ title: "Primitive spec anatomy", doc_no: "A.2.2", docs: 1 });
});

test("complementOf group is dropped entirely when its anchor (A.2) is missing, unlike roots groups", () => {
  const s = statsSection(makeGroupsIx({ includeA2: false })) as { groups: { title: string }[] };
  expect(s.groups.find((g) => g.title === "Support processes")).toBeUndefined();
  // Sibling roots-based groups anchored elsewhere are unaffected by A.2's absence.
  expect(s.groups.find((g) => g.title === "Constitutional core")).toBeDefined();
  expect(s.groups.find((g) => g.title === "Primitive spec anatomy")).toBeDefined();
});
