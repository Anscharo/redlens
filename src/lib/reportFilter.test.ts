import { describe, it, expect } from "vitest";
import { queryTokens, buildHaystack, matchesTokens, filterRows } from "./reportFilter";

describe("queryTokens", () => {
  it("lowercases and splits on whitespace", () => {
    expect(queryTokens("  SkyBase   A.3.2 ")).toEqual(["skybase", "a.3.2"]);
  });
  it("returns [] for blank input", () => {
    expect(queryTokens("   ")).toEqual([]);
  });
});

describe("buildHaystack", () => {
  it("skips empty/null fields and lowercases", () => {
    expect(buildHaystack(["Foo", null, undefined, ""])).toBe("foo");
  });
  it("adds a de-spaced copy of multi-word fields", () => {
    expect(buildHaystack(["Sky Base"])).toBe("sky base | skybase");
  });
  it("separates fields so tokens cannot straddle a boundary", () => {
    const h = buildHaystack(["data", "controller"]);
    expect(matchesTokens(h, ["datacontroller"])).toBe(false);
  });
  it("accepts numbers", () => {
    expect(buildHaystack([7])).toBe("7");
  });
});

describe("matchesTokens", () => {
  const h = buildHaystack(["Sky Base", "A.3.2.1", "Weekly rate update"]);
  it("AND-matches every token as a substring", () => {
    expect(matchesTokens(h, ["sky", "rate"])).toBe(true);
    expect(matchesTokens(h, ["sky", "missing"])).toBe(false);
  });
  it("matches entity names with or without spaces", () => {
    expect(matchesTokens(h, ["skybase"])).toBe(true);
    expect(matchesTokens(h, ["sky", "base"])).toBe(true);
  });
  it("supports doc_no prefix filtering", () => {
    expect(matchesTokens(h, ["a.3.2"])).toBe(true);
    expect(matchesTokens(h, ["a.4"])).toBe(false);
  });
});

describe("filterRows", () => {
  const rows = [
    { name: "Sky Base", duty: "maintain rates" },
    { name: "Sidestream", duty: "publish reports" },
  ];
  const hay = (r: (typeof rows)[number]) => buildHaystack([r.name, r.duty]);

  it("filters by any searchable field", () => {
    expect(filterRows(rows, "skybase", hay)).toEqual([rows[0]]);
    expect(filterRows(rows, "publish", hay)).toEqual([rows[1]]);
  });
  it("returns the same array identity for a blank query", () => {
    expect(filterRows(rows, "  ", hay)).toBe(rows);
  });
});
