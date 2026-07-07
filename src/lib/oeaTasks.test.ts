// Deterministic tests for the OEA task-universe enumeration using synthetic
// fixtures. Scope rules under test come from docs/oea-assessment-rubric.md:
// operational slices only, Core-side excluded, one row per task with
// cross-source dedupe. Real-artifact coverage: oeaTasks.artifact.test.ts.

import { describe, it, expect } from "vitest";
import type { AtlasNode, GraphEntity, RelationEdge } from "../types";
import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import { enumerateOeaTasks, taskKeyFor, normalizeAssessedText } from "./oeaTasks";

function node(p: Partial<AtlasNode> & Pick<AtlasNode, "id" | "doc_no" | "title">): AtlasNode {
  return { type: "Core", depth: 4, parentId: null, content: "", order: 0, addressRefs: [], ...p } as AtlasNode;
}

const docs: Record<string, AtlasNode> = {};
for (const n of [
  node({ id: "9fb7f1cc-f60b-4195-892d-5e540f969973", doc_no: "A.6.1.1", title: "List Of Prime Agent Artifacts" }),
  node({ id: "prime-doc", doc_no: "A.6.1.1.1", title: "Prime Agent Spark" }),
  node({ id: "duty-gov-op", doc_no: "A.2.2.1.5", title: "Rebate Review", content: "The Operational GovOps reviews the rebate." }),
  node({ id: "duty-gov-core", doc_no: "A.2.2.1.6", title: "Input Validation", content: "Core GovOps validates the inputs." }),
  node({ id: "duty-fac-universal", doc_no: "A.1.7.9", title: "Interpretation Documentation", content: "Facilitators must document their interpretations." }),
  node({ id: "duty-fac-core", doc_no: "A.1.2.3", title: "Conflict Resolution", content: "The Core Facilitator resolves appeals." }),
  // Same doc tasked for BOTH operational roles — must merge to one task.
  node({ id: "duty-both", doc_no: "A.3.1.1", title: "Shared Escalation", content: "The Operational GovOps and the Operational Facilitator escalate the incident." }),
  // Direct Executor Agent duties: operational, bare (universal), core (excluded).
  node({ id: "duty-exec-op", doc_no: "A.1.14.5", title: "Payment Execution", content: "The Operational Executor Agent executes the payment." }),
  node({ id: "duty-exec-bare", doc_no: "A.1.14.6", title: "Artifact Maintenance", content: "The Executor Agent maintains its Agent Artifact." }),
  node({ id: "duty-exec-core", doc_no: "A.1.14.7", title: "Council Reporting", content: "The Core Executor Agent reports to the council." }),
  // Executor duty replicated under two agent artifacts — title-collapses.
  node({ id: "exec-copy-2", doc_no: "A.6.1.1.2.4.1", parentId: "9fb7f1cc-f60b-4195-892d-5e540f969973", title: "Weekly Settlement", content: "The Operational Executor Agent settles weekly." }),
  node({ id: "exec-copy-1", doc_no: "A.6.1.1.1.4.1", parentId: "9fb7f1cc-f60b-4195-892d-5e540f969973", title: "Weekly Settlement", content: "The Operational Executor Agent settles weekly." }),
  // Active data + process-step (one [automated]) + assignments.
  node({ id: "adc-doc", doc_no: "A.6.1.1.1.3.9.1", type: "Active Data Controller", title: "Delegate Roster", content: "The Responsible Party is the Operational GovOps." }),
  // Active data whose RP is declared Core-side — must be EXCLUDED from the
  // OEA universe (the OEA never holds this task, only the Core role does).
  node({ id: "adc-core-gov", doc_no: "A.1.9.1.2.2", type: "Active Data Controller", title: "Emergency Contact List", content: "The Responsible Party is the Core GovOps." }),
  node({ id: "adc-core-fac", doc_no: "A.1.6.1.5", type: "Active Data Controller", title: "Escalation Contact", content: "The Responsible Party is the Core Facilitator." }),
  node({ id: "step-auto", doc_no: "A.2.2.9.7.7", title: "Roster Update", content: "The Document is updated as follows:\n\n- Responsible Party: Operational GovOps [automated]" }),
  node({ id: "assign-op", doc_no: "A.6.1.2.1.3", title: "GovOps", content: "The Operational GovOps for Operational Executor Agent Amatsu is Soter Labs." }),
  node({ id: "assign-core", doc_no: "A.6.2.2.1.3", title: "GovOps", content: "The Core Council GovOps is Atlas Axis." }),
]) docs[n.id] = n;

