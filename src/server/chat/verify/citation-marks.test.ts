import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import type { CiteVerdict } from "./cite-support.ts";
import { aggregateMarks, runCitationMarks, MIN_BACKED_CONFIDENCE } from "./citation-marks.ts";
import { config } from "../../config.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { JsonCall } from "../llm.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const node = (id: string, title: string, content: string) =>
  ({ id, title, content, parentId: null, doc_no: "A.1", type: "Core", depth: 1, order: 0, addressRefs: [] }) as any;

const ix = {
  docMap: new Map([
    [A, node(A, "Facilitator", "Facilitators are contracted by Executor Agents.")],
    [B, node(B, "Rate Limits", "Rate limits apply to the instance.")],
    [C, node(C, "History", "This document tracks edit history.")],
  ]),
  childrenIndex: new Map(),
} as unknown as Indexes;

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
beforeEach(() => {
  config.openrouterApiKey = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
});

describe("aggregateMarks", () => {
  it("any contradicts wins over everything else — disputed", () => {
    const marks = aggregateMarks([
      { uuid: A, claim: "c1", verdict: "supports" },
      { uuid: A, claim: "c2", verdict: "contradicts" },
    ]);
    expect(marks[A].status).toBe("disputed");
    expect(marks[A].claims).toEqual([
      { claim: "c1", verdict: "supports", confidence: null },
      { claim: "c2", verdict: "contradicts", confidence: null },
    ]);
  });

  it("an unjudged (null) pair suppresses any mark — we don't claim what we didn't check", () => {
    const marks = aggregateMarks([
      { uuid: A, claim: "c1", verdict: "supports" },
      { uuid: A, claim: "c2", verdict: null },
    ]);
    expect(marks[A]).toBeUndefined();
    // A confirmed contradiction does not override the unjudged pair. Worst
    // verdict used to win here, so a doc we had not finished checking shipped
    // as disputed.
    const withContra = aggregateMarks([
      { uuid: A, claim: "c1", verdict: "contradicts" },
      { uuid: A, claim: "c2", verdict: null },
    ]);
    expect(withContra[A]).toBeUndefined();
  });

  it("says_nothing with no contradicts or null — uncovered", () => {
    const marks = aggregateMarks([{ uuid: A, claim: "c1", verdict: "says_nothing" }]);
    expect(marks[A]).toEqual({ status: "uncovered", claims: [{ claim: "c1", verdict: "says_nothing", confidence: null }], confidence: null });
  });

  // No confidence reported, so the support cannot clear the cliff.
  it("only supports — a weak backing without a number", () => {
    const marks = aggregateMarks([{ uuid: A, claim: "c1", verdict: "supports" }]);
    expect(marks[A]).toEqual({ status: "backed_weak", claims: [{ claim: "c1", verdict: "supports", confidence: null }], confidence: null });
  });

  it("only about_document pointers — no mark, and the pointer is excluded from claims on a mixed doc", () => {
    expect(aggregateMarks([{ uuid: A, claim: "c1", verdict: "about_document" }])[A]).toBeUndefined();
    const marks = aggregateMarks([
      { uuid: A, claim: "c1", verdict: "about_document" },
      { uuid: A, claim: "c2", verdict: "supports" },
    ]);
    expect(marks[A]).toEqual({ status: "backed_weak", claims: [{ claim: "c2", verdict: "supports", confidence: null }], confidence: null });
  });

  it("keeps docs independent — one doc's null does not affect another's mark", () => {
    const marks = aggregateMarks([
      { uuid: A, claim: "c1", verdict: null },
      { uuid: B, claim: "c2", verdict: "supports" },
    ]);
    expect(marks[A]).toBeUndefined();
    expect(marks[B].status).toBe("backed_weak"); // no confidence reported
  });
});

