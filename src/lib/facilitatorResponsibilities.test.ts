// Deterministic tests for deriveFacilitatorResponsibilities using synthetic
// fixtures. Duty DISCOVERY (vocabulary, guards) lives in build-graph and is
// tested in scripts_tests/graph-duties.test.ts — here duties arrive as duty_for
// edges, including the fan-out shape (one edge per role holder for duties that
// bind more than one facilitator org).

import { describe, it, expect } from "vitest";
import type { AtlasNode, GraphEntity, RelationEdge } from "../types";
import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import { deriveFacilitatorResponsibilities, facilitatorRowsToCSV, type OFResponsibility } from "./facilitatorResponsibilities";

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
  node({ id: "prime-doc", doc_no: "A.6.1.1.1", title: "Prime Agent Spark" }),
  // Universal duty — fanned out to all three holders by build-graph.
  node({ id: "duty-universal", doc_no: "A.1.7.9", title: "Governance Process And Interaction Documentation", content: "Facilitators must document their interpretations as Action Tenets." }),
  // Core Facilitator duty.
  node({ id: "duty-core", doc_no: "A.1.2.3", title: "Conflict Resolution", content: "The Core Facilitator is responsible for evaluating and resolving community appeals." }),
  // Operational duty replicated under two agent artifacts — must collapse.
  node({ id: "duty-op-1", doc_no: "A.6.1.1.1.2.2", title: "Root Edit Proposal Review By Operational Facilitator", content: "The Operational Facilitator reviews the proposal." }),
  node({ id: "duty-op-2", doc_no: "A.6.1.1.2.2.2", title: "Root Edit Proposal Review By Operational Facilitator", content: "The Operational Facilitator reviews the proposal." }),
  // Same structural title under two agent artifacts but genuinely DIFFERENT
  // duties — must NOT collapse (see govopsResponsibilities: the "Modification"
  // bug swallowed distinct rows and misattributed their agents).
  node({ id: "duty-div-1", doc_no: "A.6.1.1.1.9.5", title: "Modification", content: "The Operational Facilitator can change the signers of the Alpha Multisig." }),
  node({ id: "duty-div-2", doc_no: "A.6.1.1.2.9.5", title: "Modification", content: "The Operational Facilitator can change the signers of the Beta Multisig." }),
  // Operational duty outside an artifact context — fans out to BOTH op orgs.
  node({ id: "duty-op-shared", doc_no: "A.3.7.1.9", title: "Signer Change Authority", content: "The Operational Facilitator can change the signers of the multisig." }),
  // Assignment doc (excluded from duty discovery by build-graph).
  node({ id: "assign-doc", doc_no: "A.6.1.2.1.3", title: "Operational Facilitator", content: "The Operational Facilitator for Operational Executor Agent Amatsu is Endgame Edge." }),
  // ADC whose Responsible Party is declared as a Facilitator role.
  node({ id: "adc-doc", doc_no: "A.6.1.1.1.3.9.1", type: "Active Data Controller", title: "Delegate Roster", content: "The Responsible Party is the Operational Facilitator." }),
  // ADC where a facilitator org is RP in a NON-facilitator capacity — excluded.
  node({ id: "adc-nonfac", doc_no: "A.2.2.4.9.9.1", type: "Active Data Controller", title: "List Of Auxiliary Accounts", content: "The Responsible Party is Endgame Edge." }),
  // ADC whose Responsible Party is declared Core Facilitator — included here
  // (this report covers both), tagged role: "Core" for OEA-universe filtering.
  node({ id: "adc-core", doc_no: "A.1.6.1.5", type: "Active Data Controller", title: "Escalation Contact", content: "The Responsible Party is the Core Facilitator." }),
  // Process-step update doc with a facilitator RP.
  node({ id: "step-op", doc_no: "A.2.2.9.7.7", title: "Roster Update", content: "The Document is updated as follows:\n\n- Responsible Party: Operational Facilitator" }),
  // GovOps-declared duty — a different acting role, must NOT appear here.
  node({ id: "duty-gov", doc_no: "A.2.2.1.1.13", title: "Core GovOps Validates Inputs", content: "Core GovOps reviews the inputs." }),
]) docs[n.id] = n;

const atlas: AtlasBundle = { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: null };

const participants: GraphEntity[] = [
  { id: "endgame", slug: "endgame-edge", name: "Endgame Edge", et: "facilitator_org", st: null, did: null },
  { id: "redline", slug: "redline-facilitation-group", name: "Redline Facilitation Group", et: "facilitator_org", st: null, did: null },
  { id: "jansky", slug: "jansky", name: "JanSky", et: "facilitator_org", st: null, did: null },
  { id: "soter", slug: "soter-labs", name: "Soter Labs", et: "govops_org", st: null, did: null },
  { id: "exec", slug: "amatsu", name: "Operational Executor Agent Amatsu", et: "agent", st: "operational_executor", did: null },
  { id: "prime", slug: "spark", name: "Spark", et: "agent", st: "prime", did: "prime-doc" },
];

