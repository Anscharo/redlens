// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let authUser: { id: string; name: string | null } | null = { id: "u1", name: "Ada" };
vi.mock("./auth", () => ({ useAuth: () => ({ user: authUser, openAuth: vi.fn() }) }));

const { useUsageSpy } = vi.hoisted(() => ({ useUsageSpy: vi.fn() }));
vi.mock("./useUsage", () => ({
  useUsage: (enabled: boolean) => {
    useUsageSpy(enabled);
    return { usage: null, commons: null, refresh: vi.fn() };
  },
}));

const { getConversation } = vi.hoisted(() => ({ getConversation: vi.fn() }));
vi.mock("../../lib/conversationsApi", () => ({ getConversation }));

import { useChatSession } from "./useChatSession";

beforeEach(() => {
  authUser = { id: "u1", name: "Ada" };
  getConversation.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useChatSession usage gating", () => {
  it("passes authed && open through to useUsage", () => {
    const { rerender } = renderHook(({ open }: { open: boolean }) => useChatSession(open), {
      initialProps: { open: false },
    });
    expect(useUsageSpy).toHaveBeenLastCalledWith(false);
    rerender({ open: true });
    expect(useUsageSpy).toHaveBeenLastCalledWith(true);
  });

  it("stays disabled when open but signed out", () => {
    authUser = null;
    renderHook(() => useChatSession(true));
    expect(useUsageSpy).toHaveBeenLastCalledWith(false);
  });
});

describe("useChatSession.openConversation", () => {
  it("hydrates messages and prefers the server's title over the preset one", async () => {
    getConversation.mockResolvedValue({
      id: "conv-1",
      title: "Server title",
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [{ role: "assistant", content: "hi", createdAt: "2026-01-01T00:00:00Z", toolCalls: null }],
    });
    const { result } = renderHook(() => useChatSession(true));

    await act(async () => {
      await result.current.openConversation("conv-1", "Preset title");
    });

    expect(getConversation).toHaveBeenCalledWith("conv-1");
    expect(result.current.title).toBe("Server title");
    expect(result.current.messages).toEqual([
      { role: "assistant", content: "hi", trace: [], rounds: 0, sources: [], done: true, verify: undefined },
    ]);
    expect(result.current.loadingHistory).toBe(false);
  });

  it("falls back to a fresh conversation on failure, without setting an error", async () => {
    getConversation.mockRejectedValue(new Error("404"));
    const { result } = renderHook(() => useChatSession(true));

    await act(async () => {
      await result.current.openConversation("dead-id", "stale title");
    });

    expect(result.current.title).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loadingHistory).toBe(false);
  });

  it("discards a stale fetch superseded by a newer open request before it resolves", async () => {
    let resolveA!: (v: unknown) => void;
    const pendingA = new Promise((resolve) => {
      resolveA = resolve;
    });
    getConversation.mockImplementationOnce(() => pendingA);
    getConversation.mockImplementationOnce(() =>
      Promise.resolve({ id: "B", title: "B title", updatedAt: "x", messages: [] }),
    );

    const { result } = renderHook(() => useChatSession(true));

    let doneA: Promise<void>;
    act(() => {
      doneA = result.current.openConversation("A", "A title");
    });
    await act(async () => {
      await result.current.openConversation("B", "B title");
    });
    expect(result.current.title).toBe("B title");

    // A resolves late — it must not clobber B's now-current state.
    await act(async () => {
      resolveA({ id: "A", title: "A title (server)", updatedAt: "x", messages: [] });
      await doneA;
    });
    expect(result.current.title).toBe("B title");
  });
});

describe("useChatSession.newChat", () => {
  it("clears the thread and title", async () => {
    getConversation.mockResolvedValue({ id: "conv-1", title: "T", updatedAt: "x", messages: [] });
    const { result } = renderHook(() => useChatSession(true));
    await act(async () => {
      await result.current.openConversation("conv-1", "T");
    });
    expect(result.current.title).toBe("T");

    act(() => {
      result.current.newChat();
    });
    expect(result.current.title).toBeNull();
    expect(result.current.messages).toEqual([]);
  });
});
