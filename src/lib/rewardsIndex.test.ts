import { describe, it, expect } from "vitest";
import { rewardsIndexToCSV } from "./rewardsIndex";
import type { RewardsAgent, RewardsIndex } from "./rewardsTypes";

// Minimal agent with one DR instance (with reward code + params) and one IB
// invocation (partner + address). Exercises the flatten across primitive kinds,
// statuses (Active vs InProgress), and kind-specific columns.
const agent: RewardsAgent = {
  name: "Spark",
  docNoPrefix: "A.6.1.1.1.",
  agentEntity: { id: "spark", name: "Spark", slug: "spark" },
  chain: {
    executor: { id: "ozone", name: "Ozone", slug: "ozone" },
    govops: { id: "soter", name: "Soter Labs", slug: "soter-labs" },
  },
  dr: {
    kind: "DR",
    primitiveId: "dr-prim",
    primitiveDocNo: "A.6.1.1.1.2.5.1",
    globalActivation: "Active",
    active: [
      {
        id: "i1", docNo: "A.6.1.1.1.2.5.1.3.4.1", name: "stUSDS DR", status: "Active",
        rewardCode: "RC-01", tracking: "Methodology X",
        paymentsControllerDocNo: "A.6.1.1.1.2.5.1.3.4.1.0.6.1",
        paymentsResponsibleParty: { id: "soter", name: "Soter Labs", slug: "soter-labs" },
        params: { "Reward Code": ["RC-01", "u-rc", "A.6.1.1.1.2.5.1.3.4.1.1.1"] },
      },
    ],
    suspended: [],
    completed: [],
    invocations: [],
  },
  ib: {
    kind: "IB",
    primitiveId: "ib-prim",
    primitiveDocNo: "A.6.1.1.1.2.5.2",
    globalActivation: null,
    active: [],
    suspended: [],
    completed: [],
    invocations: [
      {
        id: "v1", docNo: "A.6.1.1.1.2.5.2.4.4.1", name: "Grove IB", status: "InProgress",
        partnerName: "Grove", rewardAddress: "0xabc", rewardChain: "ethereum", cadence: "monthly",
      },
    ],
  },
};

const idx: RewardsIndex = {
  agents: [agent],
  stUsdsDr: null, srUsdsDr: null, drPrimitive: null, ibPrimitive: null,
  demandSideBufferAddress: "0x000",
};

describe("rewardsIndexToCSV", () => {
  it("flattens instances + invocations across DR/IB with kind-specific columns", () => {
    const lines = rewardsIndexToCSV(idx).split("\r\n");
    expect(lines[0]).toBe(
      '"Agent","Executor","GovOps","Primitive","Primitive Doc","Primitive UUID","Primitive Link","Global Activation","Doc No","UUID","Atlas Link","Name","Status","Reward Code","Partner Name","Reward Address","Reward Chain","Cadence","Tracking","Payments Controller Doc","Payments Controller UUID","Payments Controller Link","Responsible Party","Params"',
    );
    expect(lines).toHaveLength(3); // header + 1 DR instance + 1 IB invocation

    // DR row: reward code + tracking + RP set; IB columns blank.
    const dr = lines[1];
    expect(dr).toContain('"Spark","Ozone","Soter Labs","Distribution Reward"');
    expect(dr).toContain('"Active"');
    expect(dr).toContain('"RC-01"');
    expect(dr).toContain('"Soter Labs"');
    expect(dr).toContain('"Reward Code=RC-01"'); // params joined

    // IB row: partner/address/chain/cadence set; status InProgress.
    const ib = lines[2];
    expect(ib).toContain('"Integration Boost"');
    expect(ib).toContain('"InProgress"');
    expect(ib).toContain('"Grove"');
    expect(ib).toContain('"0xabc"');
    expect(ib).toContain('"monthly"');
  });
});
