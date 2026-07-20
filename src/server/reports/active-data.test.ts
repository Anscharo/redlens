// Pure unit test for the active_data report builder. Runs under `bun test` (NOT
// vitest — src/server is excluded there). Exercises the full path: the
// ix-adapter projects the server Edge/Entity shapes into the browser
// GraphData/AtlasBundle shapes, then the shared src/lib derivation runs. A
// hand-built Indexes fixture covers one Active Data doc whose controller sits
// under a Prime Agent, with a directly-resolved Responsible Party.
import { test, expect } from "bun:test";
import { buildActiveDataReport } from "./active-data.ts";
import type { Indexes, AtlasNode, Edge, Entity } from "../indexes.ts";

function node(id: string, doc_no: string, title: string, type = "Core", content = ""): AtlasNode {
  return { id, doc_no, title, type, depth: 3, parentId: null, order: 0, content, contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}
function entity(id: string, slug: string, name: string, entity_type: string, subtype: string | null, defining_doc_id: string | null): Entity {
  return { id, slug, name, entity_type, subtype, defining_doc_id, is_active: 1, meta: null };
}
function edge(id: number, from_id: string, from_type: string, to_id: string, to_type: string, edge_type: string, source_doc_nos: string[] | null, meta: object | null): Edge {
  return {
    id, from_id, from_type, to_id, to_type, edge_type,
    source_doc_nos: source_doc_nos ? JSON.stringify(source_doc_nos) : null,
    weight: 1, meta: meta ? JSON.stringify(meta) : null,
  };
}

function makeIx(): Indexes {
  const docs = [
    node("PRIMEDOC", "A.1", "Star Agent"),
    node("ADDOC", "A.1.0.6.1", "Reserve Levels", "Active Data"),
    node("CTRLDOC", "A.1.12.1", "Reserve Data Controller", "Core", "Standard update process."),
    node("RPDOC", "A.9.9", "RP Org Definition"),
  ];
  const entities: Entity[] = [
    entity("PRIME", "star", "Star Agent", "agent", "prime", "PRIMEDOC"),
    entity("EXE", "star-exec", "Star Executor", "agent", "operational_executor", null),
    entity("FAC", "fac-org", "Fac Org", "facilitator_org", null, null),
    entity("GOV", "gov-org", "Gov Org", "govops_org", null, null),
    entity("RP", "rp-org", "RP Org", "operational_party", null, "RPDOC"),
  ];
  const edges: Edge[] = [
    edge(1, "ADDOC", "doc", "CTRLDOC", "doc", "active_data_for", ["A.1.0.6.1"], null),
    edge(2, "EXE", "entity", "PRIME", "entity", "operational_executor_agent_for", ["A.1.5"], null),
    edge(3, "FAC", "entity", "EXE", "entity", "operational_facilitator_for", ["A.1.6"], null),
    edge(4, "GOV", "entity", "EXE", "entity", "operational_govops_for", ["A.1.7"], null),
    edge(5, "RP", "entity", "CTRLDOC", "doc", "responsible_party_for", ["A.1.12.1"], { resolution: "direct" }),
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

test("buildActiveDataReport resolves controller, chain, responsible party, and facilitator", () => {
  const r = buildActiveDataReport(makeIx(), { include_provenance: true }) as any;
  expect(r.report).toBe("active_data");
  expect(r.total).toBe(1);
  expect(r.truncated).toBe(false);

  const [row] = r.active_data;
  expect(row.activeDataDocNo).toBe("A.1.0.6.1");
  expect(row.activeDataTitle).toBe("Reserve Levels");
  expect(row.controllerDocNo).toBe("A.1.12.1");
  expect(row.agent).toBe("Star Agent");

  // prime → executor → facilitator/govops chain.
  expect(row.chain.executorName).toBe("Star Executor");
  expect(row.chain.facilitatorName).toBe("Fac Org");
  expect(row.chain.govopsName).toBe("Gov Org");

  // Directly-resolved Responsible Party with an evidence chain.
  expect(row.responsibleParty.name).toBe("RP Org");
  expect(row.responsibleParty.resolution).toBe("direct");
  expect(row.responsibleParty.evidence.length).toBeGreaterThan(0);

  // Approving Facilitator = the Operational Facilitator for the Executor.
  expect(row.facilitator.name).toBe("Fac Org");
  expect(row.facilitator.role).toBe("Operational Facilitator");
  expect(row.process).toBe("Direct Edit");
});

test("include_provenance:false empties the evidence chains but keeps resolved names", () => {
  const r = buildActiveDataReport(makeIx(), { include_provenance: false }) as any;
  const [row] = r.active_data;
  expect(row.responsibleParty.name).toBe("RP Org"); // resolved name kept
  expect(row.responsibleParty.evidence).toEqual([]);
  expect(row.facilitator.evidence).toEqual([]);
});
