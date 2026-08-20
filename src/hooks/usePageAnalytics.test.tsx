// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

const initAnalytics = vi.fn();
const register = vi.fn();
const pageview = vi.fn();
let analyticsEnabledMock = true;

vi.mock("@/lib/analytics", () => ({
  initAnalytics: (...a: unknown[]) => initAnalytics(...a),
  register: (...a: unknown[]) => register(...a),
  pageview: (...a: unknown[]) => pageview(...a),
  get analyticsEnabled() {
    return analyticsEnabledMock;
  },
}));

let previewMock: { preview: boolean } = { preview: false };
vi.mock("@/lib/dataSource", () => ({
  useDataSource: () => previewMock,
}));

beforeEach(() => {
  vi.resetModules();
  initAnalytics.mockClear();
  register.mockClear();
  pageview.mockClear();
  analyticsEnabledMock = true;
  previewMock = { preview: false };
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("usePageAnalytics", () => {
  it("calls initAnalytics exactly once on mount", async () => {
    const { usePageAnalytics } = await import("./usePageAnalytics");
    const { rerender } = renderHook(({ loc }) => usePageAnalytics(loc), {
      initialProps: { loc: "/atlas" },
    });
    rerender({ loc: "/radar" });
    expect(initAnalytics).toHaveBeenCalledTimes(1);
  });

  it("registers product from the path and fires a pageview with the querystring", async () => {
    window.history.pushState({}, "", "/atlas?id=abc");
    const { usePageAnalytics } = await import("./usePageAnalytics");
    renderHook(() => usePageAnalytics("/atlas"));
    expect(register).toHaveBeenCalledWith({ product: "reader" });
    expect(pageview).toHaveBeenCalledWith("/atlas?id=abc");
  });

  it("overrides product to preview when the data source is a preview", async () => {
    previewMock = { preview: true };
    const { usePageAnalytics } = await import("./usePageAnalytics");
    renderHook(() => usePageAnalytics("/atlas"));
    expect(register).toHaveBeenCalledWith({ product: "preview" });
  });

  it("re-fires register/pageview when location changes", async () => {
    const { usePageAnalytics } = await import("./usePageAnalytics");
    const { rerender } = renderHook(({ loc }) => usePageAnalytics(loc), {
      initialProps: { loc: "/atlas" },
    });
    expect(register).toHaveBeenCalledTimes(1);
    rerender({ loc: "/radar" });
    expect(register).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenLastCalledWith({ product: "radar" });
  });

  it("does nothing on the location effect when analytics is disabled", async () => {
    analyticsEnabledMock = false;
    const { usePageAnalytics } = await import("./usePageAnalytics");
    renderHook(() => usePageAnalytics("/atlas"));
    expect(register).not.toHaveBeenCalled();
    expect(pageview).not.toHaveBeenCalled();
    // initAnalytics is unconditional
    expect(initAnalytics).toHaveBeenCalledTimes(1);
  });
});
