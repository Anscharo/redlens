// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
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

  it("applies an 'error' SSE event: sets error state, finalizes, and marks the message failed", async () => {
    mockChat([{ type: "error", message: "the model errored" }]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.error).toBe("the model errored");
    expect(result.current.messages.at(-1)?.done).toBe(true);
    expect(result.current.messages.at(-1)?.failed).toBe(true);
    expect(result.current.messages.at(-1)?.content).toBe("");
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

describe("useChatStream export events", () => {
  // jsdom has no URL.createObjectURL/revokeObjectURL — stub them so the
  // auto-download path in dispatch runs fully instead of throwing.
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  });

  it("auto-downloads a csv export and records the artifact on the message", async () => {
    mockChat([
      { type: "export", format: "csv", filename: "data.csv", mime: "text/csv;charset=utf-8", content: '"A"\r\n"1"', bytes: 8 },
      { type: "token", text: "Your file is downloading." },
      { type: "done", content: "Your file is downloading.", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("export it");
    });
    const exports = result.current.messages.at(-1)?.exports;
    expect(exports).toHaveLength(1);
    expect(exports?.[0]).toMatchObject({ format: "csv", filename: "data.csv" });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("rewrites in-app atlas links to absolute URLs in a markdown export", async () => {
    mockChat([
      {
        type: "export",
        format: "markdown",
        filename: "report.md",
        mime: "text/markdown;charset=utf-8",
        content: "See [Doc](/atlas/11111111-1111-1111-1111-111111111111).",
        bytes: 10,
      },
      { type: "done", content: "Done.", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("export it");
    });
    const content = result.current.messages.at(-1)?.exports?.[0].content ?? "";
    expect(content).toContain("/atlas?id=11111111-1111-1111-1111-111111111111");
    expect(content).not.toContain("(/atlas/11111111");
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

  it("429 rate_limited sets the message, resetsAt, and kind: 'token'", async () => {
    mockStatus(429, {
      error: "rate_limited",
      message: "Usage limit reached, come back later",
      resetsAt: "2026-01-01T00:00:00Z",
    });
    const { result } = renderHook(() => useChatStream());
    let sendResult: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      sendResult = await result.current.send("question");
    });
    expect(sendResult).toEqual({
      rateLimited: { message: "Usage limit reached, come back later", resetsAt: "2026-01-01T00:00:00Z", kind: "token" },
    });
    // Deliberately not surfaced as `error` — a 429 is fully explained by the
    // returned `rateLimited` (drives RateLimitNote) and the thread content
    // below, so `error` (which drives the separate ErrorNote) stays clear.
    // Otherwise the stale 429 text would resurface as an "error" banner the
    // instant the rate-limit lock lifts.
    expect(result.current.error).toBeNull();
    expect(result.current.messages.at(-1)?.content).toBe("Usage limit reached, come back later");
  });

  it("429 commons_exhausted has no resetsAt and reports kind: 'commons'", async () => {
    mockStatus(429, {
      error: "commons_exhausted",
      message: "The shared usage pool is out of credits.",
    });
    const { result } = renderHook(() => useChatStream());
    let sendResult: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      sendResult = await result.current.send("question");
    });
    expect(sendResult).toEqual({
      rateLimited: { message: "The shared usage pool is out of credits.", resetsAt: undefined, kind: "commons" },
    });
    expect(result.current.error).toBeNull();
  });

  it("429 falls back to kind: 'token' from resetsAt presence when the error discriminator is missing", async () => {
    mockStatus(429, { message: "Usage limit reached, come back later", resetsAt: "2026-01-01T00:00:00Z" });
    const { result } = renderHook(() => useChatStream());
    let sendResult: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      sendResult = await result.current.send("question");
    });
    expect(sendResult?.rateLimited?.kind).toBe("token");
  });

  it("429 falls back to a default message and kind: 'commons' when the body has none", async () => {
    mockStatus(429, {});
    const { result } = renderHook(() => useChatStream());
    let sendResult: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      sendResult = await result.current.send("question");
    });
    expect(sendResult?.rateLimited?.message).toBe("Usage limit reached.");
    expect(sendResult?.rateLimited?.kind).toBe("commons");
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
  it("a network error sets the error state, finalizes, and marks the message failed", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.error).toBe("network down");
    expect(result.current.messages.at(-1)?.done).toBe(true);
    expect(result.current.messages.at(-1)?.failed).toBe(true);
    expect(result.current.streaming).toBe(false);
  });

  it("clears a previous error as soon as a new send is attempted", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.error).toBe("network down");

    mockChat([{ type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] }]);
    await act(async () => {
      await result.current.send("question two");
    });
    expect(result.current.error).toBeNull();
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

