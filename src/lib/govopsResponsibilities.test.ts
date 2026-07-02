// Deterministic tests for deriveGovOpsResponsibilities using synthetic fixtures.
// Unlike the artifact-reading report tests, these construct a minimal docs +
// graph so the row-shaping/classification/dedup logic is exercised without a
// build. Duty DISCOVERY (vocabulary, guards) lives in build-graph and is tested
// in scripts_tests/graph-duties.test.ts — here duties arrive as duty_for edges.

import { describe, it, expect } from "vitest";
import type { AtlasNode, GraphEntity, RelationEdge } from "../types";
import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import { deriveGovOpsResponsibilities } from "./govopsResponsibilities";

const GOVOPS_DEF = "1e73ee4b-823d-406a-af54-223b43bc8e42"; // A.0.1.1.47

function node(p: Partial<AtlasNode> & Pick<AtlasNode, "id" | "doc_no" | "title">): AtlasNode {
  return {
    type: "Core",
    depth: 4,
    parentId: null,
    content: "",
    order: 0,
    addressRefs: [],
    ...p,
  } as AtlasNode;
}

const docs: Record<string, AtlasNode> = {};
for (const n of [
  node({ id: GOVOPS_DEF, doc_no: "A.0.1.1.47", title: "GovOps", content: "Governance Operations (\"GovOps\") actors are specialized Ecosystem Actors." }),
  node({ id: "prime-doc", doc_no: "A.6.1.1.1", title: "Prime Agent Spark" }),
  // Two copies of the same duty under two different agent artifacts — must collapse.
  node({ id: "duty-op-1", doc_no: "A.6.1.1.1.2.3", title: "Operational GovOps Reviews Rebate", content: "Operational GovOps reviews Spark's calculation of the rebate before executing." }),
  node({ id: "duty-op-2", doc_no: "A.6.1.1.2.2.3", title: "Operational GovOps Reviews Rebate", content: "Operational GovOps reviews Grove's calculation of the rebate before executing." }),
  node({ id: "duty-core", doc_no: "A.2.2.1.1.13", title: "Core GovOps Validates Executor Accord Primitive Inputs", content: "Core GovOps reviews the inputs to the Executor Accord Primitive to ensure validity." }),
  // Assignment doc (no duty_for edge — build-graph excludes the structural doc_no).
  node({ id: "assign-doc", doc_no: "A.6.1.2.1.2", title: "Operational GovOps", content: "Operational GovOps for Operational Executor Agent Amatsu is Soter Labs." }),
  // Active Data controller whose Responsible Party is declared as GovOps.
  node({ id: "adc-doc", doc_no: "A.2.2.4.1.2.1.1", type: "Active Data Controller", title: "Integrator Program Applications", content: "The Responsible Party is Operational GovOps." }),
  // Active Data controller where Soter Labs is RP in a NON-GovOps capacity
  // (named directly) — must be EXCLUDED from GovOps responsibilities.
  node({ id: "adc-nongov", doc_no: "A.2.2.4.9.9.1", type: "Active Data Controller", title: "List Of Auxiliary Accounts", content: "The Responsible Party is Soter Labs." }),
  // Content-discovered duty: the edge carries the matched quote as provenance.
  node({ id: "duty-quoted", doc_no: "A.1.14.4.6.1.1", title: "Executor Agent Duties", content: "Some preamble sentence. GovOps actors carry out operational activities on behalf of Executor Agents." }),
  // Title-discovered duty (quote null) whose content is an unpunctuated bullet
  // list — the snippet must pick the GovOps bullet, not glue the whole list.
  node({ id: "duty-title-bullets", doc_no: "A.2.7.7", title: "GovOps Settlement Review", content: "The process flow is defined herein:\n\n- The Agent submits the calculation data\n- Core GovOps reviews the calculations for accuracy\n- The Facilitator publishes the outcome" }),
  // Shape #3 — process-step "Update" docs (process_step_responsible_party_for).
  node({ id: "step-op", doc_no: "A.2.2.9.2.2.3.3.4.2.1", title: "Primitive Hub Document Update", content: "The Document in the Agent Artifact is updated as follows:\n\n- Responsible Party: Operational GovOps\n- Triggers: none." }),
  // One doc with both an op step and a core step → two edges, two rows.
  node({ id: "step-both", doc_no: "A.2.2.9.9.9", title: "Combined Update", content: "- Responsible Party: Operational GovOps\n- Responsible Party: Core GovOps" }),
  // Defensive: a rogue doc with BOTH a duty_for and a process-step edge must
  // surface once (duty wins — sections run in priority order).
  node({ id: "dual", doc_no: "A.2.8.8", title: "Dual Signal", content: "Operational GovOps reviews the update.\n\n- Responsible Party: Operational GovOps" }),
  // Same generic title, outside the per-agent-artifact subtree (A.6.1.1.<n>.*) —
  // these are genuinely different process-step docs that happen to share a
  // structural title, so they must NOT collapse into a single row.
  node({ id: "flow-a", doc_no: "A.2.2.9.1.2.3.1.2", title: "Process Flow", content: "Operational GovOps calculates the eligible balances using method A." }),
  node({ id: "flow-b", doc_no: "A.2.2.9.2.2.3.1.2", title: "Process Flow", content: "Operational GovOps calculates the eligible balances using method B." }),
]) docs[n.id] = n;

