import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { buildMetadataRequest, judgeMetadata, METADATA_QUESTION, METADATA_VERDICTS } from "./cite-metadata.ts";
import { config } from "../../config.ts";

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
beforeEach(() => {
  config.openrouterApiKey = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
});

const record = { doc_id: "A", committed_at: "2026-09-17", change_type: "updated", pr_number: 336, pr_title: "Unlimited USDS burn rate" };

describe("METADATA_VERDICTS", () => {
  it("contains exactly the four values", () => {
    expect(METADATA_VERDICTS).toEqual(["supports", "says_nothing", "contradicts", "states_content"]);
  });
});

describe("buildMetadataRequest", () => {
  it("puts the claim and the record in named state and asks exactly one question", () => {
    const req = buildMetadataRequest("On September 17, 2026 (PR #336) the doc changed.", record);
    const state = req.state as Record<string, unknown>;
    expect(state.claim).toBe("On September 17, 2026 (PR #336) the doc changed.");
    expect(state.record).toBe(record);
    expect(Object.keys(req.questions)).toEqual(["metadata"]);
    expect(req.questions.metadata).toBe(METADATA_QUESTION);
  });

  it("is pure — no network call", () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    buildMetadataRequest("claim", record);
    expect(called).toBe(false);
  });
});

describe("METADATA_QUESTION states_content criterion", () => {
  it("says a record cannot establish what a document says", () => {
    const text = METADATA_QUESTION.criteria.states_content;
    expect(text).toContain("what a document says");
  });

  it("distinguishes it from the change-event facts a record CAN check", () => {
    const text = METADATA_QUESTION.criteria.states_content;
    // The claim asserts what the document says/contains, as opposed to when
    // it changed, who changed it, what kind of change, which document.
    expect(text).toContain("DOCUMENT ITSELF SAYS");
    expect(text).toMatch(/when it changed|who changed it|what kind of change/);
  });
});

describe("judgeMetadata", () => {
  const answering = (body: unknown, status = 200) => {
    globalThis.fetch = (async () =>
      status === 200 ? new Response(JSON.stringify(body), { status }) : new Response("boom", { status })) as unknown as typeof fetch;
  };

  it("returns the verdict with its distribution", async () => {
    answering({
      answers: {
        metadata: { type: "choice", choice: "states_content", probabilities: { states_content: 0.82, supports: 0.1, contradicts: 0.02, says_nothing: 0.06 }, confidence: 0.75 },
      },
      usage: { input_tokens: 210, output_tokens: 20, cost: 0.000009 },
      id: "gen-dec-2",
    });
    const j = await judgeMetadata({ claim: "the doc now sets the rate limit to unlimited", record });
    expect(j.verdict).toBe("states_content");
    expect(j.confidence).toBe(0.75);
    expect(j.probabilities?.states_content).toBe(0.82);
    expect(j.costUsd).toBe(0.000009);
    expect(j.generationId).toBe("gen-dec-2");
  });

  // This check can only ever ADD a finding, so a failure must mean "no
  // finding" — never a fabricated contradiction.
  it("fails open on a transport throw", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const j = await judgeMetadata({ claim: "c", record, timeoutMs: 700 });
    expect(j.verdict).toBeNull();
  });

  it("fails open on a non-choice answer", async () => {
    answering({ answers: { metadata: { type: "noul", noul: 0.9 } }, id: "g" });
    const j = await judgeMetadata({ claim: "c", record });
    expect(j.verdict).toBeNull();
  });

  it("fails open on an unknown option", async () => {
    answering({ answers: { metadata: { type: "choice", choice: "maybe", probabilities: {}, confidence: 1 } }, id: "g" });
    const j = await judgeMetadata({ claim: "c", record });
    expect(j.verdict).toBeNull();
  });

  it("fails open on a fatal (4xx) transport error, and fast", async () => {
    answering(null, 400);
    const j = await judgeMetadata({ claim: "c", record });
    expect(j.verdict).toBeNull();
  });
});