const atlas: AtlasBundle = { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: null };

const participants: GraphEntity[] = [
  { id: "soter", slug: "soter-labs", name: "Soter Labs", et: "govops_org", st: null, did: null },
  { id: "endgame", slug: "endgame-edge", name: "Endgame Edge", et: "facilitator_org", st: null, did: null },
  { id: "exec", slug: "amatsu", name: "Operational Executor Agent Amatsu", et: "agent", st: "operational_executor", did: null },
  { id: "exec2", slug: "hoku", name: "Operational Executor Agent Hoku", et: "agent", st: "operational_executor", did: null },
  { id: "prime", slug: "spark", name: "Spark", et: "agent", st: "prime", did: "prime-doc" },
];

const dutyMeta = (role: string, quote: string | null) =>
  JSON.stringify({ role_declared: role, match: quote ? "active" : "title", quote });

const edges: RelationEdge[] = [
  { f: "soter", ft: "entity", t: "exec", tt: "entity", e: "operational_govops_for", s: ["A.6.1.2.1.3"] },
  { f: "soter", ft: "entity", t: "exec", tt: "entity", e: "core_govops_for", s: ["A.6.2.2.1.3"] },
  { f: "exec", ft: "entity", t: "prime", tt: "entity", e: "operational_executor_agent_for", s: ["A.6.1.1.1"] },
  { f: "soter", ft: "entity", t: "duty-gov-op", tt: "doc", e: "duty_for", s: ["A.2.2.1.5"], m: dutyMeta("Operational GovOps", "The Operational GovOps reviews the rebate.") },
  { f: "soter", ft: "entity", t: "duty-gov-core", tt: "doc", e: "duty_for", s: ["A.2.2.1.6"], m: dutyMeta("Core GovOps", "Core GovOps validates the inputs.") },
  { f: "endgame", ft: "entity", t: "duty-fac-universal", tt: "doc", e: "duty_for", s: ["A.1.7.9"], m: dutyMeta("Facilitator", "Facilitators must document their interpretations.") },
  { f: "endgame", ft: "entity", t: "duty-fac-core", tt: "doc", e: "duty_for", s: ["A.1.2.3"], m: dutyMeta("Core Facilitator", "The Core Facilitator resolves appeals.") },
  { f: "soter", ft: "entity", t: "duty-both", tt: "doc", e: "duty_for", s: ["A.3.1.1"], m: dutyMeta("Operational GovOps", "The Operational GovOps and the Operational Facilitator escalate the incident.") },
  { f: "endgame", ft: "entity", t: "duty-both", tt: "doc", e: "duty_for", s: ["A.3.1.1"], m: dutyMeta("Operational Facilitator", "The Operational GovOps and the Operational Facilitator escalate the incident.") },
  { f: "exec", ft: "entity", t: "duty-exec-op", tt: "doc", e: "duty_for", s: ["A.1.14.5"], m: dutyMeta("Operational Executor Agent", "The Operational Executor Agent executes the payment.") },
  // Bare Executor Agent duty fans out to both executor entities.
  { f: "exec", ft: "entity", t: "duty-exec-bare", tt: "doc", e: "duty_for", s: ["A.1.14.6"], m: dutyMeta("Executor Agent", "The Executor Agent maintains its Agent Artifact.") },
  { f: "exec2", ft: "entity", t: "duty-exec-bare", tt: "doc", e: "duty_for", s: ["A.1.14.6"], m: dutyMeta("Executor Agent", "The Executor Agent maintains its Agent Artifact.") },
  { f: "exec", ft: "entity", t: "duty-exec-core", tt: "doc", e: "duty_for", s: ["A.1.14.7"], m: dutyMeta("Core Executor Agent", "The Core Executor Agent reports to the council.") },
  // Agent-artifact copies, deliberately added higher doc_no first (title-only, no quote).
  { f: "exec", ft: "entity", t: "exec-copy-2", tt: "doc", e: "duty_for", s: ["A.6.1.1.2.4.1"], m: dutyMeta("Operational Executor Agent", null) },
  { f: "exec", ft: "entity", t: "exec-copy-1", tt: "doc", e: "duty_for", s: ["A.6.1.1.1.4.1"], m: dutyMeta("Operational Executor Agent", null) },
  { f: "soter", ft: "entity", t: "adc-doc", tt: "doc", e: "responsible_party_for", s: ["A.6.1.1.1.3.9.1"], m: JSON.stringify({ role_declared: "Operational GovOps", resolution: "chain" }) },
  { f: "soter", ft: "entity", t: "adc-core-gov", tt: "doc", e: "responsible_party_for", s: ["A.1.9.1.2.2"], m: JSON.stringify({ role_declared: "Core GovOps", resolution: "direct" }) },
  { f: "endgame", ft: "entity", t: "adc-core-fac", tt: "doc", e: "responsible_party_for", s: ["A.1.6.1.5"], m: JSON.stringify({ role_declared: "Core Facilitator", resolution: "direct" }) },
  { f: "soter", ft: "entity", t: "step-auto", tt: "doc", e: "process_step_responsible_party_for", s: ["A.2.2.9.7.7"], m: JSON.stringify({ role_declared: "Operational GovOps [automated]", resolution: "chain" }) },
];

