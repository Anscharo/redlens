// Pure unit test for the rewards report builder. Runs under `bun test` (NOT
// vitest — src/server is excluded there). Exercises the full path: the
// ix-adapter projects the server Edge/Entity shapes into the browser
// GraphData/AtlasBundle shapes, then the shared src/lib derivation runs. A
// hand-built Indexes fixture covers one Prime Agent with an operational chain
// and one Distribution Reward primitive holding a single active Instance.
import { test, expect } from "bun:test";
import { buildRewardsReport } from "./rewards.ts";
import type { Indexes, AtlasNode, Edge, Entity } from "../indexes.ts";

function node(id: string, doc_no: string, title: string, content = ""): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 3, parentId: null, order: 0, content, contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}
function entity(id: string, slug: string, name: string, entity_type: string, subtype: string | null, defining_doc_id: string | null, meta: object | null): Entity {
  return { id, slug, name, entity_type, subtype, defining_doc_id, is_active: 1, meta: meta ? JSON.stringify(meta) : null };
}
function edge(id: number, from_id: string, to_id: string, edge_type: string): Edge {
  return { id, from_id, from_type: "entity", to_id, to_type: "entity", edge_type, source_doc_nos: null, weight: 1, meta: null };
}

function makeIx(): Indexes {
  // DR primitive head lives at <agentDocNo>.2.5.1; its .1.1 child is the global
  // activation; the instance's defining doc is a downstream ICD.
  const docs = [
    node("PRIMEDOC", "A.1", "Star Agent"),
    node("DRHEAD", "A.1.2.5.1", "Distribution Reward"),
    node("DRACT", "A.1.2.5.1.1.1", "Global Activation", "`Active`."),
    node("ICDDOC", "A.1.2.5.1.3.4.1", "Star DR Instance"),
  ];
  const entities: Entity[] = [
    entity("PRIME", "star", "Star Agent", "agent", "prime", "PRIMEDOC", null),
    entity("EXE", "star-exec", "Star Executor", "agent", "operational_executor", null, null),
    entity("GOV", "gov-op", "GovOps Org", "govops_org", null, null, null),
    entity("INST", "star-dr-inst", "Star DR Instance", "instance", "distribution-reward", "ICDDOC", {
      agent_doc_id: "PRIMEDOC", primitive_category_doc_id: null, status: "Active",
      params: { "Reward Code": ["RC-1", "rc-doc", "A.1.2.5.1.3.4.1.1"] },
    }),
  ];
  const edges: Edge[] = [
    edge(1, "EXE", "PRIME", "operational_executor_agent_for"),
    edge(2, "GOV", "EXE", "operational_govops_for"),
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

test("buildRewardsReport rolls up an agent's chain, primitive, and instance", () => {
  const r = buildRewardsReport(makeIx(), { include_provenance: true }) as any;
  expect(r.report).toBe("rewards");
  expect(r.total).toBe(1);
  expect(r.truncated).toBe(false);

  const [agent] = r.agents;
  expect(agent.name).toBe("Star Agent");
  expect(agent.chain.executor.name).toBe("Star Executor");
  expect(agent.chain.govops.name).toBe("GovOps Org");

  // DR primitive resolved via the <agentDocNo>.2.5.1 head + .1.1 activation.
  expect(agent.dr.primitiveDocNo).toBe("A.1.2.5.1");
  expect(agent.dr.globalActivation).toBe("Active");

  // One active Instance with its ICD doc_no + resolved reward code + raw params.
  expect(agent.dr.active).toHaveLength(1);
  const icd = agent.dr.active[0];
  expect(icd.status).toBe("Active");
  expect(icd.docNo).toBe("A.1.2.5.1.3.4.1");
  expect(icd.rewardCode).toBe("RC-1");
  expect(icd.params["Reward Code"][0]).toBe("RC-1");

  // No IB primitive in the fixture.
  expect(agent.ib).toBeNull();

  // Ecosystem context is carried alongside the agents.
  expect(r.ecosystem.demandSideBufferAddress).toMatch(/^0x/);
});

test("include_provenance:false drops the raw params tuples but keeps resolved fields", () => {
  const r = buildRewardsReport(makeIx(), { include_provenance: false }) as any;
  const icd = r.agents[0].dr.active[0];
  expect(icd.params).toBeUndefined();
  expect(icd.rewardCode).toBe("RC-1"); // resolved display field still present
});
