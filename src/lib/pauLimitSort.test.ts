// Sorting a deployment's rate-limit table by a column: ascending first, then
// the other way; amounts in whole tokens at each row's own decimals; the Atlas
// column by what its cell shows; ties keep the table's default order.
import { describe, expect, it } from "vitest";
import type { LiveRateLimit } from "./pau.ts";
import { atlasRank, nextSort, sortLimits, type SortableLimit } from "./pauLimitSort.ts";

const row = (name: string, maxAmount: string, decimals: number, time: string, atlas = 4, slope = "0"): SortableLimit => ({
  name, atlas,
  r: { key: name, configured: { maxAmount, slope }, setAt: { block: 1, time, tx: "0x" }, changes: 1, data: null, available: null, unit: { decimals, symbol: null, source: "constant" } } as LiveRateLimit,
});
const usdc = row("b usdc", "20000000", 6, "2026-02-01", 0, "1000000");
const usds = row("A usds", "10000000000000000000", 18, "2026-03-01", 3, "5");
const off = row("c off", "0", 6, "2026-01-01", 1, "9000000");
const names = (rows: SortableLimit[]) => rows.map((r) => r.name);

describe("nextSort", () => {
  it("sorts a new column ascending and flips the one already sorted", () => {
    expect(nextSort(null, "slope")).toEqual({ by: "slope", desc: false });
    expect(nextSort({ by: "slope", desc: false }, "slope")).toEqual({ by: "slope", desc: true });
    expect(nextSort({ by: "slope", desc: true }, "name")).toEqual({ by: "name", desc: false });
  });
});

describe("atlasRank", () => {
  it("ranks ✗, then ⚑, then ?, then ✓, then blank", () => {
    const ranks = [
      atlasRank({ mark: "mismatch", docId: "d" }, null, false), atlasRank(undefined, null, true), atlasRank({ mark: "unsure", docId: "d" }, null, false),
      atlasRank(undefined, "key-doc", false), atlasRank({ mark: "elsewhere", docId: "d" }, null, false), atlasRank({ mark: "match", docId: "d" }, null, false), atlasRank(undefined, null, false),
    ];
    expect(ranks).toEqual([0, 1, 2, 2, 2, 3, 4]);
  });
});

describe("sortLimits", () => {
  const rows = [usdc, usds, off];
  it("keeps the given order without a sort", () => {
    expect(sortLimits(rows, null)).toBe(rows);
  });
  it("sorts by name ignoring case, and by date, either way", () => {
    expect(names(sortLimits(rows, { by: "name", desc: false }))).toEqual(["A usds", "b usdc", "c off"]);
    expect(names(sortLimits(rows, { by: "updated", desc: true }))).toEqual(["A usds", "b usdc", "c off"]);
  });
  it("compares amounts in whole tokens, a switched-off limit holding none", () => {
    expect(names(sortLimits(rows, { by: "maxAmount", desc: false }))).toEqual(["c off", "A usds", "b usdc"]);
    expect(names(sortLimits(rows, { by: "slope", desc: true }))).toEqual(["c off", "b usdc", "A usds"]);
  });
  it("sorts the Atlas column by rank and keeps ties in the given order", () => {
    const tie = { ...usds, name: "tie" };
    expect(names(sortLimits([usds, usdc, tie, off], { by: "atlas", desc: false }))).toEqual(["b usdc", "c off", "A usds", "tie"]);
  });
});
