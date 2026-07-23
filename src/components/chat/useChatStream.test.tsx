// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
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

// Builds a raw SSE body from literal frame text (not JSON-encoded events) so
// malformed/heartbeat frames can be exercised directly.
function rawSse(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
}

function mockRaw(frames: string[], status = 200) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(rawSse(frames), { status }))));
}

function mockStatus(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        body: null,
        json: () => Promise.resolve(body),
      } as unknown as Response),
    ),
  );
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

describe("useChatStream event dispatch", () => {
  it("applies a verify_result event to the last message", async () => {
    mockChat([
      { type: "meta", conversationId: "c1" },
      {
        type: "verify_result",
        overall: "warn",
        confidence: 0.5,
        action: "annotate",
        claims: [{ claim: "x", status: "unsupported" }],
        invalidCitations: [],
        invalidDocNos: [],
        docNoMismatches: [],
        ungroundedQuotes: [],
        ungroundedAddresses: [],
      },
      { type: "done", content: "Done", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.messages.at(-1)?.verify?.status).toBe("warn");
  });

  it("marks verify as revised when the action is 'revised' regardless of overall", async () => {
    mockChat([
      {
        type: "verify_result",
        overall: "fail",
        confidence: 0.1,
        action: "revised",
        claims: [],
        invalidCitations: [],
        invalidDocNos: [],
        docNoMismatches: [],
        ungroundedQuotes: [],
        ungroundedAddresses: [],
      },
      { type: "done", content: "Done", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.messages.at(-1)?.verify?.status).toBe("revised");
  });

  it("clears leaked answer fragments on a 'clear' event (tool round discard)", async () => {
    mockChat([
      { type: "token", text: "partial leaked text" },
      { type: "clear" },
      { type: "tool_call", name: "atlas_get", args: { id: "x" } },
      { type: "tool_result", name: "atlas_get", ok: true, bytes: 5 },
      { type: "token", text: "real answer" },
      { type: "done", content: "real answer", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.messages.at(-1)?.content).toBe("real answer");
  });

  it("applies an 'error' SSE event: sets error state and finalizes the message", async () => {
    mockChat([{ type: "error", message: "the model errored" }]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.error).toBe("the model errored");
    expect(result.current.messages.at(-1)?.done).toBe(true);
  });

  it("skips a heartbeat/comment frame with no data: line", async () => {
    mockRaw([
      ": heartbeat\n\n",
      `data: ${JSON.stringify({ type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] })}\n\n`,
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.messages.at(-1)?.content).toBe("ok");
  });

  it("skips a data: frame with an empty payload", async () => {
    mockRaw([
      "data: \n\n",
      `data: ${JSON.stringify({ type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] })}\n\n`,
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.messages.at(-1)?.content).toBe("ok");
  });

  it("skips a data: frame with unparsable JSON", async () => {
    mockRaw([
      "data: {not json\n\n",
      `data: ${JSON.stringify({ type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] })}\n\n`,
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.messages.at(-1)?.content).toBe("ok");
  });
});

describe("useChatStream HTTP status handling", () => {
  it("401 triggers onAuthError, finalizes the message, and returns no rateLimited", async () => {
    mockStatus(401);
    const onAuthError = vi.fn();
    const { result } = renderHook(() => useChatStream({ onAuthError }));
    let sendResult: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      sendResult = await result.current.send("question");
    });
    expect(onAuthError).toHaveBeenCalled();
    expect(sendResult).toEqual({});
    expect(result.current.messages.at(-1)?.done).toBe(true);
    expect(result.current.streaming).toBe(false);
  });

  it("429 sets the rate-limit message and returns resetsAt", async () => {
    mockStatus(429, { message: "Usage limit reached, come back later", resetsAt: "2026-01-01T00:00:00Z" });
    const { result } = renderHook(() => useChatStream());
    let sendResult: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      sendResult = await result.current.send("question");
    });
    expect(sendResult).toEqual({
      rateLimited: { message: "Usage limit reached, come back later", resetsAt: "2026-01-01T00:00:00Z" },
    });
    expect(result.current.error).toBe("Usage limit reached, come back later");
    expect(result.current.messages.at(-1)?.content).toBe("Usage limit reached, come back later");
  });

  it("429 falls back to a default message when the body has none", async () => {
    mockStatus(429, {});
    const { result } = renderHook(() => useChatStream());
    let sendResult: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      sendResult = await result.current.send("question");
    });
    expect(sendResult?.rateLimited?.message).toBe("Usage limit reached.");
  });

  it("a non-ok, non-401/429 response is thrown and caught as a generic error", async () => {
    mockStatus(500);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.error).toMatch(/chat request failed \(500\)/);
    expect(result.current.messages.at(-1)?.done).toBe(true);
  });

  it("an ok response with no body is thrown and caught as a generic error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200, ok: true, body: null } as unknown as Response)));
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.error).toMatch(/chat request failed \(200\)/);
  });
});

describe("useChatStream network/abort error handling", () => {
  it("a network error sets the error state and finalizes the message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.error).toBe("network down");
    expect(result.current.messages.at(-1)?.done).toBe(true);
    expect(result.current.streaming).toBe(false);
  });

  it("an AbortError is treated as expected (no error surfaced)", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(abortErr)));
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.error).toBeNull();
    expect(result.current.streaming).toBe(false);
  });
});

describe("useChatStream send guards", () => {
  it("ignores a whitespace-only message without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChatStream());
    let sendResult: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      sendResult = await result.current.send("   ");
    });
    expect(sendResult).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it("ignores a concurrent second send while the first is still streaming", async () => {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(stream, { status: 200 }))));
    const { result } = renderHook(() => useChatStream());

    let firstDone: Promise<unknown> | undefined;
    act(() => {
      firstDone = result.current.send("first");
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    let secondResult: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      secondResult = await result.current.send("second");
    });
    expect(secondResult).toEqual({});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Unblock and finish the first stream so nothing leaks into later tests.
    const encoder = new TextEncoder();
    await act(async () => {
      controllerRef!.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "done", content: "done", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] })}\n\n`,
        ),
      );
      controllerRef!.close();
      await firstDone;
    });
  });
});

describe("useChatStream stop/reset", () => {
  it("stop() aborts the in-flight request and finalizes the last message", async () => {
    // Mimic real fetch's abort-signal behavior: reject with an AbortError as
    // soon as the caller's AbortController fires, instead of resolving.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );
    const { result } = renderHook(() => useChatStream());

    let sendPromise: Promise<unknown> | undefined;
    act(() => {
      sendPromise = result.current.send("question");
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    act(() => {
      result.current.stop();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.messages.at(-1)?.done).toBe(true);
    await act(async () => {
      await sendPromise;
    });
  });

  it("reset() clears messages, error, and streaming state", async () => {
    mockChat([
      { type: "meta", conversationId: "c1" },
      { type: "done", content: "hi", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.messages.length).toBeGreaterThan(0);

    act(() => {
      result.current.reset();
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.streaming).toBe(false);
  });
});
