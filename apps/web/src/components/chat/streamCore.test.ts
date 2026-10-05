import { describe, expect, it, vi } from "vitest";
import { createStreamCore, failIfPending, finalizeMsg, patchLastMsg, streamControls } from "./streamCore";
import type { ChatMsg } from "./chatTypes";

const msg = (over: Partial<ChatMsg> = {}): ChatMsg => ({
  role: "assistant", content: "", draft: "", generated: false, trace: [], rounds: 0, sources: [], done: false, ...over,
});

describe("message operations", () => {
  it("patchLastMsg replaces only the last message and leaves an empty thread alone", () => {
    const prev = [msg({ content: "a" }), msg({ content: "b" })];
    const next = patchLastMsg(prev, (m) => ({ ...m, content: "c" }));
    expect(next.map((m) => m.content)).toEqual(["a", "c"]);
    expect(patchLastMsg([], (m) => m)).toEqual([]);
  });
  it("finalizeMsg ends an assistant turn and drops a still-checking verdict", () => {
    const m = finalizeMsg(msg({ statusLine: "x", verify: { status: "checking" } as ChatMsg["verify"] }), { failed: true });
    expect(m).toMatchObject({ done: true, statusLine: null, verify: undefined, failed: true });
    expect(finalizeMsg(msg({ role: "user" }))).toEqual(msg({ role: "user" }));
  });
  it("failIfPending fails only a turn that is still running", () => {
    expect(failIfPending(msg())).toMatchObject({ done: true, failed: true });
    expect(failIfPending(msg({ done: true })).failed).toBeUndefined();
  });
});

describe("streamControls", () => {
  it("hydrate aborts the in-flight stream before swapping the thread", () => {
    const calls: string[] = [];
    const ctrl = new AbortController();
    ctrl.signal.addEventListener("abort", () => calls.push("abort"));
    const core = createStreamCore({
      setMessages: vi.fn(() => calls.push("messages")),
      setStreaming: vi.fn(),
      setError: vi.fn(),
      setConversationId: vi.fn(() => calls.push("conversation")),
      setContextTokens: vi.fn(),
      convIdRef: { current: null },
      abortRef: { current: ctrl },
    });
    streamControls(core).hydrate("c1", [], 5);
    expect(calls).toEqual(["abort", "conversation", "messages"]);
    expect(core.convIdRef.current).toBe("c1");
    expect(core.abortRef.current).toBeNull();
    expect(core.setContextTokens).toHaveBeenCalledWith(5);
  });
});
