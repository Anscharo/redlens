// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const recordVisit = vi.fn();
vi.mock("../lib/visitHistory", () => ({
  recordVisit: (...a: unknown[]) => recordVisit(...a),
}));

function wrapperFor(path: string, base = "") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => (
    <Router hook={hook} base={base}>
      {children}
    </Router>
  );
}

beforeEach(() => {
  vi.resetModules();
  recordVisit.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useReportVisitTracking", () => {
  it("records a visit for a known report id", async () => {
    const { useReportVisitTracking } = await import("./useReportVisitTracking");
    renderHook(() => useReportVisitTracking("/reports/rewards"), { wrapper: wrapperFor("/reports/rewards") });
    expect(recordVisit).toHaveBeenCalledWith({
      path: "/reports/rewards",
      label: "Integrator Reward Relationships",
      base: "",
    });
  });

  it("does nothing for a location outside /reports/", async () => {
    const { useReportVisitTracking } = await import("./useReportVisitTracking");
    renderHook(() => useReportVisitTracking("/atlas"), { wrapper: wrapperFor("/atlas") });
    expect(recordVisit).not.toHaveBeenCalled();
  });

  it("does nothing for an unregistered report id (e.g. a sub-page or the index)", async () => {
    const { useReportVisitTracking } = await import("./useReportVisitTracking");
    renderHook(() => useReportVisitTracking("/reports/risk-rules/rubric"), {
      wrapper: wrapperFor("/reports/risk-rules/rubric"),
    });
    expect(recordVisit).not.toHaveBeenCalled();
  });

  it("re-fires when location changes to a different known report", async () => {
    const { useReportVisitTracking } = await import("./useReportVisitTracking");
    const { rerender } = renderHook(({ loc }) => useReportVisitTracking(loc), {
      wrapper: wrapperFor("/reports/rewards"),
      initialProps: { loc: "/reports/rewards" },
    });
    expect(recordVisit).toHaveBeenCalledTimes(1);
    rerender({ loc: "/reports/processes" });
    expect(recordVisit).toHaveBeenCalledTimes(2);
    expect(recordVisit).toHaveBeenLastCalledWith({
      path: "/reports/processes",
      label: "Atlas Processes",
      base: "",
    });
  });

  it("keeps preview visits separate via base", async () => {
    const { useReportVisitTracking } = await import("./useReportVisitTracking");
    renderHook(() => useReportVisitTracking("/reports/rewards"), {
      wrapper: wrapperFor("/reports/rewards", "/preview/abc"),
    });
    expect(recordVisit).toHaveBeenCalledWith(
      expect.objectContaining({ base: "/preview/abc" }),
    );
  });
});
