// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AtlasNode } from "@/types";

const docs: Record<string, Pick<AtlasNode, "title" | "doc_no">> = {
  "11111111-1111-1111-1111-111111111111": { title: "Some Node", doc_no: "A.1.1" },
};
let atlasRejects = false;
vi.mock("../../lib/docs", () => ({
  loadAtlas: () => (atlasRejects ? Promise.reject(new Error("boom")) : Promise.resolve({ docs })),
}));

import { ROUTES } from "@/lib/routes";
import { reportTitleForPath, toPageContext, usePageContext, type PageContextView } from "./pageContext";

afterEach(() => {
  cleanup();
  atlasRejects = false;
});

function wrap(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

describe("toPageContext", () => {
  it("strips UI-only fields and keeps every PageContext field, including mscMonth", () => {
    const view: PageContextView = {
      short: "Ask Atlas",
      placeholder: "Ask about the Sky Atlas…",
      chip: "radar · settlement",
      path: "/radar/spark/settlements",
      actorSlug: "spark",
      mscMonth: "2026-08",
    };
    expect(toPageContext(view)).toEqual({
      path: "/radar/spark/settlements",
      actorSlug: "spark",
      mscMonth: "2026-08",
    });
  });
});

describe("reportTitleForPath", () => {
  it("resolves titled report slugs and CrossView sub-pages; skips index and unknown paths", () => {
    expect(reportTitleForPath("/reports/stale-dates")).toBe("Stale Dates");
    expect(reportTitleForPath("/reports/crossview/concepts")).toBe("Atlas CrossView");
    expect(reportTitleForPath("/reports")).toBeUndefined();
    expect(reportTitleForPath("/reports/")).toBeUndefined();
    expect(reportTitleForPath("/atlas")).toBeUndefined();
  });
});

describe("usePageContext", () => {
  it("returns the generic Sky Atlas context on an unrecognized route", () => {
    const { result } = renderHook(() => usePageContext(), { wrapper: wrap("/some-other-page") });
    expect(result.current).toMatchObject({
      short: "Ask Atlas",
      placeholder: "Ask about the Sky Atlas…",
      chip: "atlas",
    });
  });

  it("resolves an atlas node's title and doc_no asynchronously", async () => {
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/atlas?id=11111111-1111-1111-1111-111111111111"),
    });
    expect(result.current.short).toBe("Ask Atlas");
    await waitFor(() => expect(result.current.nodeTitle).toBe("Some Node"));
    expect(result.current.short).toBe("Ask Atlas");
    expect(result.current.nodeDocNo).toBe("A.1.1");
    expect(result.current.chip).toBe("atlas · A.1.1");
    expect(result.current.nodeId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("falls back gracefully when the atlas node id isn't found", async () => {
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/atlas?id=22222222-2222-2222-2222-222222222222"),
    });
    await waitFor(() => expect(result.current.short).toBe("Ask Atlas"));
    expect(result.current.chip).toBe("atlas");
  });

  it("falls back to signed-out context when the atlas load fails", async () => {
    atlasRejects = true;
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/atlas?id=11111111-1111-1111-1111-111111111111"),
    });
    await waitFor(() => expect(result.current.short).toBe("Ask Atlas"));
  });

  it("derives a radar actor context from the slug, deslugging it for display", () => {
    const { result } = renderHook(() => usePageContext(), { wrapper: wrap("/radar/prime-agent-foo") });
    expect(result.current.actorSlug).toBe("prime-agent-foo");
    expect(result.current.short).toBe("Ask Atlas");
    expect(result.current.chip).toBe("radar · Prime Agent Foo");
  });

  it("names the nested settlements page in chat context", () => {
    const { result } = renderHook(() => usePageContext(), { wrapper: wrap("/radar/spark/settlements") });
    expect(result.current.actorSlug).toBe("spark");
    expect(result.current.short).toBe("Ask Atlas");
    expect(result.current.chip).toBe("radar · settlement");
    expect(result.current.mscMonth).toBeUndefined();
  });

  it("forwards the selected MSC month from ?msc= on the settlements page", () => {
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/radar/spark/settlements?msc=2026-07"),
    });
    expect(result.current.actorSlug).toBe("spark");
    expect(result.current.mscMonth).toBe("2026-07");
  });

  it("derives report context with a backing tool and forwards the active filter", () => {
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/reports/of-responsibilities?q=budget"),
    });
    expect(result.current.reportName).toBe("Operational Facilitator Responsibilities");
    expect(result.current.reportTool).toBeTruthy();
    expect(result.current.reportFilter).toBe("budget");
    expect(result.current.short).toBe("Ask Atlas");
    expect(result.current.chip).toBe("Operational Facilitator Responsibilities");
  });

  it("derives name-aware context for reports without a backing tool", () => {
    const { result } = renderHook(() => usePageContext(), { wrapper: wrap("/reports/mod-frequency") });
    expect(result.current.reportName).toBe("Modification Frequency");
    expect(result.current.reportTool).toBeUndefined();
    expect(result.current.reportFilter).toBeUndefined();
    expect(result.current.short).toBe("Ask Atlas");
    expect(result.current.chip).toBe("Modification Frequency");
  });

  it("wires each newly added report page to its atlas_report_* tool", () => {
    const cases = [
      [ROUTES.REPORTS_STALE_DATES, "Stale Dates", "atlas_report_stale_dates"],
      [ROUTES.REPORTS_PROCESSES, "Atlas Processes", "atlas_report_processes"],
      [ROUTES.REPORTS_OEA_ASSESSMENT, "OEA Task Assessment", "atlas_report_oea_assessment"],
      [ROUTES.REPORTS_RISK_RULES, "Risk Rules Assessment", "atlas_report_risk_rules"],
      [ROUTES.REPORTS_ONCHAIN_ADDRESSES, "On-Chain Addresses", "atlas_report_addresses"],
    ] as const;
    for (const [path, name, tool] of cases) {
      const { result } = renderHook(() => usePageContext(), { wrapper: wrap(path) });
      expect(result.current.reportName, path).toBe(name);
      expect(result.current.reportTool, path).toBe(tool);
    }
  });

  it("names CrossView sub-pages after the parent report title", () => {
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/reports/crossview/concepts"),
    });
    expect(result.current.reportName).toBe("Atlas CrossView");
    expect(result.current.reportTool).toBeUndefined();
  });
});
