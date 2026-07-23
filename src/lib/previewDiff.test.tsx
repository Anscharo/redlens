// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DataSource } from "./dataSource";

let dataSourceValue: DataSource = { base: "/api/atlas/live/", preview: null };

vi.mock("./dataSource", () => ({
  useDataSource: () => dataSourceValue,
}));

import { usePreviewDiff, usePreviewPatch, PreviewDiffProvider } from "./previewDiff";

function wrapper({ children }: { children: ReactNode }) {
  return <PreviewDiffProvider>{children}</PreviewDiffProvider>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dataSourceValue = { base: "/api/atlas/live/", preview: null };
});

describe("usePreviewDiff", () => {
  it("returns the EMPTY default without a provider", () => {
    const { result } = renderHook(() => usePreviewDiff());
    expect(result.current.added.size).toBe(0);
    expect(result.current.changed.size).toBe(0);
    expect(result.current.renumbered).toEqual({});
    expect(result.current.reusedSlot).toEqual({});
    expect(result.current.identitySwap).toEqual({});
    expect(result.current.formerUuid).toEqual({});
  });

  it("stays EMPTY and never fetches outside preview mode", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.added.size).toBe(0);
  });

  it("fetches diff.json and populates every field in preview mode", async () => {
    dataSourceValue = { base: "/api/preview/abc/", preview: { id: "abc", sha: "deadbeef" } };
    const payload = {
      added: ["a"],
      changed: ["b"],
      renumbered: { b: ["A.1", "A.2"] },
      reusedSlot: { c: { title: "Old" } },
      identitySwap: { d: { oldTitle: "X", newTitle: "Y" } },
      formerUuid: { e: { previousId: "old-e", previousTitle: "Old E", previousDocNo: "A.9" } },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });

    await waitFor(() => expect(result.current.added.has("a")).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/abc/diff.json");
    expect(result.current.changed.has("b")).toBe(true);
    expect(result.current.renumbered).toEqual({ b: ["A.1", "A.2"] });
    expect(result.current.reusedSlot).toEqual({ c: { title: "Old" } });
    expect(result.current.identitySwap.d.oldTitle).toBe("X");
    expect(result.current.formerUuid.e.previousId).toBe("old-e");
  });

  it("defaults missing optional fields to empty collections", async () => {
    dataSourceValue = { base: "/api/preview/bare/", preview: { id: "bare", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.renumbered).toEqual({}));
    expect(result.current.added.size).toBe(0);
    expect(result.current.changed.size).toBe(0);
    expect(result.current.reusedSlot).toEqual({});
    expect(result.current.identitySwap).toEqual({});
    expect(result.current.formerUuid).toEqual({});
  });

  it("normalizes a legacy array-shaped reusedSlot into an object", async () => {
    dataSourceValue = { base: "/api/preview/legacy/", preview: { id: "legacy", sha: "deadbeef" } };
    const payload = { added: [], changed: [], reusedSlot: ["x", "y"] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.reusedSlot).toEqual({ x: {}, y: {} }));
  });

  it("keeps EMPTY when the response is not ok", async () => {
    dataSourceValue = { base: "/api/preview/notok/", preview: { id: "notok", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.added.size).toBe(0);
  });

  it("swallows a fetch rejection and keeps EMPTY", async () => {
    dataSourceValue = { base: "/api/preview/reject/", preview: { id: "reject", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.added.size).toBe(0);
  });

  it("resets to EMPTY when preview goes back to null", async () => {
    dataSourceValue = { base: "/api/preview/reset/", preview: { id: "reset", sha: "deadbeef" } };
    const payload = { added: ["a"], changed: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));

    const { result, rerender } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.added.has("a")).toBe(true));

    dataSourceValue = { base: "/api/atlas/live/", preview: null };
    rerender();
    await waitFor(() => expect(result.current.added.size).toBe(0));
  });
});

describe("usePreviewPatch", () => {
  it("returns null and does not fetch outside preview mode", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePreviewPatch("node-1"));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches patches.json and resolves the line diff for the requested node", async () => {
    dataSourceValue = { base: "/api/preview/patch-test/", preview: { id: "patch-test", sha: "deadbeef" } };
    const lines = [{ type: "add", text: "hello" }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ "node-1": lines }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewPatch("node-1"));
    await waitFor(() => expect(result.current).toEqual(lines));
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/patch-test/patches.json");
  });

  it("returns null for a node id absent from the patch map", async () => {
    dataSourceValue = { base: "/api/preview/patch-missing/", preview: { id: "patch-missing", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

    const { result } = renderHook(() => usePreviewPatch("missing-node"));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("falls back to {} when the patches fetch response is not ok", async () => {
    dataSourceValue = { base: "/api/preview/patch-notok/", preview: { id: "patch-notok", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => usePreviewPatch("node-1"));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("swallows a patches fetch rejection and falls back to {}", async () => {
    dataSourceValue = { base: "/api/preview/patch-reject/", preview: { id: "patch-reject", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { result } = renderHook(() => usePreviewPatch("node-1"));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("caches the patches promise per base across multiple hook instances", async () => {
    dataSourceValue = { base: "/api/preview/shared-base/", preview: { id: "shared-base", sha: "deadbeef" } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ "node-1": [] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result: r1 } = renderHook(() => usePreviewPatch("node-1"));
    const { result: r2 } = renderHook(() => usePreviewPatch("node-1"));
    await waitFor(() => expect(r1.current).not.toBeNull());
    await waitFor(() => expect(r2.current).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
