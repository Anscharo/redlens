// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

const track = vi.fn();
vi.mock("../lib/analytics", () => ({
  track: (...a: unknown[]) => track(...a),
}));

beforeEach(() => {
  vi.resetModules();
  track.mockClear();
  window.history.pushState({}, "", "/atlas");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useNavigation", () => {
  it("navigateToNode builds a bare ?id= URL when no split/view/subset params are present", async () => {
    const { useNavigation } = await import("./useNavigation");
    const navigate = vi.fn();
    const { result } = renderHook(() => useNavigation({ navigate, nodeId: null }));
    result.current.navigateToNode("target-id");
    expect(navigate).toHaveBeenCalledWith("/atlas?id=target-id");
  });

  it("navigateToNode carries over split/view/subset from the current URL", async () => {
    window.history.pushState({}, "", "/atlas?id=old&split=1&view=glossary&subset=foo");
    const { useNavigation } = await import("./useNavigation");
    const navigate = vi.fn();
    const { result } = renderHook(() => useNavigation({ navigate, nodeId: null }));
    result.current.navigateToNode("target-id");
    const url = navigate.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("id")).toBe("target-id");
    expect(params.get("split")).toBe("1");
    expect(params.get("view")).toBe("glossary");
    expect(params.get("subset")).toBe("foo");
  });

  it("handleViewChange tracks atlas_view_tab and omits view param for the default 'notes' tab", async () => {
    const { useNavigation } = await import("./useNavigation");
    const navigate = vi.fn();
    const { result } = renderHook(() => useNavigation({ navigate, nodeId: "node-1" }));
    result.current.handleViewChange("notes");
    expect(track).toHaveBeenCalledWith("atlas_view_tab", { node_id: "node-1", view: "notes" });
    const url = navigate.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("id")).toBe("node-1");
    expect(params.has("view")).toBe(false);
  });

  it("handleViewChange sets the view param for a non-default tab and carries split/subset", async () => {
    window.history.pushState({}, "", "/atlas?split=2&subset=bar");
    const { useNavigation } = await import("./useNavigation");
    const navigate = vi.fn();
    const { result } = renderHook(() => useNavigation({ navigate, nodeId: null }));
    result.current.handleViewChange("history");
    const url = navigate.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("view")).toBe("history");
    expect(params.has("id")).toBe(false);
    expect(params.get("split")).toBe("2");
    expect(params.get("subset")).toBe("bar");
  });
});