const graph: GraphData = { participants, instances: [], invocations: [], primitives: [], edges };
const tasks = enumerateOeaTasks(atlas, graph);
const byUuid = (u: string) => tasks.filter((t) => t.uuid === u);

describe("enumerateOeaTasks", () => {
  it("includes operational duties from all three sources, excludes Core-side", () => {
    expect(byUuid("duty-gov-op")).toHaveLength(1);
    expect(byUuid("duty-fac-universal")).toHaveLength(1);
    expect(byUuid("duty-exec-op")).toHaveLength(1);
    for (const excluded of ["duty-gov-core", "duty-fac-core", "duty-exec-core"])
      expect(byUuid(excluded)).toEqual([]);
  });

  it("merges a doc tasked for both operational roles into one task with both sources", () => {
    const rows = byUuid("duty-both");
    expect(rows).toHaveLength(1);
    expect(new Set(rows[0].sources)).toEqual(new Set(["govops", "facilitator"]));
  });

  it("collapses bare Executor Agent fan-out edges to one universal task", () => {
    const rows = byUuid("duty-exec-bare");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("universal");
    expect(rows[0].sources).toEqual(["executor"]);
  });

  it("title-collapses agent-artifact executor copies onto the lowest doc_no", () => {
    const rows = tasks.filter((t) => t.title === "Weekly Settlement");
    expect(rows).toHaveLength(1);
    expect(rows[0].uuid).toBe("exec-copy-1");
    expect(rows[0].agents).toEqual(["Spark"]);
    expect(rows[0].quoted).toBe(false); // title-only match rates the snippet
  });

  it("carries active-data, [automated] process-steps, and operational assignments only", () => {
    expect(byUuid("adc-doc")[0]?.category).toBe("active-data");
    const step = byUuid("step-auto")[0];
    expect(step?.category).toBe("process-step");
    expect(step?.automated).toBe(true);
    expect(byUuid("assign-op")[0]?.category).toBe("assignment");
    expect(byUuid("assign-core")).toEqual([]); // Core-role assignment excluded
  });

  it("excludes active-data rows whose Responsible Party is declared Core", () => {
    expect(byUuid("adc-core-gov")).toEqual([]);
    expect(byUuid("adc-core-fac")).toEqual([]);
  });

  it("marks quote-backed tasks quoted and sorts by doc_no", () => {
    expect(byUuid("duty-gov-op")[0].quoted).toBe(true);
    const docNos = tasks.map((t) => t.docNo);
    expect(docNos).toEqual([...docNos].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  });

  it("has no duplicate taskKeys", () => {
    expect(new Set(tasks.map((t) => t.taskKey)).size).toBe(tasks.length);
  });
});

describe("taskKeyFor / normalizeAssessedText", () => {
  it("keys agent-artifact rows by title+category, others by uuid", () => {
    expect(taskKeyFor({ uuid: "x", title: " Weekly Settlement ", category: "op-duty", collapseByTitle: true }))
      .toBe("t:weekly settlement|op-duty");
    expect(taskKeyFor({ uuid: "x", title: "Weekly Settlement", category: "op-duty" }))
      .toBe("u:x");
  });

  it("normalizes whitespace only", () => {
    expect(normalizeAssessedText("  The  Operational\nGovOps   reviews. ")).toBe("The Operational GovOps reviews.");
  });
});
