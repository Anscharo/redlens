import { describe, it, expect } from "vitest";
import { dutyCollapseKey, finalizeDutySources, mergedDocNos } from "./dutyCollapse";

describe("dutyCollapseKey", () => {
  it("equates per-agent replicas differing only by the OWNING agent's name", () => {
    expect(dutyCollapseKey("Operational GovOps reviews Spark’s calculation of the rebate.", "Spark")).toBe(
      dutyCollapseKey("Operational GovOps reviews Grove's calculation of the rebate.", "Grove"),
    );
    expect(dutyCollapseKey("work with Launch Agent 7 to resolve the disagreement", "Launch Agent 7")).toBe(
      dutyCollapseKey("work with Spark to resolve the disagreement", "Spark"),
    );
  });

  it("preserves mentions of OTHER agents — those are substantive content", () => {
    expect(dutyCollapseKey("reviews Grove's collateral positions", "Spark")).not.toBe(
      dutyCollapseKey("reviews Obex's collateral positions", "Keel"),
    );
  });

  it("normalizes punctuation and markdown-link targets", () => {
    expect(dutyCollapseKey("at least two-thirds of signers")).toBe(dutyCollapseKey("at least two thirds of signers"));
    expect(dutyCollapseKey("see [Spark](aaaa-uuid) for details", "Spark")).toBe(
      dutyCollapseKey("see [Grove](bbbb-uuid) for details", "Grove"),
    );
  });

  it("strips per-agent doc-number citation labels, keeping the cited title", () => {
    // Atlas citation labels carry the doc_no of the agent's OWN subtree —
    // identical replicas must not split over it, but citing a differently
    // TITLED doc is a real difference.
    expect(
      dutyCollapseKey("complies with [A.6.1.1.1.2.2.1 - Root Edit Proposal Submission](aaaa-uuid).", "Spark"),
    ).toBe(dutyCollapseKey("complies with [A.6.1.1.2.2.2.1 - Root Edit Proposal Submission](bbbb-uuid).", "Grove"));
    expect(dutyCollapseKey("as defined in NR-3 and A.1.2.3", "Spark")).toBe(
      dutyCollapseKey("as defined in NR-7 and A.9.9.9", "Grove"),
    );
    expect(dutyCollapseKey("see [A.6.1.1.1.4 - SRC Risk Review](a-uuid)", "Spark")).not.toBe(
      dutyCollapseKey("see [A.6.1.1.2.4 - Signer Rotation](b-uuid)", "Grove"),
    );
  });

  it("keeps genuinely different duties apart", () => {
    expect(dutyCollapseKey("can change the signers of the Core Operator Relayer Multisig")).not.toBe(
      dutyCollapseKey("can change the signers of the USDS Demand Subsidies Multisig"),
    );
    expect(dutyCollapseKey("at least three (3) signers")).not.toBe(dutyCollapseKey("at least two (2) signers"));
  });

  it("does not mask a name embedded inside a longer word", () => {
    expect(dutyCollapseKey("the Sparkling reserve", "Spark")).not.toBe(
      dutyCollapseKey("the Groveling reserve", "Grove"),
    );
  });
});

describe("finalizeDutySources", () => {
  it("derives agents from the copies, orders sources by doc_no, and marks every uuid seen", () => {
    const seen = new Set<string>();
    const out = finalizeDutySources(
      [
        { docNo: "A.6.1.1.2.9", uuid: "u2", agent: "Grove" },
        { docNo: "A.6.1.1.1.9", uuid: "u1", agent: "Spark" },
      ],
      seen,
    );
    expect(out.sources?.map((s) => s.uuid)).toEqual(["u1", "u2"]);
    expect(out.agents).toEqual(["Spark", "Grove"]); // docNo order, after the sort
    expect(seen).toEqual(new Set(["u1", "u2"]));
  });

  it("omits sources for a single copy and agents when none resolved", () => {
    const out = finalizeDutySources([{ docNo: "A.1.2", uuid: "u1" }], new Set());
    expect(out.sources).toBeUndefined();
    expect(out.agents).toBeUndefined();
  });
});

describe("mergedDocNos", () => {
  it("joins every merged copy, falling back to the representative", () => {
    const sources = [
      { docNo: "A.1", uuid: "u1" },
      { docNo: "A.2", uuid: "u2" },
    ];
    expect(mergedDocNos({ docNo: "A.1", sources }, "; ")).toBe("A.1; A.2");
    expect(mergedDocNos({ docNo: "A.1" }, "; ")).toBe("A.1");
  });
});
