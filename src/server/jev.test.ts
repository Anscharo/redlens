import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { askJev, noulOf, choiceOf, type JevRun } from "./jev.ts";
import { config } from "./config.ts";

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
// The suite never reaches the network (fetch is stubbed), but askJev refuses to
// build a request without a key — and CI has none.
beforeEach(() => {
  config.openrouterApiKey = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
});

type Call = { url: string; body: any; headers: Record<string, string> };

function stubFetch(responses: (Response | (() => Response))[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    const r = responses[Math.min(i++, responses.length - 1)];
    return typeof r === "function" ? r() : r;
  }) as typeof fetch;
  return calls;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const noulBody = {
  model: "typesafe/jev-1.13-20260917",
  answers: { smalltalk: { type: "noul", noul: 0.96 } },
  usage: { input_tokens: 340, output_tokens: 22, cost: 0.00001428 },
  id: "gen-dec-123",
};

const q = { smalltalk: { type: "noul" as const, instructions: "is it small talk" } };

describe("askJev request shape", () => {
  it("posts to /systemone with the bearer key, the pinned model, and a RECORD of questions", async () => {
    const calls = stubFetch([ok(noulBody)]);
    await askJev({ state: { message: "hi" }, questions: q, model: "typesafe/jev-1.13" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${config.openrouterBaseUrl}/systemone`);
    expect(calls[0].headers.authorization).toBe(`Bearer ${config.openrouterApiKey}`);
    expect(calls[0].body.model).toBe("typesafe/jev-1.13");
    expect(calls[0].body.state).toEqual({ message: "hi" });
    // A record, never an array — the API rejects an array with a 400.
    expect(Array.isArray(calls[0].body.questions)).toBe(false);
    expect(calls[0].body.questions.smalltalk.type).toBe("noul");
  });

  it("maps usage, cost and generation id off the response", async () => {
    stubFetch([ok(noulBody)]);
    const run = await askJev({ state: {}, questions: q, model: "m" });
    expect(run.usage).toEqual({ input: 340, output: 22 });
    expect(run.cost).toBe(0.00001428);
    expect(run.generationId).toBe("gen-dec-123");
    expect(run.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("answer accessors", () => {
  const run = (answers: Record<string, any>): JevRun => ({ answers, usage: null, cost: null, generationId: null, latencyMs: 1 });

  it("noulOf returns the probability, or null for a missing or wrong-typed answer", () => {
    expect(noulOf(run({ a: { type: "noul", noul: 0.4 } }), "a")).toBe(0.4);
    expect(noulOf(run({}), "a")).toBeNull();
    expect(noulOf(run({ a: { type: "choice", choice: "x" } }), "a")).toBeNull();
  });

  it("choiceOf returns the choice answer with its distribution", () => {
    const c = choiceOf(run({ a: { type: "choice", choice: "x", probabilities: { x: 1 }, confidence: 0.9 } }), "a");
    expect(c?.choice).toBe("x");
    expect(c?.confidence).toBe(0.9);
    expect(choiceOf(run({ a: { type: "noul", noul: 1 } }), "a")).toBeNull();
  });
});

describe("askJev failure handling", () => {
  it("throws immediately on a 400 — a malformed question does not improve on retry", async () => {
    const calls = stubFetch([new Response("bad question", { status: 400 })]);
    await expect(askJev({ state: {}, questions: q, model: "m" })).rejects.toThrow(/systemone 400/);
    expect(calls).toHaveLength(1);
  });

  it("retries a 429 and succeeds", async () => {
    const calls = stubFetch([new Response("slow down", { status: 429 }), ok(noulBody)]);
    const run = await askJev({ state: {}, questions: q, model: "m" });
    expect(calls.length).toBe(2);
    expect(noulOf(run, "smalltalk")).toBe(0.96);
  });

  it("retries a 5xx and gives up after a bounded number of attempts", async () => {
    const calls = stubFetch([() => new Response("boom", { status: 503 })]);
    await expect(askJev({ state: {}, questions: q, model: "m" })).rejects.toThrow(/systemone 503/);
    expect(calls).toHaveLength(4); // initial + 3 retries
  });

  it("does not retry once the caller's signal is aborted", async () => {
    const ac = new AbortController();
    const calls = stubFetch([
      () => {
        ac.abort();
        return new Response("boom", { status: 503 });
      },
    ]);
    await expect(askJev({ state: {}, questions: q, model: "m", signal: ac.signal })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("throws on a response carrying no answers rather than returning an empty run", async () => {
    stubFetch([ok({ id: "gen-dec-1" })]);
    await expect(askJev({ state: {}, questions: q, model: "m" })).rejects.toThrow(/no answers/);
  });

  it("throws when no model is configured", async () => {
    const prev = config.chatJevModel;
    config.chatJevModel = "";
    try {
      await expect(askJev({ state: {}, questions: q })).rejects.toThrow(/CHAT_JEV_MODEL/);
    } finally {
      config.chatJevModel = prev;
    }
  });

  it("throws when no API key is set", async () => {
    config.openrouterApiKey = "";
    await expect(askJev({ state: {}, questions: q, model: "m" })).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});
