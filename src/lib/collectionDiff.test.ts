import { describe, it, expect } from "vitest";
import { diffIds, diffRows, previewFor, subtractIds } from "./collectionDiff";

describe("diffIds", () => {
  it("splits the selection against the saved docs, keeping each side's order", () => {
    expect(diffIds(["a", "b", "c"], ["c", "x", "a", "y"])).toEqual({
      added: ["x", "y"],
      removed: ["b"],
      unchanged: ["c", "a"],
    });
  });

  it("treats duplicates as one doc", () => {
    expect(diffIds(["a", "a", "b"], ["b", "b", "c", "c"])).toEqual({ added: ["c"], removed: ["a"], unchanged: ["b"] });
  });

  it("handles empty sides", () => {
    expect(diffIds([], ["a"])).toEqual({ added: ["a"], removed: [], unchanged: [] });
    expect(diffIds(["a"], [])).toEqual({ added: [], removed: ["a"], unchanged: [] });
    expect(diffIds([], [])).toEqual({ added: [], removed: [], unchanged: [] });
  });
});

describe("subtractIds", () => {
  it("returns the selection minus the saved collection, in selection order", () => {
    expect(subtractIds(["z", "a", "y", "b"], ["a", "b"])).toEqual(["z", "y"]);
  });

  it("is empty when nothing was added beyond the collection", () => {
    expect(subtractIds(["a"], ["a", "b"])).toEqual([]);
  });
});

describe("diffRows", () => {
  it("lists removed, then added, then unchanged rows", () => {
    expect(diffRows({ added: ["n"], removed: ["r"], unchanged: ["u"] })).toEqual([
      { id: "r", mark: "remove" },
      { id: "n", mark: "add" },
      { id: "u", mark: "same" },
    ]);
  });
});

describe("previewFor", () => {
  const saved = ["a", "b", "c"];
  const selection = ["c", "x", "a"];

  it("is just the selection for 'new', or when the saved docs are unknown", () => {
    expect(previewFor("new", selection, saved)).toEqual({ ids: ["c", "x", "a"] });
    expect(previewFor("update", selection, null)).toEqual({ ids: ["c", "x", "a"] });
    expect(previewFor("without", selection, null)).toEqual({ ids: ["c", "x", "a"] });
  });

  it("'without' is what was added beyond the saved collection", () => {
    expect(previewFor("without", selection, saved)).toEqual({ ids: ["x"] });
    expect(previewFor("without", ["a"], saved).ids).toEqual([]);
  });

  it("'update' lists removed, added, unchanged with marks and a summary", () => {
    const p = previewFor("update", selection, saved);
    expect(p.ids).toEqual(["b", "x", "c", "a"]);
    expect([...p.marks!]).toEqual([["b", "remove"], ["x", "add"], ["c", "same"], ["a", "same"]]);
    expect(p.summary).toBe("+1 added · −1 removed · 2 unchanged");
  });
});
