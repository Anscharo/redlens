import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import {
  judgeQuoteAttribution,
  spansPresentedAsQuotation,
  QUOTE_ATTRIBUTION_QUESTION,
  QUOTE_ATTRIBUTION_MAX_SPANS,
} from "./quote-attribution.ts";
import { config } from "../../config.ts";

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
// Stubbed fetch, so nothing leaves the process — but askJev refuses to build a
// request without a key, and CI has none.
beforeEach(() => {
  config.openrouterApiKey = "test-key";
  bodies = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
});

let bodies: any[] = [];
/** Answers each request by looking up its passage, so per-span answers are distinguishable. */
function answering(byPassage: Record<string, number | null>, status = 200) {
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (status !== 200) return new Response("nope", { status });
    const noul = byPassage[body.state.passage];
    const answers =
      noul === null || noul === undefined
        ? { quoted: { type: "choice", choice: "x" } }
        : { quoted: { type: "noul", noul } };
    return new Response(
      JSON.stringify({ answers, usage: { input_tokens: 120, output_tokens: 4, cost: 0.0000194 }, id: "gen-dec-1" }),
      { status: 200 },
    );
  }) as typeof fetch;
}

const span = (text: string, leadIn: string) => ({ text, leadIn });

describe("judgeQuoteAttribution", () => {
  it("judges each span independently and keeps the raw probability", async () => {
    answering({ "a quoted atlas passage": 0.93, "my own bottom line": 0.04 });
    const run = await judgeQuoteAttribution({
      spans: [span("a quoted atlas passage", "A.2.4.1 states:"), span("my own bottom line", "The practical lesson is:")],
    });
    expect(run.judgements).toEqual([
      { span: "a quoted atlas passage", p: 0.93 },
      { span: "my own bottom line", p: 0.04 },
    ]);
    // Usage and cost are summed across the per-span requests.
    expect(run.usage).toEqual({ input: 240, output: 8 });
    expect(run.costUsd).toBeCloseTo(0.0000388, 10);
  });

  it("makes no call and reports nothing when there are no spans", async () => {
    answering({});
    const run = await judgeQuoteAttribution({ spans: [] });
    expect(run.judgements).toEqual([]);
    expect(run.latencyMs).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it("sends one request per span, with the lead-in and passage as named state", async () => {
    answering({ "passage one": 0.5, "passage two": 0.5 });
    await judgeQuoteAttribution({ spans: [span("passage one", "lead one"), span("passage two", "lead two")] });
    expect(bodies).toHaveLength(2);
    expect(bodies.map((b) => b.state.passage).sort()).toEqual(["passage one", "passage two"]);
    expect(bodies[0].questions.quoted.type).toBe("noul");
  });

  it("caps the spans it judges, and the lead-in keeps its END (where attribution sits)", async () => {
    answering({});
    const many = Array.from({ length: 20 }, (_, i) => span(`passage ${i}`, "x"));
    await judgeQuoteAttribution({ spans: many });
    expect(bodies).toHaveLength(QUOTE_ATTRIBUTION_MAX_SPANS);

    bodies = [];
    answering({ p: 0.5 });
    // A long lead-in is a paragraph of prose; the attribution, if any, is the
    // clause nearest the quote.
    await judgeQuoteAttribution({ spans: [span("p", `${"filler ".repeat(200)}A.2.4.1 states:`)] });
    expect(bodies[0].state.lead_in).toHaveLength(400);
    expect(bodies[0].state.lead_in.endsWith("A.2.4.1 states:")).toBe(true);
  });

  it("is fail-OPEN on a transport error — a null is never a verdict", async () => {
    answering({ "some passage": 0.99 }, 500);
    const run = await judgeQuoteAttribution({ spans: [span("some passage", "A.2.4.1 states:")] });
    expect(run.judgements).toEqual([{ span: "some passage", p: null }]);
    // And a null can never promote, at any margin — including 0.
    expect(spansPresentedAsQuotation(run, 0)).toEqual(new Set());
  });

  it("is fail-open when the answer comes back the wrong type", async () => {
    answering({ "some passage": null });
    const run = await judgeQuoteAttribution({ spans: [span("some passage", "A.2.4.1 states:")] });
    expect(run.judgements).toEqual([{ span: "some passage", p: null }]);
  });

  it("one failing span does not take down the others", async () => {
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      if (body.state.passage === "bad passage") return new Response("nope", { status: 400 });
      return new Response(JSON.stringify({ answers: { quoted: { type: "noul", noul: 0.8 } } }), { status: 200 });
    }) as typeof fetch;
    const run = await judgeQuoteAttribution({ spans: [span("bad passage", "x"), span("good passage", "y")] });
    expect(run.judgements).toEqual([
      { span: "bad passage", p: null },
      { span: "good passage", p: 0.8 },
    ]);
  });

  // askJev retries a 5xx three times with 500/1000/2000ms backoff, and the spans
  // share ONE deadline — so the lane's wall clock is the deadline, not the
  // deadline times the span count.
  it("honours its timeout as one DEADLINE across retries and across spans", async () => {
    answering({}, 503);
    const t0 = Date.now();
    const run = await judgeQuoteAttribution({
      spans: [span("one", "a"), span("two", "b"), span("three", "c")],
      timeoutMs: 700,
    });
    expect(Date.now() - t0).toBeLessThan(2000); // un-deadlined retries would take ~3.5s per span
    expect(run.judgements.every((j) => j.p === null)).toBe(true);
  });
});

