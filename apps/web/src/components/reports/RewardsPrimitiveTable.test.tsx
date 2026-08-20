// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PrimitiveTable } from "./RewardsPrimitiveTable";
import { parseReportQuery } from "@/lib/reportFilter";
import type { AgentPrimitive, RewardsAgent, RewardsInstance, RewardsInvocation } from "@/lib/rewardsIndex";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

const agent: RewardsAgent = {
  name: "Spark",
  docNoPrefix: "A.6.1.1.1.",
  agentEntity: { id: "agent-1", name: "Spark", slug: "spark" },
  chain: null,
  dr: null,
  ib: null,
};

function drInstance(over: Partial<RewardsInstance> = {}): RewardsInstance {
  return {
    id: "inst-1",
    docNo: "A.6.1.1.1.3.4.1",
    name: "Spark DR Instance",
    status: "Active",
    rewardCode: "SPK-DR-1",
    rewardCodeDocId: "rc-1",
    trackingDocId: "td-1",
    trackingDocNo: "A.9.9",
    paymentsResponsibleParty: { id: "rp-1", name: "Spark Ops", slug: "spark-ops" },
    params: { Foo: ["bar", "p-1", "A.p.1"] },
    ...over,
  };
}

function ibInstance(over: Partial<RewardsInstance> = {}): RewardsInstance {
  return {
    id: "inst-2",
    docNo: "A.6.1.1.1.4.4.1",
    name: "Spark IB Instance",
    status: "Suspended",
    partnerName: "Acme Partner",
    partnerNameDocId: "pn-1",
    rewardAddress: "0x1111111111111111111111111111111111111111",
    rewardChain: "ethereum",
    rewardChainDocId: "rc-2",
    cadence: "monthly",
    cadenceDocId: "cd-1",
    ...over,
  };
}

function drPrim(over: Partial<AgentPrimitive> = {}): AgentPrimitive {
  return {
    kind: "DR",
    primitiveId: "dr-prim",
    primitiveDocNo: "A.2.2.1.1",
    globalActivation: "Active",
    active: [],
    suspended: [],
    completed: [],
    invocations: [],
    ...over,
  };
}

describe("PrimitiveTable (DR)", () => {
  it("renders the DR header columns, instance row, reward code, tracking, and payments RP", () => {
    render(
      <PrimitiveTable
        agent={agent}
        prim={drPrim({ active: [drInstance()] })}
        addrMap={{}}
      />,
    );
    expect(screen.getByText("Distribution Reward")).toBeInTheDocument();
    expect(screen.getByText("Reward Code")).toBeInTheDocument();
    expect(screen.getByText("Tracking")).toBeInTheDocument();
    expect(screen.getByText("Payments RP")).toBeInTheDocument();
    // No Partner/Reward Address/Chain/Cadence columns for DR.
    expect(screen.queryByText("Reward Address")).not.toBeInTheDocument();

    expect(screen.getByText("Spark DR Instance")).toBeInTheDocument();
    expect(screen.getByText("SPK-DR-1")).toBeInTheDocument();
    expect(screen.getByText("A.9.9")).toBeInTheDocument();
    expect(screen.getByText("Spark Ops")).toBeInTheDocument();
    // Param count indicator.
    expect(screen.getByText("⚙ 1")).toBeInTheDocument();
    // Status pill.
    expect(screen.getByText("Active")).toBeInTheDocument();
    // Primitive summary line.
    expect(screen.getByText(/1 active · 0 suspended · 0 completed/)).toBeInTheDocument();
  });

  it("renders em-dashes for missing optional DR fields", () => {
    render(
      <PrimitiveTable
        agent={agent}
        prim={drPrim({
          active: [
            drInstance({
              rewardCode: undefined,
              rewardCodeDocId: undefined,
              trackingDocId: undefined,
              trackingDocNo: undefined,
              paymentsResponsibleParty: undefined,
              params: {},
            }),
          ],
        })}
        addrMap={{}}
      />,
    );
    const row = screen.getByText("Spark DR Instance").closest("tr")!;
    expect(within(row).getAllByText("—").length).toBe(3);
    expect(within(row).queryByText("⚙")).not.toBeInTheDocument();
  });

  it("shows the empty-state copy when a global-activated primitive has no instances or invocations", () => {
    render(<PrimitiveTable agent={agent} prim={drPrim()} addrMap={{}} />);
    expect(
      screen.getByText(/Spark has Distribution Reward globally activated but has not invoked any/),
    ).toBeInTheDocument();
  });

  it("renders invocations in progress under a distinct 'Invocations in Progress' section", () => {
    const invocation: RewardsInvocation = { ...drInstance(), status: "InProgress", id: "inv-1", name: "Spark DR Invocation" };
    render(
      <PrimitiveTable
        agent={agent}
        prim={drPrim({ invocations: [invocation] })}
        addrMap={{}}
      />,
    );
    expect(screen.getByText("Invocations in Progress")).toBeInTheDocument();
    expect(screen.getByText("Spark DR Invocation")).toBeInTheDocument();
    expect(screen.getByText("InProgress")).toBeInTheDocument();
    expect(screen.getByText(/1 in-progress invocation/)).toBeInTheDocument();
  });
});

describe("PrimitiveTable (IB)", () => {
  it("renders the IB header columns and address link", () => {
    render(
      <PrimitiveTable
        agent={agent}
        prim={drPrim({
          kind: "IB",
          primitiveDocNo: "A.2.2.1.2",
          suspended: [ibInstance()],
        })}
        addrMap={{}}
      />,
    );
    expect(screen.getByText("Integration Boost")).toBeInTheDocument();
    expect(screen.getByText("Partner")).toBeInTheDocument();
    expect(screen.getByText("Reward Address")).toBeInTheDocument();
    expect(screen.getByText("Chain")).toBeInTheDocument();
    expect(screen.getByText("Cadence")).toBeInTheDocument();

    expect(screen.getByText("Acme Partner")).toBeInTheDocument();
    expect(screen.getByText("ethereum")).toBeInTheDocument();
    expect(screen.getByText("monthly")).toBeInTheDocument();
    const addrLink = screen.getByTitle("0x1111111111111111111111111111111111111111");
    expect(addrLink.tagName).toBe("A");
  });

  it("highlights matching text against a report query", () => {
    render(
      <PrimitiveTable
        agent={agent}
        prim={drPrim({ kind: "IB", suspended: [ibInstance()] })}
        addrMap={{}}
        rq={parseReportQuery("acme")}
      />,
    );
    const marks = [...document.querySelectorAll("mark.q-mark")].map((m) => m.textContent);
    expect(marks).toContain("Acme");
  });
});
