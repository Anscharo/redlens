// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AtlasNode } from "../../types";

const docs: Record<string, Pick<AtlasNode, "title" | "doc_no">> = {
  "11111111-1111-1111-1111-111111111111": { title: "Some Node", doc_no: "A.1.1" },
};
let atlasRejects = false;
vi.mock("../../lib/docs", () => ({
  loadAtlas: () => (atlasRejects ? Promise.reject(new Error("boom")) : Promise.resolve({ docs })),
}));

import { reportTitleForPath, usePageContext } from "./pageContext";

afterEach(() => {
  cleanup();
  atlasRejects = false;
});

function wrap(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

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
      short: "Ask the Sky Atlas",
      placeholder: "Ask about the Sky Atlas…",
      label: "Sky Atlas",
      chip: "atlas",
    });
  });

  it("resolves an atlas node's title and doc_no asynchronously", async () => {
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/atlas?id=11111111-1111-1111-1111-111111111111"),
    });
    expect(result.current.short).toBe("Ask about this document");
    await waitFor(() => expect(result.current.short).toBe("Ask about Some Node"));
    expect(result.current.nodeDocNo).toBe("A.1.1");
    expect(result.current.chip).toBe("atlas · A.1.1");
    expect(result.current.nodeId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("falls back gracefully when the atlas node id isn't found", async () => {
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/atlas?id=22222222-2222-2222-2222-222222222222"),
    });
    await waitFor(() => expect(result.current.short).toBe("Ask about this document"));
    expect(result.current.chip).toBe("atlas");
  });

  it("falls back to signed-out context when the atlas load fails", async () => {
    atlasRejects = true;
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/atlas?id=11111111-1111-1111-1111-111111111111"),
    });
    await waitFor(() => expect(result.current.short).toBe("Ask about this document"));
  });

  it("derives a radar actor context from the slug, deslugging it for display", () => {
    const { result } = renderHook(() => usePageContext(), { wrapper: wrap("/radar/prime-agent-foo") });
    expect(result.current.actorSlug).toBe("prime-agent-foo");
    expect(result.current.short).toBe("Ask about Prime Agent Foo");
    expect(result.current.chip).toBe("radar · Prime Agent Foo");
  });

  it("derives report context with a backing tool and forwards the active filter", () => {
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/reports/of-responsibilities?q=budget"),
    });
    expect(result.current.reportName).toBe("Operational Facilitator Responsibilities");
    expect(result.current.reportTool).toBeTruthy();
    expect(result.current.reportFilter).toBe("budget");
    expect(result.current.short).toBe("Ask about the Operational Facilitator Responsibilities report");
    expect(result.current.chip).toBe("report");
  });

  it("derives name-aware context for reports without a backing tool", () => {
    const { result } = renderHook(() => usePageContext(), { wrapper: wrap("/reports/stale-dates") });
    expect(result.current.reportName).toBe("Stale Dates");
    expect(result.current.reportTool).toBeUndefined();
    expect(result.current.reportFilter).toBeUndefined();
    expect(result.current.short).toBe("Ask about the Stale Dates report");
    expect(result.current.chip).toBe("report");
  });

  it("names CrossView sub-pages after the parent report title", () => {
    const { result } = renderHook(() => usePageContext(), {
      wrapper: wrap("/reports/crossview/concepts"),
    });
    expect(result.current.reportName).toBe("Atlas CrossView");
    expect(result.current.reportTool).toBeUndefined();
  });
});
