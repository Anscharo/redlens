import { describe, it, expect } from "vitest";
import { mergeRecent, type RecentEntry } from "./recentSearches";

// mergeRecent is the policy that decides what counts as a distinct "recent
// query": dedupe + prefix-collapse, newest first, capped at 10. Timestamps are
// passed in so the policy stays pure/deterministic.

const qs = (list: RecentEntry[]) => list.map((e) => e.q);

describe("mergeRecent", () => {
  it("prepends a brand-new query with its timestamp", () => {
    const out = mergeRecent([{ q: "governance", t: 1 }], "vat", 2);
    expect(out).toEqual([
      { q: "vat", t: 2 },
      { q: "governance", t: 1 },
    ]);
  });

  it("ignores a blank / whitespace-only query", () => {
    const list = [{ q: "vat", t: 1 }];
    expect(mergeRecent(list, "   ", 2)).toBe(list);
  });

  it("trims the stored query", () => {
    expect(qs(mergeRecent([], "  delegate  ", 1))).toEqual(["delegate"]);
  });

  it("moves an exact duplicate back to the front with a fresh timestamp", () => {
    const list = [{ q: "a", t: 1 }, { q: "b", t: 2 }, { q: "c", t: 3 }];
    expect(mergeRecent(list, "c", 9)).toEqual([
      { q: "c", t: 9 },
      { q: "a", t: 1 },
      { q: "b", t: 2 },
    ]);
  });

  it("keeps a prefix and its extension as distinct entries (no collapse)", () => {
    // Regression: searching "amatsu" then "amat" must keep both — "amat" being a
    // prefix of "amatsu" used to silently delete "amatsu".
    let list = mergeRecent([], "amatsu", 1);
    list = mergeRecent(list, "amat", 2);
    expect(qs(list)).toEqual(["amat", "amatsu"]);
  });

  it("keeps genuinely different queries", () => {
    let list: RecentEntry[] = [];
    let t = 0;
    for (const q of ["vat", "jug", "pot"]) list = mergeRecent(list, q, ++t);
    expect(qs(list)).toEqual(["pot", "jug", "vat"]);
  });

  it("caps the list at 10 entries", () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 15; i++) list = mergeRecent(list, `q${i}`, i);
    expect(list).toHaveLength(10);
    expect(list[0].q).toBe("q14");
  });
});
