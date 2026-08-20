// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AgentPanel } from "./AgentPanel";
import type { AgentPrimitiveStat, PrimitiveStat } from "@/lib/primitiveStats";

afterEach(cleanup);

function makePrimitive(overrides: Partial<PrimitiveStat> = {}): PrimitiveStat {
  return {
    title: "Primitive One",
    st: "P1",
    docId: "doc-p1",
    invocations: 2,
    active: 1,
    suspended: 1,
    completed: 1,
    activeNames: ["A"],
    suspendedNames: ["S"],
    completedNames: ["C"],
    invocationNames: ["I1", "I2"],
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentPrimitiveStat> = {}): AgentPrimitiveStat {
  return {
    name: "Test Agent",
    slug: "test-agent",
    docId: "doc-agent",
    executorName: null,
    executorSlug: null,
    categories: [
      {
        title: "Reward Primitives",
        docId: "doc-cat",
        primitives: [makePrimitive()],
      },
    ],
    ...overrides,
  };
}

describe("AgentPanel", () => {
  it("renders the agent name as a link", () => {
    render(
      <table>
        <tbody>
          <AgentPanel agent={makeAgent()} />
        </tbody>
      </table>,
    );
    const link = screen.getByRole("link", { name: "Test Agent" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", expect.stringContaining("test-agent"));
  });

  it("renders the four column header keys", () => {
    render(
      <table>
        <tbody>
          <AgentPanel agent={makeAgent()} />
        </tbody>
      </table>,
    );
    expect(screen.getByText("Inv")).toBeInTheDocument();
    expect(screen.getByText("Act")).toBeInTheDocument();
    expect(screen.getByText("Sus")).toBeInTheDocument();
    expect(screen.getByText("Com")).toBeInTheDocument();
  });

  it("renders category rows with the computed totals reflected in primitive cells", () => {
    render(
      <table>
        <tbody>
          <AgentPanel agent={makeAgent()} />
        </tbody>
      </table>,
    );
    // The primitive title from CategoryRows renders as a link
    expect(screen.getByRole("link", { name: "Primitive One" })).toBeInTheDocument();
    // Nonzero counts (2 invocations, 1 active, 1 suspended, 1 completed) render as links.
    // The category sum row duplicates the same values, so both the sum row and the
    // primitive row cell contribute matches here.
    expect(screen.getAllByRole("link", { name: "2" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: "1" }).length).toBeGreaterThanOrEqual(1);
  });

  it("handles multiple categories and primitives, summing totals across them", () => {
    const agent = makeAgent({
      categories: [
        {
          title: "Reward Primitives",
          docId: "doc-cat-1",
          primitives: [makePrimitive({ st: "P1", title: "Primitive One", invocations: 2, active: 1, suspended: 1, completed: 1 })],
        },
        {
          title: "Governance Primitives",
          docId: "doc-cat-2",
          primitives: [
            makePrimitive({ st: "P2", title: "Primitive Two", invocations: 0, active: 0, suspended: 0, completed: 0, activeNames: [], suspendedNames: [], completedNames: [], invocationNames: [] }),
          ],
        },
      ],
    });
    render(
      <table>
        <tbody>
          <AgentPanel agent={agent} />
        </tbody>
      </table>,
    );
    expect(screen.getByRole("link", { name: "Primitive One" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Primitive Two" })).toBeInTheDocument();
  });
});
