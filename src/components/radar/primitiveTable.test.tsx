// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  HEADERS,
  shortenCategoryTitle,
  namesFor,
  anchorFor,
  thStyle,
  tdStyle,
  NameList,
  GroupedNameList,
} from "./primitiveTable";
import type { PrimitiveStat } from "../../lib/primitiveStats";

afterEach(cleanup);

describe("shortenCategoryTitle", () => {
  it("strips the trailing Primitives word", () => {
    expect(shortenCategoryTitle("Genesis Primitives")).toBe("Genesis");
  });

  it("leaves a title without Primitives untouched", () => {
    expect(shortenCategoryTitle("Genesis")).toBe("Genesis");
  });
});

describe("namesFor", () => {
  const p: PrimitiveStat = {
    title: "Test Prim",
    st: "dr",
    docId: "doc-1",
    invocations: 1,
    active: 2,
    suspended: 3,
    completed: 4,
    activeNames: ["Active1"],
    suspendedNames: ["Suspended1"],
    completedNames: ["Completed1"],
    invocationNames: ["Invocation1"],
  };

  it("returns invocationNames for index 0", () => {
    expect(namesFor(p, 0)).toBe(p.invocationNames);
  });

  it("returns activeNames for index 1", () => {
    expect(namesFor(p, 1)).toBe(p.activeNames);
  });

  it("returns suspendedNames for index 2", () => {
    expect(namesFor(p, 2)).toBe(p.suspendedNames);
  });

  it("returns completedNames for index 3", () => {
    expect(namesFor(p, 3)).toBe(p.completedNames);
  });
});

describe("anchorFor", () => {
  it("routes invocation-group headers to invocations-<st>", () => {
    expect(anchorFor(HEADERS[0], "dr")).toBe("invocations-dr");
  });

  it("routes instance-group headers to <st>-<full lowercase>", () => {
    expect(anchorFor(HEADERS[1], "dr")).toBe("dr-active");
  });
});

describe("thStyle / tdStyle", () => {
  it("uses the thicker group border for isGroupStart headers", () => {
    const start = thStyle(HEADERS[1]); // Active, isGroupStart: true
    const normal = thStyle(HEADERS[0]); // Invocations, isGroupStart: false
    expect(start.borderLeft).not.toBe(normal.borderLeft);
    expect(start.borderLeft).toContain("2px");
    expect(normal.borderLeft).toContain("1px");
  });

  it("sets opacity 0.5 when dim is true and undefined otherwise", () => {
    const dimmed = tdStyle(HEADERS[0], true);
    const bright = tdStyle(HEADERS[0], false);
    expect(dimmed.opacity).toBe(0.5);
    expect(bright.opacity).toBeUndefined();
  });
});

describe("NameList", () => {
  it("renders one list item per name", () => {
    render(<NameList names={["A", "B"]} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});

describe("GroupedNameList", () => {
  it("renders each group's primTitle and names", () => {
    render(<GroupedNameList groups={[{ primTitle: "P1", names: ["x"] }]} />);
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
  });
});
