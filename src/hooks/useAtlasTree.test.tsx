// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";

const loadAtlasShallow = vi.fn();
const loadAtlas = vi.fn();
const useDataSource = vi.fn();

vi.mock("../lib/docs", () => ({
  loadAtlasShallow: (base: string) => loadAtlasShallow(base),
  loadAtlas: (base: string) => loadAtlas(base),
}));
vi.mock("../lib/dataSource", () => ({
  useDataSource: () => useDataSource(),
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetModules();
  loadAtlasShallow.mockReset();
  loadAtlas.mockReset();
  useDataSource.mockReset();
  useDataSource.mockReturnValue({ base: "/api/atlas/sha1/", preview: null });
});

describe("useAtlasTree", () => {
  it("returns null before either bundle resolves", async () => {
    let resolveShallow: (v: unknown) => void = () => {};
    loadAtlasShallow.mockReturnValue(new Promise((r) => (resolveShallow = r)));
    loadAtlas.mockReturnValue(new Promise(() => {}));
    const { useAtlasTree } = await import("./useAtlasTree");
    const { result } = renderHook(() => useAtlasTree());
    expect(result.current).toBeNull();
    resolveShallow({ docs: {}, byParent: new Map(), docNoToId: new Map(), atlasCommit: null });
  });

  it("upgrades from shallow bundle to full bundle once full resolves", async () => {
    const shallowBundle = { docs: { a: 1 }, byParent: new Map(), docNoToId: new Map(), atlasCommit: "s1" };
    const fullBundle = { docs: { a: 1, b: 2 }, byParent: new Map(), docNoToId: new Map(), atlasCommit: "s1" };
    loadAtlasShallow.mockResolvedValue(shallowBundle);
    loadAtlas.mockResolvedValue(fullBundle);
    const { useAtlasTree } = await import("./useAtlasTree");
    const { result } = renderHook(() => useAtlasTree());
    await waitFor(() => expect(result.current).toEqual(fullBundle));
  });

  it("does not clobber a full bundle that already landed with a late shallow resolve", async () => {
    const fullBundle = { docs: { a: 1, b: 2 }, byParent: new Map(), docNoToId: new Map(), atlasCommit: "s1" };
    let resolveShallow: (v: unknown) => void = () => {};
    loadAtlasShallow.mockReturnValue(new Promise((r) => (resolveShallow = r)));
    loadAtlas.mockResolvedValue(fullBundle);
    const { useAtlasTree } = await import("./useAtlasTree");
    const { result } = renderHook(() => useAtlasTree());
    await waitFor(() => expect(result.current).toEqual(fullBundle));
    // Now the shallow promise resolves late — full bundle already landed, prev ?? b keeps prev's setter,
    // but since this uses setBundle((prev) => prev ?? b) — full already replaced bundle via direct set,
    // so a late shallow resolve should not revert to the shallow bundle.
    resolveShallow({ docs: { a: 1 }, byParent: new Map(), docNoToId: new Map(), atlasCommit: "s1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual(fullBundle);
  });

  it("resets to null and refetches when base changes", async () => {
    const bundle1 = { docs: { a: 1 }, byParent: new Map(), docNoToId: new Map(), atlasCommit: "s1" };
    const bundle2 = { docs: { b: 2 }, byParent: new Map(), docNoToId: new Map(), atlasCommit: "s2" };
    loadAtlasShallow.mockResolvedValueOnce(bundle1).mockResolvedValueOnce(bundle2);
    loadAtlas.mockResolvedValueOnce(bundle1).mockResolvedValueOnce(bundle2);
    useDataSource.mockReturnValue({ base: "/api/atlas/sha1/", preview: null });
    const { useAtlasTree } = await import("./useAtlasTree");
    const { result, rerender } = renderHook(() => useAtlasTree());
    await waitFor(() => expect(result.current).toEqual(bundle1));

    useDataSource.mockReturnValue({ base: "/api/atlas/sha2/", preview: null });
    rerender();
    await waitFor(() => expect(result.current).toEqual(bundle2));
    expect(loadAtlasShallow).toHaveBeenCalledWith("/api/atlas/sha2/");
  });

  it("swallows loadAtlasShallow/loadAtlas rejections without throwing", async () => {
    loadAtlasShallow.mockRejectedValue(new Error("shallow fail"));
    loadAtlas.mockRejectedValue(new Error("full fail"));
    const { useAtlasTree } = await import("./useAtlasTree");
    const { result } = renderHook(() => useAtlasTree());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });

  it("does not update state after unmount (cleanup sets live=false)", async () => {
    let resolveShallow: (v: unknown) => void = () => {};
    loadAtlasShallow.mockReturnValue(new Promise((r) => (resolveShallow = r)));
    loadAtlas.mockReturnValue(new Promise(() => {}));
    const { useAtlasTree } = await import("./useAtlasTree");
    const { result, unmount } = renderHook(() => useAtlasTree());
    unmount();
    resolveShallow({ docs: {}, byParent: new Map(), docNoToId: new Map(), atlasCommit: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });
});
