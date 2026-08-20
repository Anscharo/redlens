// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorRewards } from "./ActorRewards";
import type { RewardsAgent } from "@/lib/rewardsIndex";

vi.mock("../reports/RewardsPrimitiveTable", () => ({
  PrimitiveTable: ({ prim }: any) => <div data-testid="prim-table">{prim?.primitiveTitle ?? "prim"}</div>,
}));

afterEach(cleanup);

function makeAgent(overrides: Partial<RewardsAgent> = {}): RewardsAgent {
  return {
    name: "Test Agent",
    docNoPrefix: "A.1",
    agentEntity: null,
    chain: null,
    dr: null,
    ib: null,
    ...overrides,
  } as RewardsAgent;
}

describe("ActorRewards", () => {
  it("renders the empty-state message when both dr and ib are null", () => {
    render(<ActorRewards agent={makeAgent()} />);
    expect(screen.getByText("No DR or IB instances for this agent.")).toBeInTheDocument();
    expect(screen.queryByTestId("prim-table")).not.toBeInTheDocument();
  });

  it("renders one PrimitiveTable when only dr is set", () => {
    render(<ActorRewards agent={makeAgent({ dr: { primitiveId: "p1" } as any })} />);
    expect(screen.getAllByTestId("prim-table")).toHaveLength(1);
    expect(screen.queryByText("No DR or IB instances for this agent.")).not.toBeInTheDocument();
  });

  it("renders two PrimitiveTables when both dr and ib are set", () => {
    render(
      <ActorRewards
        agent={makeAgent({ dr: { primitiveId: "p1" } as any, ib: { primitiveId: "p2" } as any })}
      />,
    );
    expect(screen.getAllByTestId("prim-table")).toHaveLength(2);
  });

  it("renders one PrimitiveTable when only ib is set", () => {
    render(<ActorRewards agent={makeAgent({ ib: { primitiveId: "p2" } as any })} />);
    expect(screen.getAllByTestId("prim-table")).toHaveLength(1);
  });
});
