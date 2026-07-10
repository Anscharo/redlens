import { describe, it, expect } from "vitest";
import {
  queryTokens, buildHaystack, matchesTokens, filterRows,
  fieldsHaystack, fieldMatches, flexTokenSource, excerptAround, hiddenMatches,
  type SearchField,
} from "./reportFilter";

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

describe("field-level matching", () => {
  const fields: SearchField[] = [
    { label: "title", value: "Weekly rate update" },
    { label: "agent", value: "Sky Base", hidden: true },
    { label: "quote", value: "The rate must be posted within 24 hours of the Executive Vote.", hidden: true },
  ];

  it("fieldsHaystack matches buildHaystack over values", () => {
    expect(fieldsHaystack(fields)).toBe(buildHaystack(fields.map((f) => f.value)));
  });

  it("fieldMatches covers plain and de-spaced", () => {
    expect(fieldMatches("Sky Base", "skybase")).toBe(true);
    expect(fieldMatches("Sky Base", "base")).toBe(true);
    expect(fieldMatches("Sky Base", "nope")).toBe(false);
  });

  it("flexTokenSource locates de-spaced tokens in original text", () => {
    expect(new RegExp(flexTokenSource("skybase"), "i").exec("led by Sky Base today")?.[0]).toBe("Sky Base");
    expect(new RegExp(flexTokenSource("a.3.2"), "i").test("A.3.2.1")).toBe(true);
  });

  it("excerptAround windows the value near the match", () => {
    const e = excerptAround("The rate must be posted within 24 hours of the Executive Vote.", "executive");
    expect(e).toContain("Executive Vote");
    expect(e.startsWith("…")).toBe(true);
  });

  describe("hiddenMatches", () => {
    it("empty when a visible field carries the token", () => {
      expect(hiddenMatches(fields, ["rate"])).toEqual([]);
    });
    it("reports the hidden field for hidden-only tokens", () => {
      const m = hiddenMatches(fields, ["skybase"]);
      expect(m).toHaveLength(1);
      expect(m[0].label).toBe("agent");
      expect(m[0].excerpt).toBe("Sky Base");
    });
    it("one entry per hidden field even for multiple tokens", () => {
      const m = hiddenMatches(fields, ["sky", "base"]);
      expect(m.map((x) => x.label)).toEqual(["agent"]);
    });
    it("mixed visible+hidden tokens only report the hidden-only ones", () => {
      const m = hiddenMatches(fields, ["rate", "vote"]);
      expect(m.map((x) => x.label)).toEqual(["quote"]);
      expect(m[0].excerpt).toContain("Executive Vote");
    });
    it("empty for an empty token list", () => {
      expect(hiddenMatches(fields, [])).toEqual([]);
    });
  });
});
