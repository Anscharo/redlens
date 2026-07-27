// output-budget.ts: pure size-budgeting helper for MCP tool results.
import { describe, it, expect } from "bun:test";
import { fitToBudget, MAX_RESULT_CHARS, TRUNCATION_HINT } from "./output-budget.ts";

describe("fitToBudget", () => {
  it("keeps everything and reports no truncation when well under budget", () => {
    const items = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const { kept, truncated } = fitToBudget(items, 10_000);
    expect(kept).toEqual(items);
    expect(truncated).toBe(false);
  });

  it("returns an empty result for an empty input array", () => {
    expect(fitToBudget([], 100)).toEqual({ kept: [], truncated: false });
  });

  it("always keeps at least one item even if it alone exceeds budget", () => {
    const huge = { blob: "x".repeat(500) };
    const { kept, truncated } = fitToBudget([huge], 10);
    expect(kept).toEqual([huge]);
    expect(truncated).toBe(false);
  });

  it("truncates once cumulative size would exceed budget, keeping prior items", () => {
    // Each item serializes to `{"v":"aaaa..."}` — size roughly controlled by value length.
    const items = [{ v: "a".repeat(20) }, { v: "b".repeat(20) }, { v: "c".repeat(20) }];
    const oneItemCost = JSON.stringify(items[0]).length + 1;
    const budget = oneItemCost * 2; // room for exactly 2 items
    const { kept, truncated } = fitToBudget(items, budget);
    expect(kept).toEqual([items[0], items[1]]);
    expect(truncated).toBe(true);
  });

  it("uses MAX_RESULT_CHARS as the default budget", () => {
    const items = [{ a: 1 }];
    const { truncated } = fitToBudget(items);
    expect(truncated).toBe(false);
    expect(MAX_RESULT_CHARS).toBeGreaterThan(0);
  });

  it("exposes a stable truncation hint string", () => {
    expect(TRUNCATION_HINT).toContain("truncated");
    expect(TRUNCATION_HINT.length).toBeGreaterThan(0);
  });
});
