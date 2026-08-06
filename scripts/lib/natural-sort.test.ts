import { describe, it, expect } from "vitest";
import { codeUnitCompare, naturalCompare } from "./natural-sort.mjs";

describe("codeUnitCompare", () => {
  it("orders strings by plain code-unit comparison", () => {
    expect(codeUnitCompare("a", "b")).toBe(-1);
    expect(codeUnitCompare("b", "a")).toBe(1);
    expect(codeUnitCompare("a", "a")).toBe(0);
  });

  it("sorts numeric-looking strings lexicographically, not numerically", () => {
    const sorted = ["A.2.10", "A.2.9", "A.2.2"].sort(codeUnitCompare);
    expect(sorted).toEqual(["A.2.10", "A.2.2", "A.2.9"]);
  });
});

describe("naturalCompare", () => {
  it("orders digit runs numerically (A.2.9 before A.2.10)", () => {
    expect(naturalCompare("A.2.9", "A.2.10")).toBeLessThan(0);
    expect(naturalCompare("A.2.10", "A.2.9")).toBeGreaterThan(0);
  });

  it("treats equal strings as equal", () => {
    expect(naturalCompare("A.2.9", "A.2.9")).toBe(0);
  });

  it("falls back to code-unit comparison for equal-value digit runs with different digit strings", () => {
    expect(naturalCompare("A.01", "A.1")).toBeLessThan(0); // same numeric value; "01" < "1" by code unit
    expect(naturalCompare("A.1", "A.01")).toBeGreaterThan(0);
  });

  it("compares non-digit runs by code unit when digit runs don't decide it", () => {
    expect(naturalCompare("A.2.b", "A.2.a")).toBeGreaterThan(0);
  });

  it("treats a shorter string as less than a longer one that extends it", () => {
    expect(naturalCompare("A.2", "A.2.1")).toBeLessThan(0);
    expect(naturalCompare("A.2.1", "A.2")).toBeGreaterThan(0);
  });

  it("handles very large digit runs beyond safe-integer range via BigInt", () => {
    const big1 = "A.99999999999999999999";
    const big2 = "A.100000000000000000000";
    expect(naturalCompare(big1, big2)).toBeLessThan(0);
  });

  it("sorts a realistic doc_no list into natural order", () => {
    const input = ["A.2.10", "A.2.1", "A.2.9", "A.10", "A.2"];
    expect([...input].sort(naturalCompare)).toEqual(["A.2", "A.2.1", "A.2.9", "A.2.10", "A.10"]);
  });

  it("handles strings with no digits at all", () => {
    expect(naturalCompare("NR-a", "NR-b")).toBeLessThan(0);
  });
});
