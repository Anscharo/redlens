// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";

let currentUser: { id: string } | null = null;
vi.mock("../components/chat/auth", () => ({
  useAuth: () => ({ user: currentUser }),
}));

const listCollections = vi.fn();
const renameCollection = vi.fn();
const deleteCollection = vi.fn();

vi.mock("@/lib/collectionsApi", () => ({
  listCollections: (...a: unknown[]) => listCollections(...a),
  renameCollection: (...a: unknown[]) => renameCollection(...a),
  deleteCollection: (...a: unknown[]) => deleteCollection(...a),
}));

beforeEach(() => {
  vi.resetModules();
  currentUser = null;
  listCollections.mockReset();
  renameCollection.mockReset();
  deleteCollection.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useCollections", () => {
  it("starts with empty collections and loading=false when signed out", async () => {
    const { useCollections } = await import("./useCollections");
    const { result } = renderHook(() => useCollections());
    expect(result.current.collections).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(listCollections).not.toHaveBeenCalled();
  });

  it("fetches collections when signed in", async () => {
    currentUser = { id: "u1" };
    const cs = [{ id: "c1", name: "Foo", ids: [], updatedAt: "t" }];
    listCollections.mockResolvedValue(cs);
    const { useCollections } = await import("./useCollections");
    const { result } = renderHook(() => useCollections());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.collections).toEqual(cs);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message when listCollections rejects", async () => {
    currentUser = { id: "u1" };
    listCollections.mockRejectedValue(new Error("network down"));
    const { useCollections } = await import("./useCollections");
    const { result } = renderHook(() => useCollections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.collections).toEqual([]);
  });

  it("stringifies a non-Error rejection", async () => {
    currentUser = { id: "u1" };
    listCollections.mockRejectedValue("plain string failure");
    const { useCollections } = await import("./useCollections");
    const { result } = renderHook(() => useCollections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("plain string failure");
  });

  it("refetches when the user transitions from signed-out to signed-in", async () => {
    const { useCollections } = await import("./useCollections");
    const { result, rerender } = renderHook(() => useCollections());
    expect(result.current.loading).toBe(false);
    currentUser = { id: "u1" };
    listCollections.mockResolvedValue([{ id: "c1", name: "Foo", ids: [], updatedAt: "t" }]);
    rerender();
    await waitFor(() => expect(result.current.collections).toHaveLength(1));
  });

  it("rename() updates the matching collection in place", async () => {
    currentUser = { id: "u1" };
    listCollections.mockResolvedValue([{ id: "c1", name: "Old", ids: [], updatedAt: "t1" }]);
    renameCollection.mockResolvedValue({ id: "c1", name: "New", ids: [], updatedAt: "t2" });
    const { useCollections } = await import("./useCollections");
    const { result } = renderHook(() => useCollections());
    await waitFor(() => expect(result.current.collections).toHaveLength(1));
    await act(async () => {
      await result.current.rename("c1", "New");
    });
    expect(renameCollection).toHaveBeenCalledWith("c1", "New");
    expect(result.current.collections[0].name).toBe("New");
  });

  it("remove() deletes and filters out the collection", async () => {
    currentUser = { id: "u1" };
    listCollections.mockResolvedValue([
      { id: "c1", name: "A", ids: [], updatedAt: "t1" },
      { id: "c2", name: "B", ids: [], updatedAt: "t1" },
    ]);
    deleteCollection.mockResolvedValue(undefined);
    const { useCollections } = await import("./useCollections");
    const { result } = renderHook(() => useCollections());
    await waitFor(() => expect(result.current.collections).toHaveLength(2));
    await act(async () => {
      await result.current.remove("c1");
    });
    expect(deleteCollection).toHaveBeenCalledWith("c1");
    expect(result.current.collections.map((c) => c.id)).toEqual(["c2"]);
  });

  it("does not update state after unmount (guarded by aliveRef)", async () => {
    currentUser = { id: "u1" };
    let resolveFn: (v: unknown) => void;
    listCollections.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );
    const { useCollections } = await import("./useCollections");
    const { unmount } = renderHook(() => useCollections());
    unmount();
    // Resolve after unmount; should not throw (act warning would surface as an error).
    await act(async () => {
      resolveFn([{ id: "c1", name: "A", ids: [], updatedAt: "t" }]);
      await Promise.resolve();
    });
  });
});
