// Pins each report's search-haystack field map: which fields are searched and
// which are `hidden` (searched but not rendered in the row, so a hit surfaces
// via the floating aside). These `hidden` flags must track what each table
// actually renders per category — this locks the field definitions so a cell
// change that forgets the flag is caught. (It pins the field-map OUTPUT, not
// the JSX render conditions themselves; keep them in sync by eye.)
import { describe, it, expect } from "vitest";
import type { SearchField } from "../../lib/reportFilter";
import type { OFResponsibility } from "../../lib/facilitatorResponsibilities";
import type { OGResponsibility } from "../../lib/govopsResponsibilities";
import type { RiskRow } from "../../lib/riskAssessmentIndex";
import type { OeaRow } from "../../lib/oeaReport";
import { ofSearchFields } from "./OFCategoryTable";
import { ogSearchFields } from "./OGCategoryTable";
import { riskSearchFields } from "./RiskRulesTable";
import { oeaSearchFields } from "./OeaAssessmentTable";
import { icdSearchFields } from "../../lib/rewardsSearch";
import type { RewardsAgent, RewardsInstance } from "../../lib/rewardsTypes";

// label → hidden?, for the fields that carry a value (empty fields are noise).
const flags = (fields: SearchField[]) =>
  Object.fromEntries(fields.map((f) => [f.label, !!f.hidden]));
const hiddenLabels = (fields: SearchField[]) =>
  fields.filter((f) => f.hidden).map((f) => f.label).sort();
const despaced = (fields: SearchField[], label: string) =>
  !!fields.find((f) => f.label === label)?.despace;

const ofRow = (over: Partial<OFResponsibility>): OFResponsibility => ({
  docNo: "A.1", uuid: "u", title: "T", duty: "D", category: "op-duty",
  agent: "Spark", facilitator: "Sidestream", executor: "Spark Executor", role: "Operational",
  ...over,
});
const ogRow = (over: Partial<OGResponsibility>): OGResponsibility => ({
  docNo: "A.1", uuid: "u", title: "T", duty: "D", category: "op-duty",
  agent: "Spark", govops: "GovAlpha", executor: "Spark Executor", role: "Operational",
  ...over,
});

describe("ofSearchFields visibility per category", () => {
  it("role is always hidden; doc no always visible", () => {
    for (const category of ["universal", "core-facilitator", "op-duty", "assignment", "active-data", "process-step"] as const) {
      const f = flags(ofSearchFields(ofRow({ category })));
      expect(f["role"], category).toBe(true);
      expect(f["doc no"], category).toBe(false);
    }
  });
  it("assignment hides title+duty, shows executor+facilitator+prime", () => {
    const f = flags(ofSearchFields(ofRow({ category: "assignment" })));
    expect(f).toMatchObject({ title: true, duty: true, executor: false, facilitator: false, "prime agent": false });
  });
  it("op-duty shows facilitator+prime, hides executor", () => {
    const f = flags(ofSearchFields(ofRow({ category: "op-duty" })));
    expect(f).toMatchObject({ title: false, facilitator: false, "prime agent": false, executor: true });
  });
  it("universal / core-facilitator hide facilitator AND prime", () => {
    for (const category of ["universal", "core-facilitator"] as const) {
      const f = flags(ofSearchFields(ofRow({ category })));
      expect(f["facilitator"], category).toBe(true);
      expect(f["prime agent"], category).toBe(true);
    }
  });
  it("entity-name fields de-space; text fields do not", () => {
    const f = ofSearchFields(ofRow({ category: "assignment" }));
    expect(despaced(f, "facilitator")).toBe(true);
    expect(despaced(f, "prime agent")).toBe(true);
    expect(despaced(f, "executor")).toBe(true);
    expect(despaced(f, "title")).toBe(false);
    expect(despaced(f, "duty")).toBe(false);
  });
});

describe("ogSearchFields visibility per category", () => {
  it("definition hides govops AND prime", () => {
    const f = flags(ogSearchFields(ogRow({ category: "definition" })));
    expect(f["govops"]).toBe(true);
    expect(f["prime agent"]).toBe(true);
  });
  it("assignment shows executor+govops+prime, hides title+duty", () => {
    const f = flags(ogSearchFields(ogRow({ category: "assignment" })));
    expect(f).toMatchObject({ title: true, duty: true, executor: false, govops: false, "prime agent": false });
  });
  it("op-duty hides govops, shows prime; active-data shows govops", () => {
    expect(flags(ogSearchFields(ogRow({ category: "op-duty" })))["govops"]).toBe(true);
    expect(flags(ogSearchFields(ogRow({ category: "active-data" })))["govops"]).toBe(false);
  });
});

describe("risk / oea / icd field shapes", () => {
  it("riskSearchFields hides the source paragraph and owning-agent fields", () => {
    const row = {
      candidate: { docNo: "A.6.1", title: "Rule", quote: "The rule text.", agents: ["Spark", "Grove"] },
      triage: { description: "summary" },
    } as unknown as RiskRow;
    const f = riskSearchFields(row);
    expect(f.map((x) => x.label)).toEqual(["doc no", "title", "summary", "source paragraph", "doc is owned by agent matching"]);
    expect(hiddenLabels(f)).toEqual(["doc is owned by agent matching", "source paragraph"]);
    expect(despaced(f, "doc is owned by agent matching")).toBe(true);
  });
  it("oeaSearchFields hides only the covered-primes field", () => {
    const row = { task: { docNo: "A.2", title: "Task", assessedText: "do the thing", agents: ["Spark"] } } as unknown as OeaRow;
    const f = oeaSearchFields(row);
    expect(hiddenLabels(f)).toEqual(["covered primes"]);
    expect(despaced(f, "covered primes")).toBe(true);
  });
  it("icdSearchFields hides tracking + params; agent/partner de-space", () => {
    const agent = { name: "Spark", chain: { executor: { name: "Spark Exec" }, govops: { name: "GovAlpha" } } } as unknown as RewardsAgent;
    const inst = {
      status: "Active", name: "SkyBase DR", docNo: "A.6.1.1", partnerName: "Sky Base",
      tracking: "methodology text", params: { rate: ["5%", "u", "A.6.1.1.1"] },
    } as unknown as RewardsInstance;
    const f = icdSearchFields(agent, inst);
    expect(hiddenLabels(f)).toEqual(["params", "tracking"]);
    expect(despaced(f, "agent")).toBe(true);
    expect(despaced(f, "partner")).toBe(true);
    // params tuple renders as "key: value" (first tuple element only).
    expect(f.find((x) => x.label === "params")?.value).toBe("rate: 5%");
  });
});
