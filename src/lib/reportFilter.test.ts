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
  it("does NOT de-space (that's a per-field opt-in via SearchField.despace)", () => {
    expect(buildHaystack(["Sky Base"])).toBe("sky base");
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
  // Name fields opt into de-spaced matching; prose (duty) does not.
  const hay = (r: (typeof rows)[number]) =>
    fieldsHaystack([
      { label: "name", value: r.name, despace: true },
      { label: "duty", value: r.duty },
    ]);

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
    { label: "agent", value: "Sky Base", hidden: true, despace: true },
    { label: "quote", value: "The rate must be posted within 24 hours of the Executive Vote.", hidden: true },
  ];

  it("fieldsHaystack de-spaces only despace fields", () => {
    expect(fieldsHaystack(fields)).toContain("skybase");
    expect(fieldsHaystack(fields)).not.toContain("theratemust");
  });

  it("de-spaced matching is per-field: entity names yes, prose no", () => {
    // "dss" is a substring of the de-spaced prose "…recordsshow…" — the quote
    // field must NOT despace, or nonsense tokens match running text.
    const prose: SearchField = { label: "quote", value: "records show the rate" };
    expect(fieldMatches(prose, "dss")).toBe(false);
    expect(fieldMatches({ ...prose, despace: true }, "dss")).toBe(true); // what despacing would do
    expect(matchesTokens(fieldsHaystack([prose]), ["dss"])).toBe(false);
  });

  it("fieldMatches covers plain, and de-spaced only when opted in", () => {
    expect(fieldMatches({ label: "a", value: "Sky Base", despace: true }, "skybase")).toBe(true);
    expect(fieldMatches({ label: "a", value: "Sky Base" }, "skybase")).toBe(false);
    expect(fieldMatches({ label: "a", value: "Sky Base" }, "base")).toBe(true);
    expect(fieldMatches({ label: "a", value: "Sky Base" }, "nope")).toBe(false);
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

  it("excerptAround only uses flexible location for despace fields", () => {
    expect(excerptAround("led by Sky Base today", "skybase", true)).toContain("Sky Base");
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
