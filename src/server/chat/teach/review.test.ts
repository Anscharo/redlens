import { describe, expect, it } from "bun:test";
import { config } from "../../config.ts";
import { heuristicReview, parseReview, reviewTeaching } from "./review.ts";

describe("heuristicReview", () => {
  it("rejects empty, tiny, and repeated-character input", () => {
    expect(heuristicReview("hi").accept).toBe(false);
    expect(heuristicReview("aaaaaaa").accept).toBe(false);
    expect(heuristicReview("aaaaaaaaaa").accept).toBe(false);
    expect(heuristicReview("!!! ???").accept).toBe(false);
  });

  it("accepts a short concrete note and derives a subject", () => {
    const r = heuristicReview("Spark freeze lives under the Spark artifact");
    expect(r.accept).toBe(true);
    expect(r.subject.toLowerCase()).toContain("spark");
  });
});

describe("parseReview", () => {
  it("reads strict JSON, including a fenced payload", () => {
    const parsed = parseReview('```json\n{"accept":true,"reason":"ok","subject":"Spark freeze"}\n```', "fallback");
    expect(parsed).toEqual({ accept: true, reason: "ok", subject: "Spark freeze" });
  });

  it("rejects a payload without a boolean accept", () => {
    expect(parseReview('{"reason":"nope"}', "x")).toBeNull();
    expect(parseReview("not json", "x")).toBeNull();
  });

  it("falls back to the heuristic subject when the model omits one", () => {
    const parsed = parseReview('{"accept":false,"reason":"gibberish"}', "fallback subject");
    expect(parsed?.accept).toBe(false);
    expect(parsed?.subject).toBe("fallback subject");
  });
});

describe("reviewTeaching", () => {
  const note = "Spark freeze lives under the Spark artifact";
  const emptyCall = {
    text: "",
    usage: { input: 0, output: 0 },
    generationId: null as string | null,
    latencyMs: 0,
  };

  it("skips the model on a heuristic reject", async () => {
    let called = false;
    const jsonCall = async () => {
      called = true;
      return emptyCall;
    };
    const r = await reviewTeaching("hi", jsonCall);
    expect(r.accept).toBe(false);
    expect(called).toBe(false);
    expect(r.model).toBeNull();
  });

  it("accepts when the model returns usable JSON", async () => {
    const prev = config.chatTeachReviewModel;
    config.chatTeachReviewModel = "review/model";
    try {
      const jsonCall = async () => ({
        text: '{"accept":true,"reason":"ok","subject":"Spark freeze"}',
        usage: { input: 1, output: 2 },
        generationId: "gen-r",
        latencyMs: 1,
      });
      const r = await reviewTeaching(note, jsonCall);
      expect(r).toMatchObject({ accept: true, subject: "Spark freeze", model: "review/model" });
    } finally {
      config.chatTeachReviewModel = prev;
    }
  });

  it("fails closed on unparseable JSON when a model is configured", async () => {
    const prev = config.chatTeachReviewModel;
    config.chatTeachReviewModel = "review/model";
    try {
      const jsonCall = async () => ({ text: "not json", usage: { input: 1, output: 1 }, generationId: "gen-r", latencyMs: 1 });
      const r = await reviewTeaching(note, jsonCall);
      expect(r.accept).toBe(false);
      expect(r.reason).toContain("usable JSON");
    } finally {
      config.chatTeachReviewModel = prev;
    }
  });
});