describe("useChatStream hydrate", () => {
  it("seeds messages + conversationId, clearing error/streaming", () => {
    const { result } = renderHook(() => useChatStream());
    const seeded = [
      { role: "user" as const, content: "hi", trace: [], rounds: 0, sources: [], done: true },
      { role: "assistant" as const, content: "hello", trace: [], rounds: 0, sources: [], done: true },
    ];
    act(() => {
      result.current.hydrate("conv-1", seeded);
    });
    expect(result.current.conversationId).toBe("conv-1");
    expect(result.current.messages).toEqual(seeded);
    expect(result.current.error).toBeNull();
    expect(result.current.streaming).toBe(false);
  });

  it("hydrate(null, []) clears to a fresh chat", () => {
    const { result } = renderHook(() => useChatStream());
    act(() => {
      result.current.hydrate("conv-1", [{ role: "user", content: "hi", trace: [], rounds: 0, sources: [], done: true }]);
    });
    act(() => {
      result.current.hydrate(null, []);
    });
    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it("aborts an in-flight stream first, so a late (already-inflight) event cannot corrupt the newly hydrated array", async () => {
    const encoder = new TextEncoder();
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    let signalRef: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signalRef = init?.signal ?? undefined;
        // Mirror real fetch/undici: aborting after the response begins errors
        // the body stream, which is what actually stops the read loop below —
        // this is the behavior hydrate's "abort first" depends on.
        signalRef?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          controllerRef!.error(err);
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }),
    );

    const { result } = renderHook(() => useChatStream());
    let sendPromise: Promise<unknown> | undefined;
    act(() => {
      sendPromise = result.current.send("question");
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    // Real content streams in first, so there's something to corrupt.
    await act(async () => {
      controllerRef!.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "token", text: "partial" })}\n\n`));
    });
    await waitFor(() => expect(result.current.messages.at(-1)?.content).toBe("partial"));

    const restored = [{ role: "user" as const, content: "restored", trace: [], rounds: 0, sources: [], done: true }];
    act(() => {
      result.current.hydrate("other-conv", restored);
    });
    expect(result.current.conversationId).toBe("other-conv");
    expect(result.current.messages).toEqual(restored);

    // Let the old stream's now-erroring read() reject and its catch/finally run.
    await act(async () => {
      await sendPromise;
    });

    // The old stream's rejection must not have touched the hydrated array.
    expect(result.current.messages).toEqual(restored);
    expect(result.current.streaming).toBe(false);
  });
});

describe("useChatStream 404 conversation_not_found", () => {
  it("clears the conversation id and finalizes as failed, without setting the generic error banner", async () => {
    mockStatus(404, { error: "conversation_not_found" });
    const { result } = renderHook(() => useChatStream());
    act(() => {
      result.current.hydrate("dead-conv", []);
    });
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.conversationId).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.messages.at(-1)?.failed).toBe(true);
    expect(result.current.messages.at(-1)?.done).toBe(true);
    expect(result.current.streaming).toBe(false);
  });

  it("a 404 with a different/no error body still surfaces as the generic error", async () => {
    mockStatus(404, { error: "not_found" });
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.error).toMatch(/chat request failed \(404\)/);
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

describe("useChatStream staged delivery: meta capture + stageLog", () => {
  it("captures delivery from the meta event onto the message", async () => {
    mockChat([
      { type: "meta", conversationId: "c1", delivery: "staged" },
      { type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.messages.at(-1)?.delivery).toBe("staged");
  });

  it("leaves delivery undefined when meta omits it", async () => {
    mockChat([
      { type: "meta", conversationId: "c1" },
      { type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    expect(result.current.messages.at(-1)?.delivery).toBeUndefined();
  });

  it("appends a new stageLog row per distinct stage, in order", async () => {
    mockChat([
      { type: "status", stage: "querying", detail: "Searching…" },
      { type: "status", stage: "comparing", detail: "Comparing 2 results…" },
      { type: "status", stage: "finalizing" },
      { type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    const log = result.current.messages.at(-1)?.stageLog;
    expect(log).toEqual([
      { stage: "querying", detail: "Searching…", at: 0 },
      { stage: "comparing", detail: "Comparing 2 results…", at: 1 },
      { stage: "finalizing", detail: null, at: 2 },
    ]);
  });

  it("coalesces consecutive same-stage events into one row, keeping the latest detail", async () => {
    mockChat([
      { type: "status", stage: "querying", detail: "Searching atlas_search…" },
      { type: "status", stage: "querying", detail: "Searching atlas_get…" },
      { type: "status", stage: "checking", detail: "Auditing…" },
      { type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    ]);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    const log = result.current.messages.at(-1)?.stageLog;
    expect(log).toEqual([
      { stage: "querying", detail: "Searching atlas_get…", at: 0 },
      { stage: "checking", detail: "Auditing…", at: 1 },
    ]);
  });

  it("a stage recorded before stop() survives finalizeLast — stop() doesn't wipe stageLog", async () => {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(stream, { status: 200 }))));
    const { result } = renderHook(() => useChatStream());

    let sendPromise: Promise<unknown> | undefined;
    act(() => {
      sendPromise = result.current.send("question");
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    const encoder = new TextEncoder();
    controllerRef!.enqueue(
      encoder.encode(`data: ${JSON.stringify({ type: "status", stage: "querying", detail: "Searching…" })}\n\n`),
    );
    await waitFor(() =>
      expect(result.current.messages.at(-1)?.stageLog).toEqual([{ stage: "querying", detail: "Searching…", at: 0 }]),
    );

    act(() => {
      result.current.stop();
    });
    expect(result.current.messages.at(-1)?.stageLog).toEqual([{ stage: "querying", detail: "Searching…", at: 0 }]);
    expect(result.current.messages.at(-1)?.done).toBe(true);

    // Unblock and finish the stream so nothing leaks into later tests.
    await act(async () => {
      controllerRef!.close();
      await sendPromise;
    });
  });
});

describe("useChatStream send(delivery) → POST body", () => {
  function fetchMockWithBody() {
    return vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          sse([{ type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] }]),
          { status: 200 },
        ),
      ),
    );
  }

  it("includes delivery in the request body when provided", async () => {
    const fetchMock = fetchMockWithBody();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question", undefined, "staged");
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.delivery).toBe("staged");
  });

  it("omits delivery from the request body when not provided", async () => {
    const fetchMock = fetchMockWithBody();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("question");
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.delivery).toBeUndefined();
  });
});
