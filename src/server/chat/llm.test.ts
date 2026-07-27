// llm.ts: OpenRouter client wiring. No real network — globalThis.fetch is
// mocked (the openai SDK reads global fetch when no override is passed to the
// client), always restored in a finally so sibling test files in this run
// never see the mock. config.openrouterApiKey is set once (module-level
// OpenAI client singletons are lazy) so client construction doesn't throw on
// the empty-string default; restored afterward like model-router.test.ts does
// for its config mutations.
import { describe, it, expect, afterAll } from "bun:test";
import { config } from "../config.ts";
import {
  getModel,
  callWithTimeout,
  makeOpenrouterJson,
  makeOpenrouterStream,
  type JsonCall,
} from "./llm.ts";

// The openai SDK client captures `globalThis.fetch` ONCE at construction time
// (this.fetch = options.fetch ?? getDefaultFetch()) — and llm.ts's client/
// chatClient are lazy module singletons that live for the WHOLE bun test
// process, shared with any other test file in this run that also imports
// llm.ts (e.g. chat.test.ts drives handleChat through the real llm.ts too).
// Whichever file's test triggers the first construction wins the fetch
// binding — so the dispatcher must live on globalThis (installed once,
// idempotently) rather than as a file-local variable, or the two files would
// race to install their own and one would silently never be called.
const savedOpenrouterKey = config.openrouterApiKey;
config.openrouterApiKey ||= "test-key";
// Restore the key so later files (e.g. chat/tools/tool-registry.test.ts) don't
// inherit a truthy key that activates embed's network path against the shared
// (throwing) fetch dispatcher. config mutations are process-global under bun.
afterAll(() => {
  config.openrouterApiKey = savedOpenrouterKey;
});
const g = globalThis as unknown as { __llmFetchCurrentImpl?: typeof fetch; __llmFetchDispatcher?: typeof fetch };
if (!g.__llmFetchDispatcher) {
  g.__llmFetchCurrentImpl = (() => {
    throw new Error("no fetch impl set for this test");
  }) as unknown as typeof fetch;
  g.__llmFetchDispatcher = ((...args: Parameters<typeof fetch>) => g.__llmFetchCurrentImpl!(...args)) as typeof fetch;
  globalThis.fetch = g.__llmFetchDispatcher;
}

function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const prev = g.__llmFetchCurrentImpl!;
  g.__llmFetchCurrentImpl = impl;
  return fn().finally(() => {
    g.__llmFetchCurrentImpl = prev;
  });
}

describe("getModel", () => {
  it("returns config.chatModel", () => {
    const saved = config.chatModel;
    try {
      config.chatModel = "vendor/some-model";
      expect(getModel()).toBe("vendor/some-model");
    } finally {
      config.chatModel = saved;
    }
  });
});

