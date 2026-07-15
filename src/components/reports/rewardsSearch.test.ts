import { describe, it, expect } from "vitest";
import { parseReportQuery } from "../../lib/reportFilter";
import { icdSearchFields, filterPrimitive, filterRewardsAgents } from "./rewardsSearch";
import type { AgentPrimitive, RewardsAgent, RewardsInstance } from "../../lib/rewardsTypes";

const inst = (over: Partial<RewardsInstance>): RewardsInstance => ({
  id: over.id ?? over.name ?? "i", docNo: "A.6.1.1", name: "Instance", status: "Active", ...over,
});
const prim = (active: RewardsInstance[], over: Partial<AgentPrimitive> = {}): AgentPrimitive => ({
  kind: "DR", primitiveId: "p", primitiveDocNo: "A.6.1", globalActivation: "Active",
  active, suspended: [], completed: [], invocations: [], ...over,
});
const agent = (name: string, dr: AgentPrimitive | null, ib: AgentPrimitive | null = null): RewardsAgent => ({
  name, docNoPrefix: "A.6.1", agentEntity: null, chain: null, dr, ib,
});

describe("filterPrimitive", () => {
  it("narrows buckets to matching ICDs", () => {
    const p = prim([inst({ name: "SkyBase weekly" }), inst({ name: "Grove monthly" })]);
    const out = filterPrimitive(agent("Spark", p), p, parseReportQuery("skybase"));
    expect(out?.active.map((i) => i.name)).toEqual(["SkyBase weekly"]);
  });

  it("returns null when nothing in the primitive matches", () => {
    const p = prim([inst({ name: "Grove monthly" })]);
    expect(filterPrimitive(agent("Spark", p), p, parseReportQuery("skybase"))).toBeNull();
  });

  it("matches on a hidden field (reward address) too", () => {
    const p = prim([inst({ name: "IB one", rewardAddress: "0xabc123" })]);
    const out = filterPrimitive(agent("Spark", p), p, parseReportQuery("0xabc123"));
    expect(out?.active).toHaveLength(1);
  });

  it("filters across all four buckets, not just active", () => {
    const p = prim([inst({ name: "keep A" })], {
      completed: [inst({ name: "keep C" }), inst({ name: "drop C" })],
    });
    const out = filterPrimitive(agent("Spark", p), p, parseReportQuery("keep"));
    expect(out?.active).toHaveLength(1);
    expect(out?.completed.map((i) => i.name)).toEqual(["keep C"]);
  });
});

describe("filterRewardsAgents", () => {
  const spark = agent("Spark", prim([inst({ name: "SkyBase DR" })]));
  const grove = agent("Grove", prim([inst({ name: "Grove DR" })]));

  it("returns the same array identity for an empty query", () => {
    const agents = [spark, grove];
    expect(filterRewardsAgents(agents, parseReportQuery(""))).toBe(agents);
  });

  it("drops agents with no matching ICD and narrows the survivors", () => {
    const out = filterRewardsAgents([spark, grove], parseReportQuery("skybase"));
    expect(out.map((a) => a.name)).toEqual(["Spark"]);
    expect(out[0].dr?.active.map((i) => i.name)).toEqual(["SkyBase DR"]);
  });

  it("matches an agent through its own name (a visible field)", () => {
    const out = filterRewardsAgents([spark, grove], parseReportQuery("grove"));
    expect(out.map((a) => a.name)).toEqual(["Grove"]);
  });

  it("keeps an agent whose IB matches even when its DR does not", () => {
    const a = agent("Spark", prim([inst({ name: "DR nomatch" })]), prim([inst({ name: "IB skybase" }), inst({})], { kind: "IB" } as Partial<AgentPrimitive>));
    const out = filterRewardsAgents([a], parseReportQuery("skybase"));
    expect(out).toHaveLength(1);
    expect(out[0].dr).toBeNull();
    expect(out[0].ib?.active.map((i) => i.name)).toEqual(["IB skybase"]);
  });
});

describe("icdSearchFields", () => {
  it("exposes agent + chain names as visible fields (row sits under that agent)", () => {
    const a = agent("Spark", null);
    a.chain = { executor: { id: "e", name: "Spark Exec", slug: "spark-exec" }, govops: { id: "g", name: "GovAlpha", slug: "govalpha" } };
    const fields = icdSearchFields(a, inst({ name: "X" }));
    const chain = fields.find((f) => f.label === "agent chain");
    expect(chain?.hidden).toBeFalsy();
    expect(chain?.value).toBe("Spark Exec, GovAlpha");
  });
});
