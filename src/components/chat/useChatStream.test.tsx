// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatStream } from "./useChatStream";
import type { ChatEvent } from "./api";

function sse(events: ChatEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      controller.close();
    },
  });
}

function mockChat(events: ChatEvent[]) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(sse(events), { status: 200 }))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useChatStream tool round accounting", () => {
  it("counts a new tool round after the previous tool results complete, even without intervening tokens", async () => {
    mockChat([
      { type: "meta", conversationId: "c1" },
      { type: "tool_call", name: "atlas_query", args: { search: "one" } },
      { type: "tool_result", name: "atlas_query", ok: true, bytes: 10 },
      { type: "status", stage: "querying", detail: "Searching again…" },
      { type: "tool_call", name: "atlas_get", args: { id: "doc" } },
      { type: "tool_result", name: "atlas_get", ok: true, bytes: 20 },
      { type: "token", text: "Done" },
      { type: "done", content: "Done", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });

    expect(result.current.messages.at(-1)?.rounds).toBe(2);
  });

  it("keeps parallel tool calls in the same displayed round until all results arrive", async () => {
    mockChat([
      { type: "meta", conversationId: "c1" },
      { type: "tool_call", name: "atlas_query", args: { search: "one" } },
      { type: "tool_call", name: "atlas_search", args: { q: "two" } },
      { type: "tool_result", name: "atlas_query", ok: true, bytes: 10 },
      { type: "tool_result", name: "atlas_search", ok: true, bytes: 20 },
      { type: "done", content: "Done", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });

    expect(result.current.messages.at(-1)?.rounds).toBe(1);
  });
});
