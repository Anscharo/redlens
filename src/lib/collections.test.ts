import { describe, expect, it } from "vitest";
import { countBy, groupBy, indexBy, pushTo } from "./collections";

describe("collections", () => {
  it("pushTo creates then appends", () => {
    const m = new Map<string, number[]>();
    pushTo(m, "a", 1);
    pushTo(m, "a", 2);
    expect(m.get("a")).toEqual([1, 2]);
  });

  it("groupBy keeps first-seen key order and skips null keys", () => {
    const g = groupBy([{ k: "b", v: 1 }, { k: null, v: 2 }, { k: "a", v: 3 }, { k: "b", v: 4 }], (x) => x.k);
    expect([...g.keys()]).toEqual(["b", "a"]);
    expect(g.get("b")?.map((x) => x.v)).toEqual([1, 4]);
  });

  it("countBy counts per key", () => {
    expect([...countBy(["x", "y", "x"], (s) => s)]).toEqual([["x", 2], ["y", 1]]);
  });

  it("indexBy lets a later item win", () => {
    expect(indexBy([{ id: 1, v: "a" }, { id: 1, v: "b" }], (x) => x.id).get(1)?.v).toBe("b");
  });
});