describe("callWithTimeout", () => {
  it("resolves normally when the call finishes before the deadline", async () => {
    const call: JsonCall = async () => ({
      text: "ok",
      usage: { input: 1, output: 2 },
      generationId: "gen-1",
      latencyMs: 5,
    });
    const result = await callWithTimeout(call, { model: "m", messages: [] }, 5_000);
    expect(result.text).toBe("ok");
    expect(result.generationId).toBe("gen-1");
  });

  it("rejects and aborts the call's signal when the deadline elapses", async () => {
    let sawAbort = false;
    const call: JsonCall = ({ signal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => {
          sawAbort = true;
          reject(new Error("aborted"));
        });
      });
    await expect(callWithTimeout(call, { model: "m", messages: [] }, 10)).rejects.toThrow();
    // Give the abort listener a tick to run — it fires synchronously off the same timer.
    await new Promise((r) => setTimeout(r, 20));
    expect(sawAbort).toBe(true);
  });

  it("combines an external abort signal with the internal timeout signal", async () => {
    const outer = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const call: JsonCall = ({ signal }) => {
      receivedSignal = signal;
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    const p = callWithTimeout(call, { model: "m", messages: [] }, 5_000, outer.signal);
    outer.abort(new Error("client disconnected"));
    await expect(p).rejects.toThrow();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("does not leave the call running after a successful early resolve (timer cleared)", async () => {
    const call: JsonCall = async () => ({
      text: "fast",
      usage: { input: 0, output: 0 },
      generationId: null,
      latencyMs: 1,
    });
    // If the internal timer weren't cleared, this would eventually fire and
    // could reject a later unrelated call in the same tick pool — just assert
    // the happy path settles cleanly within the timeout window.
    const result = await callWithTimeout(call, { model: "m", messages: [] }, 50);
    expect(result.text).toBe("fast");
  });
});

describe("makeOpenrouterJson", () => {
  it("builds a non-streaming json_object request and parses the response", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    let capturedUrl = "";
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "gen-xyz",
          choices: [{ message: { content: '{"answer":42}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const jsonCall = makeOpenrouterJson();
    const result = await withFetch(fakeFetch, () =>
      jsonCall({ model: "m/verify", messages: [{ role: "user", content: "hi" }], maxTokens: 100 }),
    );

    expect(result.text).toBe('{"answer":42}');
    expect(result.usage).toEqual({ input: 10, output: 3 });
    expect(result.generationId).toBe("gen-xyz");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(capturedUrl).toContain("/chat/completions");
    expect(capturedBody).not.toBeNull();
    const body = capturedBody as unknown as Record<string, unknown>;
    expect(body.model).toBe("m/verify");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(100);
    // No PostHog key configured in this test env → no posthog* params leak into the body.
    expect(Object.keys(body).some((k) => k.toLowerCase().startsWith("posthog"))).toBe(false);
  });

  it("omits max_tokens entirely when not provided", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "gen-1", choices: [{ message: { content: "{}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const jsonCall = makeOpenrouterJson();
    await withFetch(fakeFetch, () => jsonCall({ model: "m", messages: [] }));
    expect("max_tokens" in (capturedBody as unknown as Record<string, unknown>)).toBe(false);
  });

  it("falls back generationId to null when the response id doesn't start with gen-", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ id: "chatcmpl-abc", choices: [{ message: { content: "x" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const jsonCall = makeOpenrouterJson();
    const result = await withFetch(fakeFetch, () => jsonCall({ model: "m", messages: [] }));
    expect(result.generationId).toBeNull();
  });

  it("defaults text to empty string and usage to zeros when the response omits them", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ id: "gen-empty", choices: [{}] }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const jsonCall = makeOpenrouterJson();
    const result = await withFetch(fakeFetch, () => jsonCall({ model: "m", messages: [] }));
    expect(result.text).toBe("");
    expect(result.usage).toEqual({ input: 0, output: 0 });
  });

  it("the anonymous default export openrouterJson also works without a request context", async () => {
    const { openrouterJson } = await import("./llm.ts");
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ id: "gen-def", choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const result = await withFetch(fakeFetch, () => openrouterJson({ model: "m", messages: [] }));
    expect(result.text).toBe("ok");
  });
});

function sseResponse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

describe("makeOpenrouterStream", () => {
  it("streams chunks from an SSE response and sends the expected request body", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const chunks = [
      { id: "gen-s1", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] },
      { id: "gen-s1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return sseResponse(chunks);
    }) as unknown as typeof fetch;

    const stream = makeOpenrouterStream();
    const received: unknown[] = [];
    await withFetch(fakeFetch, async () => {
      for await (const chunk of stream({ messages: [{ role: "user", content: "hi" }], tools: [], toolChoice: "auto" })) {
        received.push(chunk);
      }
    });

    expect(received).toHaveLength(2);
    expect((received[0] as { id: string }).id).toBe("gen-s1");

    const body = capturedBody as unknown as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.tool_choice).toBe("auto");
    // Single-entry chain (default getModel()) → no `models` fallback field.
    expect("models" in body).toBe(false);
    expect(body.model).toBe(config.chatModel);
  });

  it("sends a `models` fallback list when given more than one model in the chain", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return sseResponse([{ id: "gen-s2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]);
    }) as unknown as typeof fetch;

    const stream = makeOpenrouterStream({}, ["primary/model", "fallback/model"]);
    await withFetch(fakeFetch, async () => {
      for await (const _c of stream({ messages: [], tools: [], toolChoice: "none" })) {
        // drain
      }
    });

    const body = capturedBody as unknown as Record<string, unknown>;
    expect(body.model).toBe("primary/model");
    expect(body.models).toEqual(["primary/model", "fallback/model"]);
  });

  it("the anonymous default export openrouterStream also works without a request context", async () => {
    const { openrouterStream } = await import("./llm.ts");
    const fakeFetch = (async () =>
      sseResponse([{ id: "gen-def2", choices: [{ index: 0, delta: { content: "hey" }, finish_reason: null }] }])) as unknown as typeof fetch;
    const received: unknown[] = [];
    await withFetch(fakeFetch, async () => {
      for await (const chunk of openrouterStream({ messages: [], tools: [], toolChoice: "auto" })) {
        received.push(chunk);
      }
    });
    expect(received).toHaveLength(1);
  });
});
