// output-budget.ts: pure size-budgeting helper for MCP tool results.
import { describe, it, expect } from "bun:test";
import { ENVELOPE_CHARS, fitEachToBudget, fitToBudget, MAX_RESULT_CHARS, resultBudget, rowBudget, TRUNCATION_HINT, withResultBudget } from "./output-budget.ts";

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

describe("the call's result budget", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ i, v: "x".repeat(90) }));

  it("is MAX_RESULT_CHARS outside a call", () => {
    expect(resultBudget()).toBe(MAX_RESULT_CHARS);
    expect(rowBudget()).toBe(MAX_RESULT_CHARS - ENVELOPE_CHARS);
  });

  it("becomes fitToBudget's default inside withResultBudget, across awaits", async () => {
    const fit = await withResultBudget(ENVELOPE_CHARS + 1_000, async () => {
      await Promise.resolve();
      return fitToBudget(items(50));
    });
    expect(fit.truncated).toBe(true);
    expect(JSON.stringify(fit.kept).length).toBeLessThanOrEqual(1_001);
    expect(resultBudget()).toBe(MAX_RESULT_CHARS);
  });

  it("keeps the budget in force when given undefined", () => {
    withResultBudget(5_000, () => withResultBudget(undefined, () => expect(resultBudget()).toBe(5_000)));
  });

  it("reserves what sits beside the rows", () => {
    const beside = { note: "y".repeat(500) };
    withResultBudget(10_000, () => expect(rowBudget(beside)).toBe(10_000 - ENVELOPE_CHARS - JSON.stringify(beside).length));
    withResultBudget(100, () => expect(rowBudget()).toBe(0));
  });
});

describe("fitEachToBudget", () => {
  it("lets each list take what the lists before it left", () => {
    const list = Array.from({ length: 20 }, (_, i) => ({ i, v: "x".repeat(90) }));
    const [a, b, c] = fitEachToBudget([list, list, list], 3_000);
    expect(a.kept.length).toBe(20);
    expect(a.truncated).toBe(false);
    expect(b.truncated).toBe(true);
    expect(c.truncated).toBe(true);
    expect(JSON.stringify([a.kept, b.kept, c.kept]).length).toBeLessThanOrEqual(3_000 + JSON.stringify(c.kept[0]).length + 10);
  });
});
