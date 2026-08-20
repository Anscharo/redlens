// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PrimitiveDashboard } from "./PrimitiveDashboard";
import type { AgentPrimitiveStat } from "@/lib/primitiveStats";

vi.mock("./AgentPanel", () => ({
  AgentPanel: ({ agent }: any) => <div data-testid="agent-panel">{agent.name}</div>,
}));

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

function makeAgent(overrides: Partial<AgentPrimitiveStat> = {}): AgentPrimitiveStat {
  return {
    name: "Agent",
    slug: "agent",
    docId: "doc-1",
    executorName: null,
    executorSlug: null,
    categories: [],
    ...overrides,
  } as AgentPrimitiveStat;
}

describe("PrimitiveDashboard", () => {
  it("renders the heading", () => {
    render(<PrimitiveDashboard agents={[makeAgent()]} />);
    expect(screen.getByRole("heading", { name: "Prime Agent Primitive Stats" })).toBeInTheDocument();
  });

  it("renders an All button plus one filter button per distinct executor", () => {
    const agents = [
      makeAgent({ slug: "a1", name: "A1", executorSlug: "exec-1", executorName: "Executor One" }),
      makeAgent({ slug: "a2", name: "A2", executorSlug: "exec-2", executorName: "Executor Two" }),
      makeAgent({ slug: "a3", name: "A3" }),
    ];
    render(<PrimitiveDashboard agents={agents} />);
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executor One" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executor Two" })).toBeInTheDocument();
    // all three agents visible under "All" (including the null-executorSlug one)
    expect(screen.getAllByTestId("agent-panel")).toHaveLength(3);
  });

  it("narrows visible agents when clicking an executor filter, and resets on second click", () => {
    const agents = [
      makeAgent({ slug: "a1", name: "A1", executorSlug: "exec-1", executorName: "Executor One" }),
      makeAgent({ slug: "a2", name: "A2", executorSlug: "exec-2", executorName: "Executor Two" }),
      makeAgent({ slug: "a3", name: "A3" }),
    ];
    render(<PrimitiveDashboard agents={agents} />);

    fireEvent.click(screen.getByRole("button", { name: "Executor One" }));
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.queryByText("A2")).not.toBeInTheDocument();
    expect(screen.queryByText("A3")).not.toBeInTheDocument();

    // click same filter again resets to all
    fireEvent.click(screen.getByRole("button", { name: "Executor One" }));
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("A2")).toBeInTheDocument();
    expect(screen.getByText("A3")).toBeInTheDocument();
  });

  it("resets to all agents when clicking All after a filter is active", () => {
    const agents = [
      makeAgent({ slug: "a1", name: "A1", executorSlug: "exec-1", executorName: "Executor One" }),
      makeAgent({ slug: "a2", name: "A2", executorSlug: "exec-2", executorName: "Executor Two" }),
    ];
    render(<PrimitiveDashboard agents={agents} />);

    fireEvent.click(screen.getByRole("button", { name: "Executor One" }));
    expect(screen.queryByText("A2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("A2")).toBeInTheDocument();
  });

  it("applies active styling to the clicked filter button", () => {
    const agents = [
      makeAgent({ slug: "a1", name: "A1", executorSlug: "exec-1", executorName: "Executor One" }),
    ];
    render(<PrimitiveDashboard agents={agents} />);

    const allBtn = screen.getByRole("button", { name: "All" });
    const execBtn = screen.getByRole("button", { name: "Executor One" });

    expect(allBtn).toHaveStyle({ color: "var(--tan)" });
    expect(execBtn).toHaveStyle({ color: "var(--tan-3)" });

    fireEvent.click(execBtn);

    expect(screen.getByRole("button", { name: "Executor One" })).toHaveStyle({ color: "var(--tan)" });
    expect(screen.getByRole("button", { name: "All" })).toHaveStyle({ color: "var(--tan-3)" });
  });
});
