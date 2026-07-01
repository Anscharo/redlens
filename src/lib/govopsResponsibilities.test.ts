// Deterministic tests for deriveGovOpsResponsibilities using synthetic fixtures.
// Unlike the artifact-reading report tests, these construct a minimal docs +
// graph so the discovery/classification/dedup logic is exercised without a build.

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
  // Core duty discovered from content (title has GovOps too).
  node({ id: "duty-core", doc_no: "A.2.2.1.1.13", title: "Core GovOps Validates Executor Accord Primitive Inputs", content: "Core GovOps reviews the inputs to the Executor Accord Primitive to ensure validity." }),
  // Assignment doc (excluded from duty scan by its structural doc_no).
  node({ id: "assign-doc", doc_no: "A.6.1.2.1.2", title: "Operational GovOps", content: "Operational GovOps for Operational Executor Agent Amatsu is Soter Labs." }),
  // Active Data controller whose Responsible Party is declared as GovOps.
  node({ id: "adc-doc", doc_no: "A.2.2.4.1.2.1.1", type: "Active Data Controller", title: "Integrator Program Applications", content: "The Responsible Party is Operational GovOps." }),
  // Active Data controller where Soter Labs is RP in a NON-GovOps capacity
  // (named directly) — must be EXCLUDED from GovOps responsibilities.
  node({ id: "adc-nongov", doc_no: "A.2.2.4.9.9.1", type: "Active Data Controller", title: "List Of Auxiliary Accounts", content: "The Responsible Party is Soter Labs." }),
  // Bare "GovOps" (no Operational/Core qualifier) as an actor, title silent —
  // must still be discovered via the content scan.
  node({ id: "duty-bare", doc_no: "A.1.14.4.6.1.1", title: "Executor Agent Duties", content: "GovOps actors carry out operational activities on behalf of Executor Agents." }),
  // Shape #3 — process-step "Update" docs with a bulleted Responsible Party field.
  node({ id: "step-op", doc_no: "A.2.2.9.2.2.3.3.4.2.1", title: "Primitive Hub Document Update", content: "The Document in the Agent Artifact is updated as follows:\n\n- Responsible Party: Operational GovOps\n- Triggers: none." }),
  // Two op steps in one doc (lowercase 'party', [automated]) → must collapse to one row.
  node({ id: "step-multi", doc_no: "A.2.2.9.1.2.3.1.4.2", title: "Agent Artifact Updates", content: "- Responsible party: Operational GovOps [automated]\n- more\n- Responsible party: Operational GovOps [automated]" }),
  // One doc with both an op step and a core step → two rows.
  node({ id: "step-both", doc_no: "A.2.2.9.9.9", title: "Combined Update", content: "- Responsible Party: Operational GovOps\n- Responsible Party: Core GovOps" }),
  // Noise: a doc merely cross-referencing GovOps (no obligation verb) — excluded.
  node({ id: "noise", doc_no: "A.9.9", title: "Some Section", content: "The Operational Facilitator and Operational GovOps for Ozone are specified in A.6.1.2.2." }),
]) docs[n.id] = n;

const atlas: AtlasBundle = { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: null };

const participants: GraphEntity[] = [
  { id: "soter", slug: "soter-labs", name: "Soter Labs", et: "govops_org", st: null, did: null },
  { id: "atlas-axis", slug: "atlas-axis", name: "Atlas Axis", et: "govops_org", st: null, did: null },
  { id: "exec", slug: "amatsu", name: "Operational Executor Agent Amatsu", et: "agent", st: "operational_executor", did: null },
  { id: "core-exec", slug: "cc-exec-1", name: "Core Council Executor Agent 1", et: "agent", st: "core_executor", did: null },
  { id: "prime", slug: "spark", name: "Spark", et: "agent", st: "prime", did: "prime-doc" },
];

const edges: RelationEdge[] = [
  { f: "soter", ft: "entity", t: "exec", tt: "entity", e: "operational_govops_for", s: ["A.6.1.2.1.2"] },
  { f: "atlas-axis", ft: "entity", t: "core-exec", tt: "entity", e: "core_govops_for", s: ["A.6.1.2.3.2"] },
  { f: "exec", ft: "entity", t: "prime", tt: "entity", e: "operational_executor_agent_for", s: ["A.6.1.1.1"] },
  { f: "soter", ft: "entity", t: "adc-doc", tt: "doc", e: "responsible_party_for", s: ["A.2.2.4.1.2.1.1"], m: JSON.stringify({ role_declared: "Operational GovOps", resolution: "chain" }) },
  // Soter Labs named directly (non-GovOps capacity) — excluded.
  { f: "soter", ft: "entity", t: "adc-nongov", tt: "doc", e: "responsible_party_for", s: ["A.2.2.4.9.9.1"], m: JSON.stringify({ role_declared: "Soter Labs", resolution: "direct" }) },
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

  it("classifies Core GovOps duties separately", () => {
    expect(byCat("core-duty").some((r) => r.uuid === "duty-core")).toBe(true);
    expect(byCat("op-duty").some((r) => r.uuid === "duty-core")).toBe(false);
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

  it("surfaces process-step Responsible Party fields, resolving the GovOps role to its entity", () => {
    const ps = byCat("process-step");
    const op = ps.find((r) => r.uuid === "step-op");
    expect(op?.role).toBe("Operational");
    expect(op?.govops).toBe("Soter Labs");
  });

  it("collapses multiple same-role process-step fields in one doc to a single row", () => {
    const multi = byCat("process-step").filter((r) => r.uuid === "step-multi");
    expect(multi).toHaveLength(1);
    expect(multi[0].role).toBe("Operational");
  });

  it("splits a doc with both operational and core process-step fields into two rows", () => {
    const both = byCat("process-step").filter((r) => r.uuid === "step-both");
    expect(both.map((r) => r.role).sort()).toEqual(["Core", "Operational"]);
    expect(both.find((r) => r.role === "Core")?.govops).toBe("Atlas Axis");
  });

  it("does not list a process-step doc that is also a prose duty twice", () => {
    // duty-bare is a duty (bare GovOps verb) and has no RP field → stays a duty only.
    expect(byCat("process-step").some((r) => r.uuid === "duty-bare")).toBe(false);
  });

  it("discovers bare 'GovOps <verb>' duties even when the title is silent", () => {
    const dutyIds = [...byCat("op-duty"), ...byCat("core-duty")].map((r) => r.uuid);
    expect(dutyIds).toContain("duty-bare");
  });

  it("excludes bare cross-references and assignment docs from duty discovery", () => {
    const dutyIds = [...byCat("op-duty"), ...byCat("core-duty")].map((r) => r.uuid);
    expect(dutyIds).not.toContain("noise");
    expect(dutyIds).not.toContain("assign-doc");
  });

  it("never emits an empty duty snippet or title", () => {
    expect(results.filter((r) => !r.title?.trim())).toEqual([]);
    expect(results.filter((r) => !r.duty?.trim() && r.category !== "assignment")).toEqual([]);
  });
});
