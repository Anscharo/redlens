// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";

let currentUser: { id: string } | null = null;
vi.mock("../components/chat/auth", () => ({
  useAuth: () => ({ user: currentUser }),
}));

const listConversations = vi.fn();
const renameConversation = vi.fn();
const deleteConversation = vi.fn();

vi.mock("@/lib/conversationsApi", () => ({
  listConversations: (...a: unknown[]) => listConversations(...a),
  renameConversation: (...a: unknown[]) => renameConversation(...a),
  deleteConversation: (...a: unknown[]) => deleteConversation(...a),
}));

beforeEach(() => {
  vi.resetModules();
  currentUser = null;
  listConversations.mockReset();
  renameConversation.mockReset();
  deleteConversation.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useConversations", () => {
  it("starts with empty conversations and loading=false when signed out", async () => {
    const { useConversations } = await import("./useConversations");
    const { result } = renderHook(() => useConversations());
    expect(result.current.conversations).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(listConversations).not.toHaveBeenCalled();
  });

  it("fetches conversations when signed in", async () => {
    currentUser = { id: "u1" };
    const cs = [{ id: "c1", title: "Foo", updatedAt: "t", messageCount: 2 }];
    listConversations.mockResolvedValue(cs);
    const { useConversations } = await import("./useConversations");
    const { result } = renderHook(() => useConversations());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversations).toEqual(cs);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message when listConversations rejects", async () => {
    currentUser = { id: "u1" };
    listConversations.mockRejectedValue(new Error("network down"));
    const { useConversations } = await import("./useConversations");
    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.conversations).toEqual([]);
  });

  it("stringifies a non-Error rejection", async () => {
    currentUser = { id: "u1" };
    listConversations.mockRejectedValue("plain string failure");
    const { useConversations } = await import("./useConversations");
    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("plain string failure");
  });

  it("refetches when the user transitions from signed-out to signed-in", async () => {
    const { useConversations } = await import("./useConversations");
    const { result, rerender } = renderHook(() => useConversations());
    expect(result.current.loading).toBe(false);
    currentUser = { id: "u1" };
    listConversations.mockResolvedValue([{ id: "c1", title: "Foo", updatedAt: "t", messageCount: 1 }]);
    rerender();
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
  });

  it("rename() merges the PATCH response (no messageCount) into the existing row", async () => {
    currentUser = { id: "u1" };
    listConversations.mockResolvedValue([{ id: "c1", title: "Old", updatedAt: "t1", messageCount: 3 }]);
    renameConversation.mockResolvedValue({ id: "c1", title: "New", updatedAt: "t2" });
    const { useConversations } = await import("./useConversations");
    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    let returned: unknown;
    await act(async () => {
      returned = await result.current.rename("c1", "New");
    });
    expect(renameConversation).toHaveBeenCalledWith("c1", "New");
    expect(result.current.conversations[0]).toEqual({ id: "c1", title: "New", updatedAt: "t2", messageCount: 3 });
    // rename() returns void — no synchronous-updater value to hand back.
    expect(returned).toBeUndefined();
  });

  it("remove() deletes and filters out the conversation", async () => {
    currentUser = { id: "u1" };
    listConversations.mockResolvedValue([
      { id: "c1", title: "A", updatedAt: "t1", messageCount: 1 },
      { id: "c2", title: "B", updatedAt: "t1", messageCount: 1 },
    ]);
    deleteConversation.mockResolvedValue(undefined);
    const { useConversations } = await import("./useConversations");
    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));
    await act(async () => {
      await result.current.remove("c1");
    });
    expect(deleteConversation).toHaveBeenCalledWith("c1");
    expect(result.current.conversations.map((c) => c.id)).toEqual(["c2"]);
  });

  // Regression: a slow response for user A used to be able to land AFTER
  // user B is already active (shared browser / account-switch race) and
  // overwrite B's list with A's — aliveRef alone only guards post-unmount
  // setState, not a stale-but-still-mounted response.
  it("discards a stale response from a previous user after switching accounts", async () => {
    currentUser = { id: "u1" };
    let resolveA: (v: unknown) => void;
    listConversations.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveA = resolve;
      }),
    );
    const { useConversations } = await import("./useConversations");
    const { result, rerender } = renderHook(() => useConversations());
    expect(result.current.loading).toBe(true);

    // Switch to a different user before A's fetch resolves.
    currentUser = { id: "u2" };
    listConversations.mockResolvedValueOnce([{ id: "c-u2", title: "B's chat", updatedAt: "t", messageCount: 1 }]);
    rerender();
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    expect(result.current.conversations[0].id).toBe("c-u2");

    // A's stale response now lands — must not clobber u2's already-loaded list.
    await act(async () => {
      resolveA!([{ id: "c-u1", title: "A's chat", updatedAt: "t", messageCount: 1 }]);
      await Promise.resolve();
    });
    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.conversations[0].id).toBe("c-u2");
  });

  it("does not update state after unmount (guarded by aliveRef)", async () => {
    currentUser = { id: "u1" };
    let resolveFn: (v: unknown) => void;
    listConversations.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );
    const { useConversations } = await import("./useConversations");
    const { unmount } = renderHook(() => useConversations());
    unmount();
    await act(async () => {
      resolveFn([{ id: "c1", title: "A", updatedAt: "t", messageCount: 0 }]);
      await Promise.resolve();
    });
  });
});
