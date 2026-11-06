import { describe, expect, it } from "vitest";
import type { ValueCheck, ValueStatus } from "@/lib/pauAtlasValues";
import { checksForParam, indexParamChecks, paramMark } from "./paramChecks";

function check(over: Partial<ValueCheck> & { status: ValueStatus }): ValueCheck {
  return {
    docId: "inflow-doc", instance: "SparkLend USDS", instanceDocId: "inst-doc", label: "Inflow maxAmount", field: "maxAmount",
    stated: "200,000,000 USDS", key: "0xk", chain: "ethereum", kind: "monolithic", contract: "0xrl", limit: null, readAt: null,
    ...over,
  };
}

const param = (key: string, value: string, srcDocId: string | null = "inflow-doc") => ({ key, value, srcDocId });

describe("checksForParam", () => {
  const index = indexParamChecks([
    check({ status: "match" }),
    check({ status: "mismatch", label: "Inflow slope", field: "slope", stated: "400,000,000 USDS per day" }),
    check({ status: "match", instanceDocId: "other-inst" }),
  ]);

  it("finds a row's checks by its instance, its stating document and its label", () => {
    expect(checksForParam(index, "inst-doc", param("Inflow Rate Limit / maxAmount", "200,000,000 USDS"))).toHaveLength(1);
    expect(checksForParam(index, "inst-doc", param("Inflow Rate Limit / slope", "400,000,000 USDS per day"))[0].status).toBe("mismatch");
  });

  it("never lends a row another instance's, another side's or another document's check", () => {
    expect(checksForParam(index, "inst-doc", param("Outflow Rate Limit / maxAmount", "200,000,000 USDS"))).toEqual([]);
    expect(checksForParam(index, "inst-doc", param("Inflow Rate Limit / maxAmount", "200,000,000 USDS", "other-doc"))).toEqual([]);
    expect(checksForParam(index, "third-inst", param("Inflow Rate Limit / maxAmount", "200,000,000 USDS"))).toEqual([]);
  });

  it("checks nothing that is not a maxAmount or slope, nor a row with no stating document", () => {
    expect(checksForParam(index, "inst-doc", param("Token Address", "0xabc"))).toEqual([]);
    expect(checksForParam(index, "inst-doc", param("Inflow Rate Limit / maxAmount", "200,000,000 USDS", null))).toEqual([]);
  });
});

describe("paramMark", () => {
  const of = (...statuses: ValueStatus[]) => paramMark(statuses.map((status) => check({ status })));

  it("needs every deployment to agree for a match, and one certain difference for a mismatch", () => {
    expect(of("match", "match")).toBe("match");
    expect(of("match", "mismatch")).toBe("mismatch");
    expect(of("match", "unread")).toBe("unsure");
  });

  it("says a key was never set, or the atlas left the value unset, and nothing for no checks", () => {
    expect(of("not-set")).toBe("not-set");
    expect(of("not-stated")).toBe("not-stated");
    expect(of("no-key", "ambiguous")).toBe("unsure");
    expect(paramMark([])).toBeNull();
  });
});
