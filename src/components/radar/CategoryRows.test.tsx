// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CategoryRows } from "./CategoryRows";
import type { CategoryStat, PrimitiveStat } from "@/lib/primitiveStats";

afterEach(cleanup);

function makePrimitive(overrides: Partial<PrimitiveStat> = {}): PrimitiveStat {
  return {
    title: "Primitive One",
    st: "P1",
    docId: "doc-p1",
    invocations: 3,
    active: 0,
    suspended: 0,
    completed: 0,
    activeNames: [],
    suspendedNames: [],
    completedNames: [],
    invocationNames: ["I1", "I2", "I3"],
    ...overrides,
  };
}

function makeCategory(overrides: Partial<CategoryStat> = {}): CategoryStat {
  return {
    title: "Reward Primitives",
    docId: "doc-cat",
    primitives: [makePrimitive()],
    ...overrides,
  };
}

function renderInTable(cat: CategoryStat, agentSlug = "test-agent", startIndex = 0) {
  return render(
    <table>
      <tbody>
        <CategoryRows cat={cat} startIndex={startIndex} agentSlug={agentSlug} />
      </tbody>
    </table>,
  );
}

describe("CategoryRows", () => {
  it("renders the category title shortened (strips 'Primitives')", () => {
    renderInTable(makeCategory({ title: "Reward Primitives" }));
    expect(screen.getByRole("link", { name: "Reward" })).toBeInTheDocument();
    expect(screen.queryByText("Reward Primitives")).not.toBeInTheDocument();
  });

  it("renders each primitive title as a link", () => {
    renderInTable(
      makeCategory({
        primitives: [
          makePrimitive({ st: "P1", title: "Primitive One" }),
          makePrimitive({ st: "P2", title: "Primitive Two" }),
        ],
      }),
    );
    expect(screen.getByRole("link", { name: "Primitive One" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Primitive Two" })).toBeInTheDocument();
  });

  it("renders a nonzero count as a link and a zero count as plain text without a link", () => {
    renderInTable(
      makeCategory({
        primitives: [
          makePrimitive({
            st: "P1",
            title: "Primitive One",
            invocations: 5,
            active: 0,
            suspended: 0,
            completed: 0,
            invocationNames: ["I1"],
            activeNames: [],
            suspendedNames: [],
            completedNames: [],
          }),
        ],
      }),
    );
    // nonzero invocation count (5) renders as a link — both the sum row and
    // the single primitive row show "5" since there's only one primitive
    const linksFive = screen.getAllByRole("link", { name: "5" });
    expect(linksFive.length).toBe(2);

    // zero counts render as plain "0" text, not as links
    const zeroCells = screen.getAllByText("0");
    expect(zeroCells.length).toBeGreaterThan(0);
    zeroCells.forEach((cell) => {
      expect(cell.closest("a")).toBeNull();
    });
  });

  it("renders the category sum row reflecting totals across primitives", () => {
    renderInTable(
      makeCategory({
        primitives: [
          makePrimitive({ st: "P1", title: "Primitive One", invocations: 2, active: 1, suspended: 0, completed: 0, invocationNames: ["I1", "I2"], activeNames: ["A1"], suspendedNames: [], completedNames: [] }),
          makePrimitive({ st: "P2", title: "Primitive Two", invocations: 3, active: 0, suspended: 1, completed: 0, invocationNames: ["I3", "I4", "I5"], activeNames: [], suspendedNames: ["S1"], completedNames: [] }),
        ],
      }),
    );
    // sum row: invocations sum = 5, active sum = 1, suspended sum = 1, completed sum = 0
    expect(screen.getByRole("link", { name: "5" })).toBeInTheDocument();
    // both "1" sums (active + suspended) render as links
    expect(screen.getAllByRole("link", { name: "1" }).length).toBeGreaterThanOrEqual(2);
    // completed sum of 0 renders as plain text
    const zeroCells = screen.getAllByText("0");
    expect(zeroCells.length).toBeGreaterThan(0);
  });
});
