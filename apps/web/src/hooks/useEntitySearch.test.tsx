// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";

const searchEntities = vi.fn();

vi.mock("../lib/graph", () => ({
  searchEntities: (q: string) => searchEntities(q),
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetModules();
  searchEntities.mockReset();
});

describe("useEntitySearch", () => {
  it("returns empty immediately, then the worker hits", async () => {
    const hits = [{ participant: { id: "e1", name: "Keel" }, score: 3, href: "/radar/keel" }];
    searchEntities.mockResolvedValue(hits);
    const { useEntitySearch } = await import("./useEntitySearch");
    const { result } = renderHook(() => useEntitySearch("keel"));
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(hits));
    expect(searchEntities).toHaveBeenCalledWith("keel");
  });

  it("does not query for an empty or slash-prefixed query", async () => {
    const { useEntitySearch } = await import("./useEntitySearch");
    const { result, rerender } = renderHook(({ q }) => useEntitySearch(q), {
      initialProps: { q: "" },
    });
    expect(result.current).toEqual([]);
    expect(searchEntities).not.toHaveBeenCalled();
    rerender({ q: "/reports" });
    expect(searchEntities).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it("swallows a worker failure and stays empty", async () => {
    searchEntities.mockRejectedValue(new Error("boom"));
    const { useEntitySearch } = await import("./useEntitySearch");
    const { result } = renderHook(() => useEntitySearch("keel"));
    await waitFor(() => expect(searchEntities).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("ignores a stale reply after the query changes", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    searchEntities.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveFirst = res;
        }),
    );
    const second = [{ participant: { id: "e2" }, score: 3, href: "/radar/ozone" }];
    searchEntities.mockResolvedValueOnce(second);
    const { useEntitySearch } = await import("./useEntitySearch");
    const { result, rerender } = renderHook(({ q }) => useEntitySearch(q), {
      initialProps: { q: "skybase" },
    });
    await waitFor(() => expect(searchEntities).toHaveBeenCalledTimes(1));
    rerender({ q: "ozone" });
    await waitFor(() => expect(result.current).toEqual(second));
    resolveFirst([{ participant: { id: "e1" }, score: 3, href: "/radar/skybase" }]);
    await Promise.resolve();
    expect(result.current).toEqual(second);
  });
});
