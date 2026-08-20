// @vitest-environment jsdom
// The report filter hooks are the single source of the `report_filter` event
// shape — one `filter_type` property across every report, `value` null when a
// click CLEARS the filter. These tests pin that contract (a rename here breaks
// PostHog dashboards) plus the URL round-trip each hook owns.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { urlString } from "../../hooks/useUrlState";

const track = vi.fn();
vi.mock("../../lib/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));

const { useReportFilter, useReportEnum, useReportSelect, useReportList, useReportSwitch, useReportQuery } =
  await import("./useReportQuery");
const { urlBool } = await import("../../hooks/useUrlState");

afterEach(() => {
  cleanup();
  track.mockClear();
});

function wrapperFor(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: ReactNode }) => <Router hook={hook}>{children}</Router>;
}

const codec = urlString(null);

describe("report filter hooks", () => {
  it("useReportFilter selects, then clears on a second click — value null on clear", () => {
    const { result } = renderHook(() => useReportFilter("active-data", "agent", codec), {
      wrapper: wrapperFor("/"),
    });
    act(() => result.current[1]("Spark"));
    expect(result.current[0]).toBe("Spark");
    expect(track).toHaveBeenLastCalledWith("report_filter", {
      report: "active-data",
      filter_type: "agent",
      value: "Spark",
      active: true,
    });

    act(() => result.current[1]("Spark"));
    expect(result.current[0]).toBeNull();
    expect(track).toHaveBeenLastCalledWith("report_filter", {
      report: "active-data",
      filter_type: "agent",
      value: null,
      active: false,
    });
  });

  it("useReportFilter takes an explicit filter_type when it differs from the param", () => {
    const { result } = renderHook(() => useReportFilter("oea-assessment", "cat", codec, "category"), {
      wrapper: wrapperFor("/"),
    });
    act(() => result.current[1]("assignment"));
    expect(track).toHaveBeenLastCalledWith("report_filter", {
      report: "oea-assessment",
      filter_type: "category",
      value: "assignment",
      active: true,
    });
  });

  it("useReportEnum resets to its default when the active value is re-clicked", () => {
    const values = ["all", "active", "deferred-stub"] as const;
    const { result } = renderHook(() => useReportEnum("processes", "status", "all", values), {
      wrapper: wrapperFor("/"),
    });
    act(() => result.current[1]("active"));
    expect(result.current[0]).toBe("active");
    act(() => result.current[1]("active"));
    expect(result.current[0]).toBe("all");
    expect(track).toHaveBeenLastCalledWith("report_filter", {
      report: "processes",
      filter_type: "status",
      value: null,
      active: false,
    });
  });

  it("useReportSelect always selects and reports active against the default", () => {
    const tabs = ["timeline", "sum-by", "list"] as const;
    const { result } = renderHook(() => useReportSelect("mod-frequency", "tab", "timeline", tabs), {
      wrapper: wrapperFor("/"),
    });
    act(() => result.current[1]("list"));
    expect(result.current[0]).toBe("list");
    expect(track).toHaveBeenLastCalledWith("report_filter", {
      report: "mod-frequency",
      filter_type: "tab",
      value: "list",
      active: true,
    });
    act(() => result.current[1]("timeline"));
    expect(result.current[0]).toBe("timeline");
    expect(track).toHaveBeenLastCalledWith("report_filter", {
      report: "mod-frequency",
      filter_type: "tab",
      value: "timeline",
      active: false,
    });
  });

  it("useReportList toggles members independently", () => {
    const { result } = renderHook(() => useReportList("risk-rules", "domain", ["peg", "alloc", "sc"] as const), {
      wrapper: wrapperFor("/?domain=peg"),
    });
    expect(result.current[0]).toEqual(["peg"]);
    act(() => result.current[1]("sc"));
    expect(result.current[0]).toEqual(["peg", "sc"]);
    act(() => result.current[1]("peg"));
    expect(result.current[0]).toEqual(["sc"]);
    expect(track).toHaveBeenLastCalledWith("report_filter", {
      report: "risk-rules",
      filter_type: "domain",
      value: null,
      active: false,
    });
  });

  it("useReportSwitch flips a boolean param and reports it with a null value", () => {
    const { result } = renderHook(
      () => useReportSwitch("processes", "ignored", urlBool(false), "show_ignored"),
      { wrapper: wrapperFor("/") },
    );
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(track).toHaveBeenLastCalledWith("report_filter", {
      report: "processes",
      filter_type: "show_ignored",
      value: null,
      active: true,
    });
  });

  it("useReportQuery parses the header box once per query/mode pair", () => {
    const { result, rerender } = renderHook(({ q }: { q: string }) => useReportQuery(q, "broad"), {
      wrapper: wrapperFor("/"),
      initialProps: { q: "spark ops" },
    });
    expect(result.current.needles).toEqual(["spark", "ops"]);
    const first = result.current;
    rerender({ q: "spark ops" });
    expect(result.current).toBe(first);
  });
});
