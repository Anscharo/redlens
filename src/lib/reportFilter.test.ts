import { describe, it, expect } from "vitest";
import {
  queryTokens, parseReportQuery, fieldMatches, rowMatches, filterRows,
  flexTokenSource, excerptAround, hiddenMatches, EMPTY_QUERY,
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

describe("parseReportQuery", () => {
  it("broad: lowercased word tokens", () => {
    expect(parseReportQuery("Executive Vote")).toEqual({ needles: ["executive", "vote"], cased: false });
  });
  it("broad: strips stray leading/trailing quotes from tokens", () => {
    expect(parseReportQuery('"executive vote')).toEqual({ needles: ["executive", "vote"], cased: false });
  });
  it('typed "..." wrap = phrase: one needle, spaces kept, case-insensitive', () => {
    expect(parseReportQuery('"Executive Vote"')).toEqual({ needles: ["executive vote"], cased: false });
  });
  it("typed '...' wrap = strict: one needle, original case", () => {
    expect(parseReportQuery("'Executive Vote'")).toEqual({ needles: ["Executive Vote"], cased: true });
  });
  it("mode param applies when no quotes are typed", () => {
    expect(parseReportQuery("Executive Vote", "phrase")).toEqual({ needles: ["executive vote"], cased: false });
    expect(parseReportQuery("Executive Vote", "strict")).toEqual({ needles: ["Executive Vote"], cased: true });
  });
  it("typed quotes win over the mode param (mirrors the reader)", () => {
    expect(parseReportQuery('"Executive Vote"', "strict")).toEqual({ needles: ["executive vote"], cased: false });
  });
  it("blank and empty-quote inputs are the empty query", () => {
    expect(parseReportQuery("  ")).toBe(EMPTY_QUERY);
    expect(parseReportQuery('""')).toBe(EMPTY_QUERY);
    expect(parseReportQuery("''")).toBe(EMPTY_QUERY);
  });
});

describe("field matching", () => {
  const fields: SearchField[] = [
    { label: "title", value: "Weekly rate update" },
    { label: "agent", value: "Sky Base", hidden: true, despace: true },
    { label: "quote", value: "The rate must be posted within 24 hours of the Executive Vote.", hidden: true },
  ];

  it("de-spaced matching is per-field: entity names yes, prose no", () => {
    // "dss" is a substring of de-spaced "records show" — prose must not despace.
    const prose: SearchField = { label: "quote", value: "records show the rate" };
    expect(fieldMatches(prose, "dss")).toBe(false);
    expect(fieldMatches({ ...prose, despace: true }, "dss")).toBe(true); // what despacing would do
    expect(fieldMatches({ label: "a", value: "Sky Base", despace: true }, "skybase")).toBe(true);
    expect(fieldMatches({ label: "a", value: "Sky Base" }, "skybase")).toBe(false);
  });

  it("strict needles compare case-sensitively", () => {
    const f: SearchField = { label: "t", value: "Executive Vote" };
    expect(fieldMatches(f, "Executive", true)).toBe(true);
    expect(fieldMatches(f, "executive", true)).toBe(false);
    expect(fieldMatches(f, "executive", false)).toBe(true);
  });

  it("rowMatches ANDs needles across fields", () => {
    expect(rowMatches(fields, parseReportQuery("rate skybase"))).toBe(true);
    expect(rowMatches(fields, parseReportQuery("rate missing"))).toBe(false);
  });

  it("phrase needles must appear verbatim within one field", () => {
    expect(rowMatches(fields, parseReportQuery('"executive vote"'))).toBe(true);
    expect(rowMatches(fields, parseReportQuery('"rate update weekly"'))).toBe(false);
  });

  it("strict needles honor case", () => {
    expect(rowMatches(fields, parseReportQuery("'Executive Vote'"))).toBe(true);
    expect(rowMatches(fields, parseReportQuery("'executive vote'"))).toBe(false);
  });
});

describe("filterRows", () => {
  const rows = [
    { name: "Sky Base", duty: "maintain rates" },
    { name: "Sidestream", duty: "publish reports" },
  ];
  const fieldsOf = (r: (typeof rows)[number]): SearchField[] => [
    { label: "name", value: r.name, despace: true },
    { label: "duty", value: r.duty },
  ];

  it("filters by any searchable field", () => {
    expect(filterRows(rows, parseReportQuery("skybase"), fieldsOf)).toEqual([rows[0]]);
    expect(filterRows(rows, parseReportQuery("publish"), fieldsOf)).toEqual([rows[1]]);
  });
  it("returns the same array identity for a blank query", () => {
    expect(filterRows(rows, parseReportQuery("  "), fieldsOf)).toBe(rows);
  });
});

describe("flexTokenSource / excerptAround", () => {
  it("locates de-spaced needles in original text", () => {
    expect(new RegExp(flexTokenSource("skybase"), "i").exec("led by Sky Base today")?.[0]).toBe("Sky Base");
    expect(new RegExp(flexTokenSource("a.3.2"), "i").test("A.3.2.1")).toBe(true);
  });
  it("windows the value near the match", () => {
    const e = excerptAround("The rate must be posted within 24 hours of the Executive Vote.", "executive");
    expect(e).toContain("Executive Vote");
    expect(e.startsWith("…")).toBe(true);
  });
  it("uses flexible location only for despace fields", () => {
    expect(excerptAround("led by Sky Base today", "skybase", { despace: true })).toContain("Sky Base");
  });
});

describe("month-name date matching (stale-dates pattern)", () => {
  // The report expands each row's ISO date into a hidden "July 2026"-style
  // field, so month queries match by month POSITION, never by a same-numbered
  // day — "july" must not match 2026-02-07.
  const claim = (iso: string, month: string): SearchField[] => [
    { label: "date", value: iso },
    { label: "month", value: month, hidden: true },
    { label: "context", value: "will be included in the Executive Vote" },
  ];
  const julyRow = claim("2026-07-31", "July 2026");
  const feb7Row = claim("2026-02-07", "February 2026");

  it('"july" matches the -07- month, not a day of 07', () => {
    expect(rowMatches(julyRow, parseReportQuery("july"))).toBe(true);
    expect(rowMatches(feb7Row, parseReportQuery("july"))).toBe(false);
  });
  it('"july 2026" and "jul" also match', () => {
    expect(rowMatches(julyRow, parseReportQuery("july 2026"))).toBe(true);
    expect(rowMatches(julyRow, parseReportQuery("jul"))).toBe(true);
  });
  it("the month-only match is explained via the hidden aside", () => {
    const m = hiddenMatches(julyRow, parseReportQuery("july"));
    expect(m.map((x) => x.label)).toEqual(["month"]);
    expect(m[0].excerpt).toBe("July 2026");
  });
  it("literal ISO matching is untouched", () => {
    expect(rowMatches(feb7Row, parseReportQuery("2026-02"))).toBe(true);
  });
});

describe("hiddenMatches", () => {
  const fields: SearchField[] = [
    { label: "title", value: "Weekly rate update" },
    { label: "agent", value: "Sky Base", hidden: true, despace: true },
    { label: "quote", value: "The rate must be posted within 24 hours of the Executive Vote.", hidden: true },
  ];

  it("empty when a visible field carries the needle", () => {
    expect(hiddenMatches(fields, parseReportQuery("rate"))).toEqual([]);
  });
  it("reports the hidden field for hidden-only needles", () => {
    const m = hiddenMatches(fields, parseReportQuery("skybase"));
    expect(m).toHaveLength(1);
    expect(m[0].label).toBe("agent");
    expect(m[0].excerpt).toBe("Sky Base");
  });
  it("one entry per hidden field even for multiple needles", () => {
    expect(hiddenMatches(fields, parseReportQuery("sky base")).map((x) => x.label)).toEqual(["agent"]);
  });
  it("mixed visible+hidden needles only report the hidden-only ones", () => {
    const m = hiddenMatches(fields, parseReportQuery("rate vote"));
    expect(m.map((x) => x.label)).toEqual(["quote"]);
    expect(m[0].excerpt).toContain("Executive Vote");
  });
  it("phrase queries report hidden-only phrase hits", () => {
    const m = hiddenMatches(fields, parseReportQuery('"executive vote"'));
    expect(m.map((x) => x.label)).toEqual(["quote"]);
  });
  it("empty for an empty query", () => {
    expect(hiddenMatches(fields, EMPTY_QUERY)).toEqual([]);
  });
});