// Stubs the /systemone endpoint judgeCitation posts to. `verdictFor` maps a
// claim to the verdict Jev should return for it; unmatched claims answer
// "supports" so a fixture only has to name what it cares about.
function stubJudge(verdictFor: (claim: string) => string) {
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).includes("/systemone")) throw new Error("unexpected fetch: " + url);
    const body = JSON.parse(init.body);
    const claim = (body.state as { claim: string }).claim;
    const choice = verdictFor(claim);
    return new Response(
      JSON.stringify({
        answers: { support: { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 } },
        usage: { input_tokens: 10, output_tokens: 2, cost: 0.000001 },
        id: "gen-dec-1",
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

const ANSWER = `Facilitators are contracted by agents [Facilitator](/atlas/${A}). Rate limits apply [Rate Limits](/atlas/${B}).`;

describe("runCitationMarks", () => {
  it("makes no network call and returns empty marks when the answer has no citations", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const run = await runCitationMarks({ answer: "Just prose, no links at all.", ix, model: "jev" });
    expect(run).toEqual({ marks: {}, judged: [], calls: 0, failed: 0, costUsd: 0, latencyMs: 0, confirm: null });
    expect(called).toBe(false);
  });

  it("judges each pair and produces a backed mark", async () => {
    stubJudge(() => "supports");
    const run = await runCitationMarks({ answer: ANSWER, ix, model: "jev" });
    expect(run.calls).toBe(2);
    expect(run.marks[A]).toEqual({ status: "backed", claims: [{ claim: run.judged.find((j) => j.uuid === A)!.claim, verdict: "supports", confidence: 1 }], confidence: 1 });
    expect(run.marks[B].status).toBe("backed");
    expect(run.confirm).toBeNull(); // no contradicts — confirm never called
  });

  it("a pending judge call still returns within the deadline, counted as failed", async () => {
    // Never resolves on its own — but DOES honor the AbortSignal, same as a
    // real fetch would, so this exercises the deadline path rather than
    // hanging on a mock that ignores cancellation altogether.
    globalThis.fetch = ((_url: any, init: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const t0 = Date.now();
    const run = await runCitationMarks({ answer: ANSWER, ix, model: "jev", deadlineMs: 100 });
    expect(Date.now() - t0).toBeLessThan(2000); // generous margin over the 100ms deadline
    expect(run.failed).toBe(2);
    expect(run.marks).toEqual({}); // both verdicts null — no mark, not a guess
  });

  it("confirm AGREE keeps a contradicts verdict as disputed", async () => {
    stubJudge((claim) => (claim.includes("Facilitators") ? "contradicts" : "supports"));
    const confirmCall: JsonCall = async () => ({
      text: '{"agree":[1],"notes":""}',
      usage: { input: 5, output: 5 },
      generationId: "gen-confirm",
      latencyMs: 5,
    });
    const run = await runCitationMarks({ answer: ANSWER, ix, model: "jev", jsonCall: confirmCall, confirmModel: "confirm-model" });
    expect(run.confirm).toEqual({ candidates: 1, agreed: 1 });
    expect(run.marks[A].status).toBe("disputed");
    expect(run.marks[B].status).toBe("backed");
  });

  it("confirm DISAGREE downgrades to unbacked, not disputed", async () => {
    stubJudge((claim) => (claim.includes("Facilitators") ? "contradicts" : "supports"));
    const confirmCall: JsonCall = async () => ({
      text: '{"agree":[],"notes":""}',
      usage: { input: 5, output: 5 },
      generationId: "gen-confirm",
      latencyMs: 5,
    });
    const run = await runCitationMarks({ answer: ANSWER, ix, model: "jev", jsonCall: confirmCall, confirmModel: "confirm-model" });
    expect(run.confirm).toEqual({ candidates: 1, agreed: 0 });
    expect(run.marks[A].status).toBe("uncovered");
    expect(run.marks[A].confidence).toBeNull();
    expect(run.judged.find((j) => j.uuid === A)!.confidence).toBeNull();
  });

  it("confirm is shown the cited document in full, including text past the old 600-character cut", async () => {
    const tail = "The threshold is seven signers, not three.";
    const long = `${"The opening defines terms. ".repeat(40)}${tail}`;
    expect(long.length).toBeGreaterThan(600);
    const longIx = {
      ...ix,
      docMap: new Map(ix.docMap),
    } as unknown as Indexes;
    longIx.docMap.set(A, node(A, "Facilitator", long));
    stubJudge((claim) => (claim.includes("Facilitators") ? "contradicts" : "supports"));
    let shown = "";
    const confirmCall: JsonCall = async (args) => {
      shown = args.messages.map((m) => String(m.content)).join("\n");
      return {
        text: '{"agree":[1],"notes":""}',
        usage: { input: 5, output: 5 },
        generationId: "gen-confirm",
        latencyMs: 5,
      };
    };
    const run = await runCitationMarks({ answer: ANSWER, ix: longIx, model: "jev", jsonCall: confirmCall, confirmModel: "confirm-model" });
    expect(shown).toContain(tail);
    expect(shown).toContain("full text of the cited document");
    expect(run.marks[A].status).toBe("disputed");
  });

  it("confirm absent (no jsonCall/confirmModel) also downgrades a contradicts to unbacked, never an unconfirmed disputed", async () => {
    stubJudge((claim) => (claim.includes("Facilitators") ? "contradicts" : "supports"));
    const run = await runCitationMarks({ answer: ANSWER, ix, model: "jev" });
    expect(run.confirm).toEqual({ candidates: 1, agreed: 0 });
    expect(run.marks[A].status).toBe("uncovered");
  });

  it("skips a citation to a uuid not in ix.docMap", async () => {
    const unknown = "44444444-4444-4444-8444-444444444444";
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const run = await runCitationMarks({ answer: `Some claim [X](/atlas/${unknown}).`, ix, model: "jev" });
    expect(run.calls).toBe(0);
    expect(called).toBe(false);
  });
});

describe("aggregateMarks: how full support splits", () => {
  const U1 = "11111111-1111-4111-8111-111111111111";
  const j = (claim: string, verdict: CiteVerdict, confidence: number | null = 0.99) => ({ uuid: U1, claim, verdict, confidence });

  it("every supporting line over the cliff is a plain backing", () => {
    expect(aggregateMarks([j("a", "supports", 0.99), j("b", "supports", MIN_BACKED_CONFIDENCE)])[U1].status).toBe("backed");
  });

  it("every supporting line under the cliff is a weak backing", () => {
    expect(aggregateMarks([j("a", "supports", 0.94), j("b", "supports", 0.5)])[U1].status).toBe("backed_weak");
  });

  // The case a single number hides: this document clearly backs one sentence
  // and barely backs another, which is worth saying rather than averaging.
  it("lines on both sides of the cliff are mixed", () => {
    const mark = aggregateMarks([j("a", "supports", 0.99), j("b", "supports", 0.93)])[U1];
    expect(mark.status).toBe("mixed");
    // The tooltip names both lines, so both confidences have to survive.
    expect(mark.claims.map((c) => c.confidence)).toEqual([0.99, 0.93]);
  });

  // Jev always reports a confidence on a live Choice, so a missing one means
  // something went wrong. That is not a reason to promote the mark.
  it("counts a supporting line with no confidence as under the cliff", () => {
    expect(aggregateMarks([j("a", "supports", null)])[U1].status).toBe("backed_weak");
  });

  it("gives partial support a mark of its own, below every full backing", () => {
    expect(aggregateMarks([j("a", "supports_in_part", 0.88)])[U1].status).toBe("partial");
    expect(aggregateMarks([j("a", "supports", 0.99), j("b", "supports_in_part", 0.9)])[U1].status).toBe("partial");
  });

  // Worst verdict still wins over all of it.
  it("loses to a contradiction and to an uncovered line", () => {
    expect(aggregateMarks([j("a", "supports_in_part", 0.9), j("b", "contradicts", 0.2)])[U1].status).toBe("disputed");
    expect(aggregateMarks([j("a", "supports", 0.99), j("b", "says_nothing", 0.2)])[U1].status).toBe("uncovered");
  });

  // A check is only as sure as its weakest support; a warning as sure as its
  // clearest contradiction. Neither `mixed` nor `partial` carries a number —
  // one value cannot describe a disagreement between lines.
  it("carries a number only where one number can describe the status", () => {
    expect(aggregateMarks([j("a", "supports", 0.99), j("b", "supports", 0.96)])[U1].confidence).toBe(0.96);
    expect(aggregateMarks([j("a", "contradicts", 0.4), j("b", "contradicts", 0.87)])[U1].confidence).toBe(0.87);
    expect(aggregateMarks([j("a", "supports", 0.99), j("b", "supports", 0.93)])[U1].confidence).toBeNull();
    expect(aggregateMarks([j("a", "supports_in_part", 0.9)])[U1].confidence).toBeNull();
  });
});
