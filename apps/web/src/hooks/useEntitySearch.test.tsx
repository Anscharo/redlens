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
    // Loading from the first render, not from the reply: the entities lane is
    // the whole page when it is picked, and a render in between must not be
    // able to observe "done, nothing found".
    expect(result.current).toEqual({ hits: [], loading: true });
    await waitFor(() => expect(result.current).toEqual({ hits, loading: false }));
    expect(searchEntities).toHaveBeenCalledWith("keel");
  });

  it("does not query for an empty or slash-prefixed query", async () => {
    const { useEntitySearch } = await import("./useEntitySearch");
    const { result, rerender } = renderHook(({ q }) => useEntitySearch(q), {
      initialProps: { q: "" },
    });
    expect(result.current).toEqual({ hits: [], loading: false });
    expect(searchEntities).not.toHaveBeenCalled();
    rerender({ q: "/reports" });
    expect(searchEntities).not.toHaveBeenCalled();
    // Nothing was asked for, so nothing is pending — a slash command must not
    // leave the line saying "searching…" forever.
    expect(result.current).toEqual({ hits: [], loading: false });
  });

  it("swallows a worker failure and stays empty", async () => {
    searchEntities.mockRejectedValue(new Error("boom"));
    const { useEntitySearch } = await import("./useEntitySearch");
    const { result } = renderHook(() => useEntitySearch("keel"));
    await waitFor(() => expect(searchEntities).toHaveBeenCalled());
    // A failed lookup is "found nothing", and crucially no longer pending.
    await waitFor(() => expect(result.current).toEqual({ hits: [], loading: false }));
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
    await waitFor(() => expect(result.current).toEqual({ hits: second, loading: false }));
    resolveFirst([{ participant: { id: "e1" }, score: 3, href: "/radar/skybase" }]);
    await Promise.resolve();
    expect(result.current).toEqual({ hits: second, loading: false });
  });
});
