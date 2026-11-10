import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { choiceRequest, rerankConfig, rerankHead } from "./rerank.ts";
import { config } from "../config.ts";
import type { AtlasNode } from "../../types.ts";

const node = (id: string, title: string, parentId: string | null = null): AtlasNode =>
  ({ id, doc_no: `A.${id}`, title, parentId, content: `${title} body`, type: "Core", depth: 1, order: 0, addressRefs: [] }) as unknown as AtlasNode;
const docMap = new Map(["a", "b", "c", "d"].map((id) => [id, node(id, `Doc ${id}`)]));
const items = ["a", "b", "c", "d"].map((id) => ({ id }));
const idOf = (t: { id: string }) => t.id;

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
const realRerank = { ...rerankConfig };
let calls = 0;
let lastBody: { state: { query: string; candidates: Record<string, unknown> }; questions: Record<string, unknown> } | null = null;

function answering(probabilities: Record<string, number>, status = 200) {
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    calls++;
    lastBody = JSON.parse(init.body);
    if (status !== 200) return new Response("bad question", { status });
    const choice = Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0]![0];
    const answers = { best: { type: "choice", choice, probabilities, confidence: 0.9 } };
    return new Response(JSON.stringify({ answers, usage: { input_tokens: 900, output_tokens: 5, cost: 0.0003 }, id: "gen-dec-rr" }), { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = 0;
  config.openrouterApiKey = "test-key"; // the fetch is stubbed; askJev refuses to build a request without a key
  Object.assign(rerankConfig, { model: "typesafe/jev-test", pool: 3, deadlineMs: 1000 });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
  Object.assign(rerankConfig, realRerank);
});

describe("choiceRequest", () => {
  it("names one option per candidate, in order, plus none", () => {
    const req = choiceRequest("q", ["a", "b"], new Map([["a", node("a", "Rate Limits", "b")], ["b", node("b", "Spark")]]));
    expect(req.keys).toEqual(["c01", "c02"]);
    const criteria = (req.questions.best as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(criteria)).toEqual(["c01", "c02", "none"]);
    expect(criteria.c01).toContain("Spark › A.a Rate Limits");
  });
});

describe("rerankHead", () => {
  it("moves the pick up inside the pool and leaves the tail alone", async () => {
    answering({ c01: 0.01, c02: 0.0, c03: 0.97, none: 0.02 });
    const out = await rerankHead("which one", items, idOf, docMap);
    expect(out.map(idOf)).toEqual(["c", "a", "b", "d"]);
    expect(Object.keys(lastBody!.state.candidates)).toEqual(["c01", "c02", "c03"]);
  });

  it("reuses the order for the same query and head without a second call", async () => {
    answering({ c01: 0.0, c02: 0.9, c03: 0.1, none: 0.0 });
    await rerankHead("paged", items, idOf, docMap);
    const again = await rerankHead("paged", items, idOf, docMap);
    expect(calls).toBe(1);
    expect(again.map(idOf)).toEqual(["b", "c", "a", "d"]);
  });

  it("shares one call between pages fetched at the same time", async () => {
    answering({ c01: 0.0, c02: 0.9, c03: 0.1, none: 0.0 });
    const [first, second] = await Promise.all([rerankHead("together", items, idOf, docMap), rerankHead("together", items, idOf, docMap, 2)]);
    expect(calls).toBe(1);
    expect(first).toEqual(second);
  });

  it("makes no call for a page that starts past the head", async () => {
    answering({ c01: 1 });
    expect(await rerankHead("deep", items, idOf, docMap, 3)).toBe(items);
    expect(calls).toBe(0);
  });

  it("is off with an empty model or no OpenRouter key and makes no call", async () => {
    answering({ c01: 1 });
    rerankConfig.model = "";
    expect(await rerankHead("q", items, idOf, docMap)).toBe(items);
    rerankConfig.model = "typesafe/jev-test";
    config.openrouterApiKey = "";
    expect(await rerankHead("q", items, idOf, docMap)).toBe(items);
    expect(calls).toBe(0);
  });

  it("keeps the fused order when the call fails, and tries again on the next search", async () => {
    answering({}, 400);
    expect(await rerankHead("fails", items, idOf, docMap)).toBe(items);
    expect(await rerankHead("fails", items, idOf, docMap)).toBe(items);
    expect(calls).toBe(2);
  });

  it("keeps the fused order at the deadline", async () => {
    // A hung request that ends only when the wall-clock signal aborts it, as fetch does.
    globalThis.fetch = ((_url: unknown, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))) as unknown as typeof fetch;
    rerankConfig.deadlineMs = 20;
    const t0 = performance.now();
    expect(await rerankHead("hangs", items, idOf, docMap)).toBe(items);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
