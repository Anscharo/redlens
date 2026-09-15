// Direct unit tests for the Indexes → src/lib shape adapter. Previously only
// covered incidentally through whichever report-builder fixture happened to
// carry entities/edges — none of those pinned the participant/instance/
// invocation/primitive split, or the conditional `m`/`s` spreads (a field
// present only when the source data has it, per relations.json's own
// omit-when-empty convention).
import { test, expect } from "bun:test";
import { indexesToDocs, indexesToGraphData } from "./ix-adapter.ts";
import type { Indexes, AtlasNode, Entity, Edge } from "../retrieval/indexes.ts";

function node(id: string, doc_no: string): AtlasNode {
  return { id, doc_no, title: id, type: "Core", depth: 1, parentId: null, order: 0, content: "", contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}
function entity(id: string, entity_type: string, meta: string | null = null): Entity {
  return { id, slug: id, name: id, entity_type, subtype: null, defining_doc_id: null, is_active: 1, meta };
}
function edge(id: number, source_doc_nos: string | null, meta: string | null = null): Edge {
  return { id, from_id: "A", from_type: "doc", to_id: "B", to_type: "doc", edge_type: "cites", source_doc_nos, weight: 1, meta };
}

function makeIx(entities: Entity[], edges: Edge[]): Indexes {
  const docs = [node("A", "A.1"), node("B", "A.2")];
  return {
    docMap: new Map(docs.map((d) => [d.id, d])),
    byDocNo: new Map(docs.map((d) => [d.doc_no, d])),
    entities,
    edges,
    meta: { atlasCommit: "test" },
  } as unknown as Indexes;
}

// ── indexesToDocs ─────────────────────────────────────────────────────────────

test("indexesToDocs projects docMap into a plain UUID-keyed record", () => {
  const ix = makeIx([], []);
  expect(indexesToDocs(ix)).toEqual({
    A: expect.objectContaining({ id: "A", doc_no: "A.1" }),
    B: expect.objectContaining({ id: "B", doc_no: "A.2" }),
  });
});

// ── indexesToGraphData: participant/instance/invocation/primitive split ──────

test("buckets entities by entity_type: instance/invocation/primitive get their own bucket, everything else is a participant", () => {
  const entities = [
    entity("agent1", "agent"),
    entity("inst1", "instance"),
    entity("inv1", "invocation"),
    entity("prim1", "primitive"),
  ];
  const gd = indexesToGraphData(makeIx(entities, []));
  expect(gd.participants.map((e) => e.id)).toEqual(["agent1"]);
  expect(gd.instances.map((e) => e.id)).toEqual(["inst1"]);
  expect(gd.invocations.map((e) => e.id)).toEqual(["inv1"]);
  expect(gd.primitives.map((e) => e.id)).toEqual(["prim1"]);
});

// ── toGraphEntity: conditional `m` spread ────────────────────────────────────

test("an entity's meta field is present only when non-null (relations.json's own omit-when-empty convention)", () => {
  const withMeta = indexesToGraphData(makeIx([entity("e1", "agent", '{"role":"prime"}')], []));
  expect(withMeta.participants[0]!.m).toBe('{"role":"prime"}');

  const withoutMeta = indexesToGraphData(makeIx([entity("e2", "agent", null)], []));
  expect("m" in withoutMeta.participants[0]!).toBe(false);
});

// ── toRelationEdge: source_doc_nos parsing + conditional `s`/`m` spreads ─────

test("an edge's source_doc_nos parses via parseDocNos and is present only when non-empty", () => {
  const withDocs = indexesToGraphData(makeIx([], [edge(1, '["A.1.1","A.1.2"]')]));
  expect(withDocs.edges[0]!.s).toEqual(["A.1.1", "A.1.2"]);

  const withoutDocs = indexesToGraphData(makeIx([], [edge(2, null)]));
  expect("s" in withoutDocs.edges[0]!).toBe(false);
});

test("an edge's meta field is present only when non-null", () => {
  const withMeta = indexesToGraphData(makeIx([], [edge(1, null, '{"resolution":"direct"}')]));
  expect(withMeta.edges[0]!.m).toBe('{"resolution":"direct"}');

  const withoutMeta = indexesToGraphData(makeIx([], [edge(2, null, null)]));
  expect("m" in withoutMeta.edges[0]!).toBe(false);
});

test("an edge carries its from/to id, type, and edge_type through unchanged", () => {
  const gd = indexesToGraphData(makeIx([], [edge(1, null)]));
  expect(gd.edges[0]).toMatchObject({ f: "A", ft: "doc", t: "B", tt: "doc", e: "cites" });
});
