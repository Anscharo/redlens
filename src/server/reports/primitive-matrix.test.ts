// Pure unit test for the primitive_matrix report builder (bun test; src/server
// is excluded from vitest). Hand-built Indexes fixture.
import { test, expect } from "bun:test";
import { buildPrimitiveMatrixReport } from "./primitive-matrix.ts";
import type { Indexes, AtlasNode, Entity } from "../indexes.ts";

// Two Prime Agents (Alpha @ A.6.1.1.1, Bravo @ A.6.1.1.2).
//   agent-creation:      Completed for both        → universal (engaged 2/2)
//   distribution-reward: Active Alpha, Inactive Bravo → optional (Bravo missing)
//   light-agent:         Inactive for both         → dormant (engaged 0/2)
function node(id: string, doc_no: string, title: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 5, parentId: null, order: 0, content: "", contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}
function entity(id: string, slug: string, name: string, entity_type: string, subtype: string | null, defining_doc_id: string | null, meta: object | null): Entity {
  return { id, slug, name, entity_type, subtype, defining_doc_id, is_active: 1, meta: meta ? JSON.stringify(meta) : null };
}

function makeIx(): Indexes {
  const docs = [
    node("AD", "A.6.1.1.2", "Bravo"), // out-of-order on purpose: Bravo doc precedes in array
    node("AA", "A.6.1.1.1", "Alpha"),
    node("CAT_AC", "A.2.5.1.1", "Agent Creation Primitive"),
    node("CAT_DR", "A.2.5.9.1", "Distribution Reward Primitive"),
  ];
  const entities: Entity[] = [
    entity("agentA", "alpha", "Alpha", "agent", "prime", "AA", null),
    entity("agentB", "bravo", "Bravo", "agent", "prime", "AD", null),
    // Non-prime agent must NOT be counted in the denominator.
    entity("execA", "amatsu", "Amatsu", "agent", "operational_executor", null, null),
    entity("p1", "alpha-agent-creation", "Alpha Agent Creation", "primitive", "agent-creation", "d1", { agent_doc_id: "AA", primitive_category_doc_id: "CAT_AC", status: "Completed" }),
    entity("p2", "bravo-agent-creation", "Bravo Agent Creation", "primitive", "agent-creation", "d2", { agent_doc_id: "AD", primitive_category_doc_id: "CAT_AC", status: "Completed" }),
    entity("p3", "alpha-distribution-reward", "Alpha DR", "primitive", "distribution-reward", "d3", { agent_doc_id: "AA", primitive_category_doc_id: "CAT_DR", status: "Active" }),
    entity("p4", "bravo-distribution-reward", "Bravo DR", "primitive", "distribution-reward", "d4", { agent_doc_id: "AD", primitive_category_doc_id: "CAT_DR", status: "Inactive" }),
    entity("p5", "alpha-light-agent", "Alpha Light", "primitive", "light-agent", "d5", { agent_doc_id: "AA", primitive_category_doc_id: "CAT_LA", status: "Inactive" }),
    entity("p6", "bravo-light-agent", "Bravo Light", "primitive", "light-agent", "d6", { agent_doc_id: "AD", primitive_category_doc_id: "CAT_LA", status: "Inactive" }),
  ];
  const docMap = new Map(docs.map((d) => [d.id, d]));
  return {
    docMap,
    byDocNo: new Map(docs.map((d) => [d.doc_no, d])),
    entities,
    entityById: new Map(entities.map((e) => [e.id, e])),
    entityBySlug: new Map(entities.map((e) => [e.slug, e])),
  } as unknown as Indexes;
}

test("buildPrimitiveMatrixReport classifies by activation status with missing agents", () => {
  const r = buildPrimitiveMatrixReport(makeIx(), { include_provenance: true }) as any;
  expect(r.report).toBe("primitive_matrix");
  // Denominator = the two Prime Agents only (executor excluded), doc_no ordered.
  expect(r.agents).toEqual(["Alpha", "Bravo"]);
  expect(r.agent_count).toBe(2);
  expect(r.subtype_count).toBe(3);
  expect(r.universal_count).toBe(1);
  expect(r.optional_count).toBe(1);
  expect(r.dormant_count).toBe(1);

  // Sort order: universal, then optional, then dormant.
  const [ac, dr, la] = r.subtypes;

  // agent-creation: Completed for both → engaged 2/2, universal.
  expect(ac).toMatchObject({ subtype: "agent-creation", classification: "universal", engaged_count: 2, completed_count: 2 });
  expect(ac.missing_agents).toEqual([]);
  expect(ac.agent_status).toEqual({ Alpha: "Completed", Bravo: "Completed" });
  expect(ac.category_doc_no).toBe("A.2.5.1.1");

  // distribution-reward: Active Alpha, Inactive Bravo → optional, Bravo missing.
  expect(dr).toMatchObject({ subtype: "distribution-reward", classification: "optional", engaged_count: 1, active_count: 1, inactive_count: 1 });
  expect(dr.engaged_agents).toEqual(["Alpha"]);
  expect(dr.missing_agents).toEqual(["Bravo"]);

  // light-agent: Inactive for both → dormant.
  expect(la).toMatchObject({ subtype: "light-agent", classification: "dormant", engaged_count: 0, inactive_count: 2 });
  expect(la.missing_agents).toEqual(["Alpha", "Bravo"]);
});

test("include_provenance:false omits category_doc_no", () => {
  const r = buildPrimitiveMatrixReport(makeIx(), { include_provenance: false }) as any;
  expect(r.subtypes[0].category_doc_no).toBeUndefined();
});