describe("spansPresentedAsQuotation", () => {
  it("promotes only at or above the margin", () => {
    const run = {
      judgements: [
        { span: "high", p: 0.9 },
        { span: "at", p: 0.5 },
        { span: "low", p: 0.49 },
        { span: "unjudged", p: null },
      ],
      usage: null,
      costUsd: null,
      latencyMs: 1,
    };
    expect(spansPresentedAsQuotation(run, 0.5)).toEqual(new Set(["high", "at"]));
  });
});

describe("QUOTE_ATTRIBUTION_QUESTION criteria", () => {
  // Jev reads literally, and the dangerous direction here is `true` on a
  // self-authored callout — a red badge on an honest answer. The classes the
  // retired regex missed must be named, not implied.
  it("names the self-authored callout shapes verbatim in the false criterion", () => {
    const f = String((QUOTE_ATTRIBUTION_QUESTION.criteria as any).false);
    for (const phrase of ["takeaway", "bottom line", "practical lesson", "consequence", "paraphrase"]) {
      expect(f).toContain(phrase);
    }
    // The use-vs-mention case the tier-A regex deliberately does not settle.
    expect(f).toMatch(/mentions or describes a document/i);
    expect(f).toMatch(/either way, false/i);
  });

  it("names the attribution shapes in the true criterion", () => {
    const t = String((QUOTE_ATTRIBUTION_QUESTION.criteria as any).true);
    expect(t).toMatch(/states:/);
    expect(t).toMatch(/the atlas says/i);
  });

  it("is a noul — this is fire/no-fire, so the operating point stays ours", () => {
    expect(QUOTE_ATTRIBUTION_QUESTION.type).toBe("noul");
  });
});

describe("the shipped default is deliberately unmeasured", () => {
  // The bakeoff has never run (402 Insufficient credits; no DATABASE_URL for the
  // real-traffic false-fire check), so the lane must not be gating anything.
  // Flipping this test is part of flipping the mode — not a chore to silence.
  it("ships in shadow, where severity is unchanged", () => {
    expect(config.chatQuoteAttribution).toBe("shadow");
  });

  it("leaves the margin at the neutral 0.5, which encodes no claim about the data", () => {
    expect(config.chatQuoteAttributionMargin).toBe(0.5);
  });
});
