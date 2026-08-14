// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "@testing-library/react";
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

describe("usePageVisitTracking", () => {
  it("records a visit for a known report id", async () => {
    const { usePageVisitTracking } = await import("./usePageVisitTracking");
    renderHook(() => usePageVisitTracking("/reports/rewards"), { wrapper: wrapperFor("/reports/rewards") });
    expect(recordVisit).toHaveBeenCalledWith({
      path: "/reports/rewards",
      label: "Integrator Reward Relationships",
      base: "",
      params: "",
    });
  });

  it("captures the filters already in the URL on arrival", async () => {
    const { usePageVisitTracking } = await import("./usePageVisitTracking");
    renderHook(() => usePageVisitTracking("/reports/rewards"), {
      wrapper: wrapperFor("/reports/rewards?cat=spark&q=usds"),
    });
    expect(recordVisit).toHaveBeenCalledWith(
      expect.objectContaining({ params: "cat=spark&q=usds" }),
    );
  });

  it("collapses a burst of filter edits into one write", async () => {
    vi.useFakeTimers();
    const { usePageVisitTracking } = await import("./usePageVisitTracking");
    const { hook, navigate } = memoryLocation({ path: "/reports/rewards", record: true });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Router hook={hook}>{children}</Router>
    );
    renderHook(() => usePageVisitTracking("/reports/rewards"), { wrapper });
    expect(recordVisit).toHaveBeenCalledTimes(1); // the arrival

    // Typing into the in-report filter box rewrites ?q= on every keystroke.
    for (const q of ["u", "us", "usd", "usds"]) {
      act(() => navigate(`/reports/rewards?q=${q}`));
    }
    expect(recordVisit).toHaveBeenCalledTimes(1); // nothing written mid-burst
    act(() => vi.advanceTimersByTime(2000));
    expect(recordVisit).toHaveBeenCalledTimes(2);
    expect(recordVisit).toHaveBeenLastCalledWith(expect.objectContaining({ params: "q=usds" }));
    vi.useRealTimers();
  });

  it("records the radar and constellations pages too", async () => {
    const { usePageVisitTracking } = await import("./usePageVisitTracking");
    renderHook(() => usePageVisitTracking("/radar"), { wrapper: wrapperFor("/radar?exec=phoenix") });
    expect(recordVisit).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "/radar", label: "Radar", params: "exec=phoenix" }),
    );
    cleanup();
    recordVisit.mockClear();
    renderHook(() => usePageVisitTracking("/constellations"), { wrapper: wrapperFor("/constellations") });
    expect(recordVisit).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "/constellations", label: "Constellations" }),
    );
  });

  it("does nothing for a location outside the tracked set", async () => {
    const { usePageVisitTracking } = await import("./usePageVisitTracking");
    renderHook(() => usePageVisitTracking("/atlas"), { wrapper: wrapperFor("/atlas") });
    expect(recordVisit).not.toHaveBeenCalled();
  });

  it("leaves a specific actor page to RadarPage", async () => {
    const { usePageVisitTracking } = await import("./usePageVisitTracking");
    renderHook(() => usePageVisitTracking("/radar/spark"), { wrapper: wrapperFor("/radar/spark") });
    expect(recordVisit).not.toHaveBeenCalled();
  });

  it("does nothing for an unregistered report id (e.g. a sub-page or the index)", async () => {
    const { usePageVisitTracking } = await import("./usePageVisitTracking");
    renderHook(() => usePageVisitTracking("/reports/risk-rules/rubric"), {
      wrapper: wrapperFor("/reports/risk-rules/rubric"),
    });
    expect(recordVisit).not.toHaveBeenCalled();
  });

  it("re-fires when location changes to a different known report", async () => {
    const { usePageVisitTracking } = await import("./usePageVisitTracking");
    const { rerender } = renderHook(({ loc }) => usePageVisitTracking(loc), {
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
      params: "",
    });
  });

  it("keeps preview visits separate via base", async () => {
    const { usePageVisitTracking } = await import("./usePageVisitTracking");
    renderHook(() => usePageVisitTracking("/reports/rewards"), {
      wrapper: wrapperFor("/reports/rewards", "/preview/abc"),
    });
    expect(recordVisit).toHaveBeenCalledWith(
      expect.objectContaining({ base: "/preview/abc" }),
    );
  });
});