const atlas: AtlasBundle = { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: null };

const participants: GraphEntity[] = [
  { id: "soter", slug: "soter-labs", name: "Soter Labs", et: "govops_org", st: null, did: null },
  { id: "atlas-axis", slug: "atlas-axis", name: "Atlas Axis", et: "govops_org", st: null, did: null },
  { id: "exec", slug: "amatsu", name: "Operational Executor Agent Amatsu", et: "agent", st: "operational_executor", did: null },
  { id: "core-exec", slug: "cc-exec-1", name: "Core Council Executor Agent 1", et: "agent", st: "core_executor", did: null },
  { id: "prime", slug: "spark", name: "Spark", et: "agent", st: "prime", did: "prime-doc" },
];

const dutyMeta = (role: string, quote: string | null, match = quote ? "active" : "title") =>
  JSON.stringify({ role_declared: role, match, quote });

const edges: RelationEdge[] = [
  { f: "soter", ft: "entity", t: "exec", tt: "entity", e: "operational_govops_for", s: ["A.6.1.2.1.2"] },
  { f: "atlas-axis", ft: "entity", t: "core-exec", tt: "entity", e: "core_govops_for", s: ["A.6.1.2.3.2"] },
  { f: "exec", ft: "entity", t: "prime", tt: "entity", e: "operational_executor_agent_for", s: ["A.6.1.1.1"] },
  // Duties — duty_for edges as build-graph section 2s-ter emits them.
  { f: "soter", ft: "entity", t: "duty-op-1", tt: "doc", e: "duty_for", s: ["A.6.1.1.1.2.3"], m: dutyMeta("Operational GovOps", null) },
  { f: "soter", ft: "entity", t: "duty-op-2", tt: "doc", e: "duty_for", s: ["A.6.1.1.2.2.3"], m: dutyMeta("Operational GovOps", null) },
  { f: "atlas-axis", ft: "entity", t: "duty-core", tt: "doc", e: "duty_for", s: ["A.2.2.1.1.13"], m: dutyMeta("Core GovOps", null) },
  { f: "soter", ft: "entity", t: "duty-quoted", tt: "doc", e: "duty_for", s: ["A.1.14.4.6.1.1"], m: dutyMeta("Operational GovOps", "GovOps actors [carry out](someuuid) operational activities on behalf of Executor Agents.") },
  { f: "atlas-axis", ft: "entity", t: "duty-title-bullets", tt: "doc", e: "duty_for", s: ["A.2.7.7"], m: dutyMeta("Core GovOps", null) },
  { f: "soter", ft: "entity", t: "flow-a", tt: "doc", e: "duty_for", s: ["A.2.2.9.1.2.3.1.2"], m: dutyMeta("Operational GovOps", "Operational GovOps calculates the eligible balances using method A.") },
  { f: "soter", ft: "entity", t: "flow-b", tt: "doc", e: "duty_for", s: ["A.2.2.9.2.2.3.1.2"], m: dutyMeta("Operational GovOps", "Operational GovOps calculates the eligible balances using method B.") },
  { f: "soter", ft: "entity", t: "dual", tt: "doc", e: "duty_for", s: ["A.2.8.8"], m: dutyMeta("Operational GovOps", "Operational GovOps reviews the update.") },
  { f: "soter", ft: "entity", t: "adc-doc", tt: "doc", e: "responsible_party_for", s: ["A.2.2.4.1.2.1.1"], m: JSON.stringify({ role_declared: "Operational GovOps", resolution: "chain" }) },
  // Soter Labs named directly (non-GovOps capacity) — excluded.
  { f: "soter", ft: "entity", t: "adc-nongov", tt: "doc", e: "responsible_party_for", s: ["A.2.2.4.9.9.1"], m: JSON.stringify({ role_declared: "Soter Labs", resolution: "direct" }) },
  // Shape #3 — process-step RP edges (already deduped per (doc, entity) upstream).
  { f: "soter", ft: "entity", t: "step-op", tt: "doc", e: "process_step_responsible_party_for", s: ["A.2.2.9.2.2.3.3.4.2.1"], m: JSON.stringify({ role_declared: "Operational GovOps", resolution: "chain", automated: false }) },
  { f: "soter", ft: "entity", t: "step-both", tt: "doc", e: "process_step_responsible_party_for", s: ["A.2.2.9.9.9"], m: JSON.stringify({ role_declared: "Operational GovOps", resolution: "chain", automated: false }) },
  { f: "atlas-axis", ft: "entity", t: "step-both", tt: "doc", e: "process_step_responsible_party_for", s: ["A.2.2.9.9.9"], m: JSON.stringify({ role_declared: "Core GovOps", resolution: "chain", automated: false }) },
  { f: "soter", ft: "entity", t: "dual", tt: "doc", e: "process_step_responsible_party_for", s: ["A.2.8.8"], m: JSON.stringify({ role_declared: "Operational GovOps", resolution: "chain", automated: false }) },
];

