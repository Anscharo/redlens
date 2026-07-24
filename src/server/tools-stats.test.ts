// Pure unit tests for the atlas_describe stats section. Run under `bun test`
// (src/server is excluded from vitest). Only docMap/glossary/meta are used.
import { test, expect } from "bun:test";
import { atlasDescribe } from "./tools.ts";
import { statsSection, trim } from "./tools-stats.ts";
import type { Indexes, AtlasNode } from "./indexes.ts";
import type { GlossaryEntry } from "../lib/glossaryLookup.ts";

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