const dutyMeta = (role: string, quote: string | null, match = quote ? "active" : "title") =>
  JSON.stringify({ role_declared: role, match, quote });

const edges: RelationEdge[] = [
  { f: "endgame", ft: "entity", t: "exec", tt: "entity", e: "operational_facilitator_for", s: ["A.6.1.2.1.3"] },
  { f: "exec", ft: "entity", t: "prime", tt: "entity", e: "operational_executor_agent_for", s: ["A.6.1.1.1"] },
  // Universal duty — one edge per holder (build-graph fan-out).
  { f: "endgame", ft: "entity", t: "duty-universal", tt: "doc", e: "duty_for", s: ["A.1.7.9"], m: dutyMeta("Facilitator", "Facilitators must document their interpretations as Action Tenets.") },
  { f: "redline", ft: "entity", t: "duty-universal", tt: "doc", e: "duty_for", s: ["A.1.7.9"], m: dutyMeta("Facilitator", "Facilitators must document their interpretations as Action Tenets.") },
  { f: "jansky", ft: "entity", t: "duty-universal", tt: "doc", e: "duty_for", s: ["A.1.7.9"], m: dutyMeta("Facilitator", "Facilitators must document their interpretations as Action Tenets.") },
  // Core duty — single holder.
  { f: "jansky", ft: "entity", t: "duty-core", tt: "doc", e: "duty_for", s: ["A.1.2.3"], m: dutyMeta("Core Facilitator", "The Core Facilitator is responsible for evaluating and resolving community appeals.") },
  // Per-agent-artifact op duty, two copies (chain-resolved to one org each).
  { f: "endgame", ft: "entity", t: "duty-op-1", tt: "doc", e: "duty_for", s: ["A.6.1.1.1.2.2"], m: dutyMeta("Operational Facilitator", null) },
  { f: "endgame", ft: "entity", t: "duty-op-2", tt: "doc", e: "duty_for", s: ["A.6.1.1.2.2.2"], m: dutyMeta("Operational Facilitator", null) },
  { f: "endgame", ft: "entity", t: "duty-div-1", tt: "doc", e: "duty_for", s: ["A.6.1.1.1.9.5"], m: dutyMeta("Operational Facilitator", "The Operational Facilitator can change the signers of the Alpha Multisig.") },
  { f: "endgame", ft: "entity", t: "duty-div-2", tt: "doc", e: "duty_for", s: ["A.6.1.1.2.9.5"], m: dutyMeta("Operational Facilitator", "The Operational Facilitator can change the signers of the Beta Multisig.") },
  // Contextless op duty — fanned out to both operational orgs.
  { f: "endgame", ft: "entity", t: "duty-op-shared", tt: "doc", e: "duty_for", s: ["A.3.7.1.9"], m: dutyMeta("Operational Facilitator", "The Operational Facilitator can change the signers of the multisig.") },
  { f: "redline", ft: "entity", t: "duty-op-shared", tt: "doc", e: "duty_for", s: ["A.3.7.1.9"], m: dutyMeta("Operational Facilitator", "The Operational Facilitator can change the signers of the multisig.") },
  // GovOps-declared duty — filtered out by role.
  { f: "soter", ft: "entity", t: "duty-gov", tt: "doc", e: "duty_for", s: ["A.2.2.1.1.13"], m: dutyMeta("Core GovOps", "Core GovOps reviews the inputs.") },
  // Active data: declared-as-facilitator vs named-directly.
  { f: "endgame", ft: "entity", t: "adc-doc", tt: "doc", e: "responsible_party_for", s: ["A.6.1.1.1.3.9.1"], m: JSON.stringify({ role_declared: "Operational Facilitator", resolution: "chain" }) },
  { f: "endgame", ft: "entity", t: "adc-nonfac", tt: "doc", e: "responsible_party_for", s: ["A.2.2.4.9.9.1"], m: JSON.stringify({ role_declared: "Endgame Edge", resolution: "direct" }) },
  { f: "jansky", ft: "entity", t: "adc-core", tt: "doc", e: "responsible_party_for", s: ["A.1.6.1.5"], m: JSON.stringify({ role_declared: "Core Facilitator", resolution: "direct" }) },
  // Process-step RP edge.
  { f: "endgame", ft: "entity", t: "step-op", tt: "doc", e: "process_step_responsible_party_for", s: ["A.2.2.9.7.7"], m: JSON.stringify({ role_declared: "Operational Facilitator", resolution: "chain", automated: false }) },
];

const graph: GraphData = { participants, instances: [], invocations: [], primitives: [], edges };

const results = deriveFacilitatorResponsibilities(atlas, graph);
const byCat = (c: string) => results.filter((r) => r.category === c);

