import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { judgeSmalltalkJev, SMALLTALK_QUESTION, SMALLTALK_JEV_THRESHOLD } from "./smalltalk-jev.ts";
import { config } from "../../config.ts";

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
// Stubbed fetch, so nothing leaves the process — but askJev refuses to build a
// request without a key, and CI has none.
beforeEach(() => {
  config.openrouterApiKey = "test-key";
  lastBody = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
});

let lastBody: any = null;
function answering(noul: number | null, status = 200) {
  globalThis.fetch = (async (_url: any, init: any) => {
    lastBody = JSON.parse(init.body);
    if (status !== 200) return new Response("nope", { status });
    const answers = noul === null ? { smalltalk: { type: "choice", choice: "x" } } : { smalltalk: { type: "noul", noul } };
    return new Response(JSON.stringify({ answers, usage: { input_tokens: 340, output_tokens: 22, cost: 0.0000143 }, id: "gen-dec-1" }), { status: 200 });
  }) as typeof fetch;
}

describe("judgeSmalltalkJev", () => {
  it("rules small talk above the threshold and keeps the raw probability", async () => {
    answering(0.96);
    const r = await judgeSmalltalkJev({ question: "thanks!" });
    expect(r.smalltalk).toBe(true);
    expect(r.p).toBe(0.96);
    expect(r.costUsd).toBe(0.0000143);
    expect(r.generationId).toBe("gen-dec-1");
    expect(r.usage).toEqual({ input: 340, output: 22 });
  });

  it("rules factual below the threshold", async () => {
    answering(0.2);
    expect((await judgeSmalltalkJev({ question: "what is a scope?" })).smalltalk).toBe(false);
  });

  it("honours a caller-supplied threshold — the operating point is ours, not the model's", async () => {
    answering(0.6);
    expect((await judgeSmalltalkJev({ question: "hi" })).smalltalk).toBe(false);
    expect((await judgeSmalltalkJev({ question: "hi", threshold: 0.5 })).smalltalk).toBe(true);
  });

  // The measured bounds (eval-smalltalk-judge.ts, 420 calls): no factual case
  // scored above 0.52, no small-talk case below 0.75. A threshold outside that
  // gap misrules a class that the bakeoff proved separable.
  it("sits inside the measured separation gap", async () => {
    answering(0.52);
    expect((await judgeSmalltalkJev({ question: "is that everything?" })).smalltalk).toBe(false);
    answering(0.75);
    expect((await judgeSmalltalkJev({ question: "bonjour" })).smalltalk).toBe(true);
  });

  it("is fail-closed on a transport error — no ruling means full audit", async () => {
    answering(0.99, 500);
    const r = await judgeSmalltalkJev({ question: "hello" });
    expect(r.smalltalk).toBe(false);
    expect(r.p).toBeNull();
    expect(r.latencyMs).toBeNull();
  });

  // askJev retries a 5xx three times with 500/1000/2000ms backoff. The judge
  // is awaited before the turn finishes, so the deadline must be a wall, not
  // a per-attempt budget.
  it("honours its timeout as a DEADLINE across retries, not per attempt", async () => {
    answering(0.9, 503);
    const t0 = Date.now();
    const r = await judgeSmalltalkJev({ question: "hello", timeoutMs: 700 });
    const elapsed = Date.now() - t0;
    expect(r.smalltalk).toBe(false);
    expect(elapsed).toBeLessThan(2000); // un-deadlined retries would take ~3.5s+
  });

  it("is fail-closed when the answer comes back the wrong type", async () => {
    answering(null);
    const r = await judgeSmalltalkJev({ question: "hello" });
    expect(r.smalltalk).toBe(false);
    expect(r.p).toBeNull();
  });

  it("sends the message as named state and truncates a long one", async () => {
    answering(0.1);
    await judgeSmalltalkJev({ question: "x".repeat(5000) });
    expect(lastBody.state.message).toHaveLength(2000);
    expect(lastBody.questions.smalltalk.type).toBe("noul");
  });
});

describe("SMALLTALK_QUESTION criteria", () => {
  // The dangerous error class is a casual phrasing that asks for facts. Jev
  // reads literally, so these must be stated, not implied.
  it("names the casual-factual phrasings verbatim in the false criterion", () => {
    const f = String((SMALLTALK_QUESTION.criteria as any).false);
    for (const phrase of ["what's new?", "any updates?", "help", "what can you do?", "who are you?"]) {
      expect(f).toContain(phrase);
    }
    expect(f).toMatch(/either way, false/i);
  });

  it("defaults inside the measured separation gap (0.52 factual max / 0.75 small-talk min)", () => {
    expect(SMALLTALK_JEV_THRESHOLD).toBeGreaterThan(0.52);
    expect(SMALLTALK_JEV_THRESHOLD).toBeLessThan(0.75);
  });
});
