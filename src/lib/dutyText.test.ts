import { describe, it, expect } from "vitest";
import { firstLine, dutySnippet, dutyCollapseKey } from "./dutyText";

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

describe("firstLine", () => {
  it("returns the first non-empty line for ordinary content", () => {
    expect(firstLine("The Prime Agent notifies GovOps.\n\nMore detail.")).toBe(
      "The Prime Agent notifies GovOps.",
    );
  });

  it("falls back to the Responsible Party + Trigger bullets when the first line is the process-step boilerplate header", () => {
    // A.2.2.9.1.2.3.3.4.2.1 shape
    const content =
      "The Document is updated as follows:\n\n- Updated fields\n    - Invocation Status\n        - New value: `Proposal Pending Facilitator Review`\n- Responsible Party: Operational GovOps\n- Triggers: [A.2.2.9.1.2.3.4 - Process Definition For Operational Facilitator Review](fd9aac63-00a0-4fc5-ad7c-8bb131322bd7).";
    expect(firstLine(content)).toBe(
      "Responsible Party: Operational GovOps · Trigger: A.2.2.9.1.2.3.4 - Process Definition For Operational Facilitator Review",
    );
  });

  it("falls back to just Responsible Party when there is no Trigger line", () => {
    // A.2.2.9.1.2.3.2.4.2.1 shape
    const content =
      "The Document is updated as follows.\n\n- Updated fields\n    - `Tracking Methodology`\n        - New Value: as applicable, update to reflect any changes\n    - Responsible Party: Operational GovOps";
    expect(firstLine(content)).toBe("Responsible Party: Operational GovOps");
  });

  it("keeps an [automated] marker in the fallback summary", () => {
    const content =
      "The Document in the Agent Artifact is updated as follows:\n\n- Updated fields\n    - Status\n- Responsible Party: Operational GovOps [automated]\n- Triggers: [A.2.2.9.1.2.3.3 - Process Definition](240e0e2c-64b6-4290-aa23-ec19eb2f6e59).";
    expect(firstLine(content)).toContain("Operational GovOps [automated]");
  });

  it("does not touch ordinary process-step docs whose first line is already informative", () => {
    const content = "Core GovOps executes a payment to the Prime Agent for the amount due.";
    expect(firstLine(content)).toBe(content);
  });

  it("falls back to the plain boilerplate line when no RP/Trigger bullet can be found at all", () => {
    expect(firstLine("The Document is updated as follows.\n\nNo bullets here.")).toBe(
      "The Document is updated as follows.",
    );
  });
});

describe("dutySnippet", () => {
  it("prefers the unit naming the role, skipping a bare Responsible Party declaration", () => {
    const content = "Intro sentence.\n\nThe Responsible Party is Operational GovOps.\n\nOperational GovOps reviews the update.";
    expect(dutySnippet(content, /GovOps/i)).toContain("Operational GovOps reviews the update.");
  });
});
