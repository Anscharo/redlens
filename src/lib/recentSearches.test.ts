import { describe, it, expect } from "vitest";
import { mergeRecent } from "./recentSearches";

// mergeRecent is the policy that decides what counts as a distinct "recent
// query": dedupe + prefix-collapse, newest first, capped at 10.

describe("mergeRecent", () => {
  it("prepends a brand-new query", () => {
    expect(mergeRecent(["governance"], "vat")).toEqual(["vat", "governance"]);
  });

  it("ignores a blank / whitespace-only query", () => {
    expect(mergeRecent(["vat"], "   ")).toEqual(["vat"]);
  });

  it("trims the stored query", () => {
    expect(mergeRecent([], "  delegate  ")).toEqual(["delegate"]);
  });

  it("moves an exact duplicate back to the front", () => {
    expect(mergeRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("collapses a prefix chain — extension replaces the prefix it grew from", () => {
    // typing g→go→gov→governance never stacks; only the settled form survives
    let list: string[] = [];
    for (const q of ["g", "go", "gov", "governance"]) list = mergeRecent(list, q);
    expect(list).toEqual(["governance"]);
  });

  it("collapses when the new query is a prefix of an existing one", () => {
    expect(mergeRecent(["facilitator"], "facil")).toEqual(["facil"]);
  });

  it("keeps genuinely different queries", () => {
    let list = mergeRecent([], "vat");
    list = mergeRecent(list, "jug");
    list = mergeRecent(list, "pot");
    expect(list).toEqual(["pot", "jug", "vat"]);
  });

  it("caps the list at 10 entries", () => {
    let list: string[] = [];
    for (let i = 0; i < 15; i++) list = mergeRecent(list, `q${i}`);
    expect(list).toHaveLength(10);
    expect(list[0]).toBe("q14");
  });
});
