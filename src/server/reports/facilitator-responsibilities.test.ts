// Pure unit test for the facilitator_responsibilities report builder. Runs under
// `bun test` (NOT vitest — src/server is excluded there). Exercises the full
// path: the ix-adapter projects the server Edge/Entity shapes into the browser
// GraphData/AtlasBundle shapes, then the shared src/lib derivation runs. A
// hand-built Indexes fixture covers one assignment, one operational duty, and
// one active-data responsibility.
import { test, expect } from "bun:test";
import { buildFacilitatorResponsibilitiesReport } from "./facilitator-responsibilities.ts";
import type { Indexes, AtlasNode, Edge, Entity } from "../indexes.ts";

function node(id: string, doc_no: string, title: string, type = "Core", content = ""): AtlasNode {
  return { id, doc_no, title, type, depth: 3, parentId: null, order: 0, content, contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}
function entity(id: string, slug: string, name: string, entity_type: string, subtype: string | null, defining_doc_id: string | null): Entity {
  return { id, slug, name, entity_type, subtype, defining_doc_id, is_active: 1, meta: null };
}
function edge(id: number, from_id: string, to_id: string, to_type: string, edge_type: string, source_doc_nos: string[] | null, meta: object | null): Edge {
  return {
    id, from_id, from_type: "entity", to_id, to_type, edge_type,
    source_doc_nos: source_doc_nos ? JSON.stringify(source_doc_nos) : null,
    weight: 1, meta: meta ? JSON.stringify(meta) : null,
  };
}

function makeIx(): Indexes {
  const docs = [
    node("PRIMEDOC", "A.1", "Star Agent"),
    node("ASSIGNDOC", "A.1.5.1", "Operational Facilitator", "Core", "The Operational Facilitator for the Star Executor."),
    node("DUTYDOC", "A.1.7.1", "Universal Duty", "Core", "Operational Facilitators must publish a monthly report."),
    node("ADDOC", "A.1.6.1", "Reserve Data", "Active Data", "Responsible Party: Core Facilitator."),
  ];
  const entities: Entity[] = [
    entity("FAC", "op-fac", "Op Facilitator", "facilitator_org", null, null),
    entity("EXE", "star-exec", "Star Executor", "agent", "operational_executor", null),
    entity("PRIME", "star", "Star Agent", "agent", "prime", "PRIMEDOC"),
  ];
  const edges: Edge[] = [
    edge(1, "FAC", "EXE", "entity", "operational_facilitator_for", ["A.1.5.1"], null),
    edge(2, "EXE", "PRIME", "entity", "operational_executor_agent_for", ["A.1.5"], null),
    edge(3, "FAC", "DUTYDOC", "doc", "duty_for", ["A.1.7.1"], {
      role_declared: "Operational Facilitator", quote: "Operational Facilitators must publish a monthly report.",
    }),
    edge(4, "FAC", "ADDOC", "doc", "responsible_party_for", ["A.1.6.1"], { role_declared: "Core Facilitator" }),
  ];
  const docMap = new Map(docs.map((d) => [d.id, d]));
  return {
    docMap,
    byDocNo: new Map(docs.map((d) => [d.doc_no, d])),
    entities,
    edges,
    entityById: new Map(entities.map((e) => [e.id, e])),
    entityBySlug: new Map(entities.map((e) => [e.slug, e])),
    meta: { atlasCommit: "test" },
  } as unknown as Indexes;
}

test("buildFacilitatorResponsibilitiesReport derives assignments, duties, and active-data rows", () => {
  const r = buildFacilitatorResponsibilitiesReport(makeIx(), { include_provenance: true }) as any;
  expect(r.report).toBe("facilitator_responsibilities");
  expect(r.total).toBe(3);
  expect(r.truncated).toBe(false);
  expect(r.responsibilities).toHaveLength(3);

  const byCat = (cat: string) => r.responsibilities.filter((x: any) => x.category === cat);

  // Assignment: Facilitator → Executor, prime resolved via the executor→prime edge.
  const [assign] = byCat("assignment");
  expect(assign.facilitator).toBe("Op Facilitator");
  expect(assign.executor).toBe("Star Executor");
  expect(assign.role).toBe("Operational");
  expect(assign.agents).toEqual(["Star Agent"]);

  // Operational duty from the duty_for edge's declared role + quote.
  const [duty] = byCat("op-duty");
  expect(duty.title).toBe("Universal Duty");
  expect(duty.duty).toContain("publish a monthly report");

  // Active Data where a Core Facilitator is the Responsible Party.
  const [ad] = byCat("active-data");
  expect(ad.role).toBe("Core");
  expect(ad.docNo).toBe("A.1.6.1");

  // Category rollup uses the report's human labels.
  expect(r.categories["Facilitator Assignments (per Executor Agent)"]).toBe(1);
  expect(r.categories["Operational Facilitator Duties"]).toBe(1);
  expect(r.categories["Active Data Maintenance — Facilitator as Responsible Party"]).toBe(1);
});

test("include_provenance:false still returns every row (sources omitted)", () => {
  const r = buildFacilitatorResponsibilitiesReport(makeIx(), { include_provenance: false }) as any;
  expect(r.total).toBe(3);
  expect(r.responsibilities.every((x: any) => x.sources === undefined)).toBe(true);
});