const graph: GraphData = { participants, instances: [], invocations: [], primitives: [], edges };

const results = deriveGovOpsResponsibilities(atlas, graph);
const byCat = (c: string) => results.filter((r) => r.category === c);

describe("deriveGovOpsResponsibilities", () => {
  it("emits the curated role definition", () => {
    const defs = byCat("definition");
    expect(defs.map((r) => r.uuid)).toContain(GOVOPS_DEF);
  });

  it("collapses duplicate per-agent duties by title and accumulates agents", () => {
    const op = byCat("op-duty");
    const rebate = op.filter((r) => /reviews rebate/i.test(r.title));
    expect(rebate).toHaveLength(1);
    expect(rebate[0].docNo).toBe("A.6.1.1.1.2.3"); // lowest doc_no is representative
    expect(new Set(rebate[0].agents)).toEqual(new Set(["Spark"]));
  });

  it("classifies duties op vs core from the edge's declared role", () => {
    expect(byCat("core-duty").some((r) => r.uuid === "duty-core")).toBe(true);
    expect(byCat("op-duty").some((r) => r.uuid === "duty-core")).toBe(false);
  });

  it("attributes duty rows to the GovOps entity for the org filter pills", () => {
    expect(byCat("core-duty").find((r) => r.uuid === "duty-core")?.govops).toBe("Atlas Axis");
    expect(byCat("op-duty").find((r) => r.uuid === "duty-quoted")?.govops).toBe("Soter Labs");
  });

  it("uses the edge's matched quote (link-stripped) as the duty text", () => {
    const row = byCat("op-duty").find((r) => r.uuid === "duty-quoted");
    expect(row?.duty).toBe("GovOps actors carry out operational activities on behalf of Executor Agents.");
  });

  it("falls back to a content snippet for title matches, picking the GovOps bullet", () => {
    const row = byCat("core-duty").find((r) => r.uuid === "duty-title-bullets");
    expect(row?.duty).toBe("…Core GovOps reviews the calculations for accuracy…");
  });

  it("emits one assignment per govops edge with executor + govops entity", () => {
    const asn = byCat("assignment");
    expect(asn).toHaveLength(2); // one operational, one core
    const op = asn.find((r) => r.role === "Operational");
    expect(op?.govops).toBe("Soter Labs");
    expect(op?.executor).toBe("Operational Executor Agent Amatsu");
    expect(op?.agents).toContain("Spark");
    expect(op?.uuid).toBe("assign-doc");
    expect(asn.find((r) => r.role === "Core")?.govops).toBe("Atlas Axis");
  });

  it("includes RP duties declared as GovOps but excludes non-GovOps capacities", () => {
    const ad = byCat("active-data");
    expect(ad.map((r) => r.uuid)).toEqual(["adc-doc"]); // adc-nongov excluded
    expect(ad[0].govops).toBe("Soter Labs");
    expect(ad[0].agent).toBeUndefined(); // A.2.2.* is not under an agent artifact
  });

  it("surfaces process_step_responsible_party_for edges, resolving the GovOps role to its entity", () => {
    const ps = byCat("process-step");
    const op = ps.find((r) => r.uuid === "step-op");
    expect(op?.role).toBe("Operational");
    expect(op?.govops).toBe("Soter Labs");
  });

  it("splits a doc with both operational and core process-step edges into two rows", () => {
    const both = byCat("process-step").filter((r) => r.uuid === "step-both");
    expect(both.map((r) => r.role).sort()).toEqual(["Core", "Operational"]);
    expect(both.find((r) => r.role === "Core")?.govops).toBe("Atlas Axis");
  });

  it("surfaces a doc carrying both a duty_for and a process-step edge exactly once, as a duty", () => {
    const rows = results.filter((r) => r.uuid === "dual");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("op-duty");
  });

  it("does not collapse a shared generic title outside the per-agent-artifact subtree", () => {
    const flowIds = [...byCat("op-duty"), ...byCat("core-duty")]
      .filter((r) => r.title === "Process Flow")
      .map((r) => r.uuid);
    expect(flowIds.sort()).toEqual(["flow-a", "flow-b"]);
  });

  it("never emits an empty duty snippet or title", () => {
    expect(results.filter((r) => !r.title?.trim())).toEqual([]);
    expect(results.filter((r) => !r.duty?.trim() && r.category !== "assignment")).toEqual([]);
  });
});
