import { describe, it, expect } from "vitest";
import { rowMatches, hiddenMatches, parseReportQuery } from "@/lib/reportFilter";
import { monthLabel, staleSearchFields } from "./staleDatesSearch";
import type { DateClaim } from "../../lib/staleDates";

describe("monthLabel", () => {
  it("maps an ISO date to '<Month> <year>' by month POSITION", () => {
    expect(monthLabel("2026-07-31")).toBe("July 2026");
    expect(monthLabel("2026-02-07")).toBe("February 2026");
    expect(monthLabel("2026-12-01")).toBe("December 2026");
  });
  it("returns '' for a month out of range or a non-ISO value", () => {
    expect(monthLabel("2026-13-01")).toBe("");
    expect(monthLabel("2026-00-01")).toBe("");
    expect(monthLabel("2026")).toBe("");
  });
});

const claim = (over: Partial<DateClaim>): DateClaim => ({
  docId: "d", docNo: "A.1", title: "T", raw: "31 July 2026", dateISO: "2026-07-31",
  precision: "day", context: "will be included in the Executive Vote",
  contextBefore: "will be included in the ", contextAfter: " Executive Vote",
  daysUntilStale: 5, transition: false,
  ...over,
});

describe("staleSearchFields month matching", () => {
  // Keep the visible text free of the word "July" so a month-name match can
  // only come through the hidden month field (numeric raw/context).
  const july = staleSearchFields(
    claim({ dateISO: "2026-07-31", raw: "2026-07-31", contextBefore: "due on ", contextAfter: " per plan", context: "due on per plan" }),
  );
  const feb7 = staleSearchFields(claim({ dateISO: "2026-02-07", raw: "7 Feb 2026", contextBefore: "the ", contextAfter: " report", context: "the report" }));

  it("'july' matches the -07- month, never a day of 07", () => {
    expect(rowMatches(july, parseReportQuery("july"))).toBe(true);
    expect(rowMatches(feb7, parseReportQuery("july"))).toBe(false);
  });
  it("the month field is hidden — a month-only match surfaces via the aside", () => {
    const m = hiddenMatches(july, parseReportQuery("july"));
    expect(m.map((x) => x.label)).toEqual(["month"]);
    expect(m[0].excerpt).toBe("July 2026");
  });
  it("literal ISO matching still works and is a visible field", () => {
    expect(rowMatches(feb7, parseReportQuery("2026-02"))).toBe(true);
    expect(hiddenMatches(feb7, parseReportQuery("2026-02"))).toEqual([]);
  });
  it("the handoff badge word is searchable only for transition rows", () => {
    expect(rowMatches(staleSearchFields(claim({ transition: true })), parseReportQuery("handoff"))).toBe(true);
    expect(rowMatches(staleSearchFields(claim({ transition: false })), parseReportQuery("handoff"))).toBe(false);
  });
});