describe("deriveFacilitatorResponsibilities", () => {
  it("collapses a fanned-out universal duty to one row carrying every holder", () => {
    const rows = byCat("universal").filter((r) => r.uuid === "duty-universal");
    expect(rows).toHaveLength(1);
    expect(new Set(rows[0].facilitators)).toEqual(new Set(["Endgame Edge", "Redline Facilitation Group", "JanSky"]));
  });

  it("classifies duties by the declared role, not the holding entity", () => {
    expect(byCat("core-facilitator").some((r) => r.uuid === "duty-core")).toBe(true);
    expect(byCat("op-duty").some((r) => r.uuid === "duty-core")).toBe(false);
  });

  it("collapses per-agent-artifact duplicates by title, accumulating agents", () => {
    const rows = byCat("op-duty").filter((r) => /root edit proposal review/i.test(r.title));
    expect(rows).toHaveLength(1);
    expect(rows[0].docNo).toBe("A.6.1.1.1.2.2"); // lowest doc_no is representative
    expect(rows[0].agents).toEqual(["Spark"]);
  });

  it("does not collapse same-title agent-artifact docs whose duties genuinely differ", () => {
    const rows = byCat("op-duty").filter((r) => r.title === "Modification");
    expect(rows.map((r) => r.uuid).sort()).toEqual(["duty-div-1", "duty-div-2"]);
  });

  it("collapses a contextless op duty fanned to both orgs into one row", () => {
    const rows = byCat("op-duty").filter((r) => r.uuid === "duty-op-shared");
    expect(rows).toHaveLength(1);
    expect(new Set(rows[0].facilitators)).toEqual(new Set(["Endgame Edge", "Redline Facilitation Group"]));
  });

  it("ignores duty_for edges declared for non-Facilitator acting roles", () => {
    expect(results.find((r) => r.uuid === "duty-gov")).toBeUndefined();
  });

  it("emits one assignment per facilitator edge with executor + facilitator entity", () => {
    const asn = byCat("assignment");
    expect(asn).toHaveLength(1);
    expect(asn[0].facilitator).toBe("Endgame Edge");
    expect(asn[0].executor).toBe("Operational Executor Agent Amatsu");
    expect(asn[0].role).toBe("Operational");
    expect(asn[0].agents).toContain("Spark");
    expect(asn[0].uuid).toBe("assign-doc");
  });

  it("includes RP duties declared as Facilitator but excludes non-facilitator capacities", () => {
    const ad = byCat("active-data");
    expect(ad.map((r) => r.uuid).sort()).toEqual(["adc-core", "adc-doc"]); // adc-nonfac excluded
    const op = ad.find((r) => r.uuid === "adc-doc");
    expect(op?.facilitator).toBe("Endgame Edge");
    expect(op?.agent).toBe("Spark");
    expect(op?.role).toBe("Operational");
  });

  it("tags active-data rows declared Core Facilitator with role: Core", () => {
    const ad = byCat("active-data").find((r) => r.uuid === "adc-core");
    expect(ad?.role).toBe("Core");
    expect(ad?.facilitator).toBe("JanSky");
  });

  it("surfaces facilitator process-step edges with the resolved entity", () => {
    const ps = byCat("process-step");
    expect(ps.map((r) => r.uuid)).toEqual(["step-op"]);
    expect(ps[0].role).toBe("Operational");
    expect(ps[0].facilitator).toBe("Endgame Edge");
  });

  it("never emits an empty duty snippet or title", () => {
    expect(results.filter((r) => !r.title?.trim())).toEqual([]);
    expect(results.filter((r) => !r.duty?.trim() && r.category !== "assignment")).toEqual([]);
  });
});

describe("facilitatorRowsToCSV", () => {
  it("emits a header, maps the category label, and joins agents/facilitators with '; '", () => {
    const rows: OFResponsibility[] = [
      { docNo: "A.1.1", uuid: "u1", title: "Assign", duty: "", category: "assignment", executor: "Ozone", facilitator: "Steakhouse", role: "Operational", agents: ["Amatsu", "Ozone"] },
      { docNo: "A.1.7.1", uuid: "u2", title: "Universal duty", duty: "must do the thing", category: "universal", facilitators: ["Steakhouse", "TechOps"] },
    ];
    const lines = facilitatorRowsToCSV(rows).split("\r\n");
    expect(lines[0]).toBe('"Doc No","Title","Category","Duty","Agents","Facilitators","Executor","Role"');
    expect(lines[1]).toContain('"Amatsu; Ozone"');
    expect(lines[1]).toContain('"Facilitator Assignments (per Executor Agent)"');
    expect(lines[2]).toContain('"Steakhouse; TechOps"');
    expect(lines[2]).toContain('"Universal — all Facilitators"');
  });
});
