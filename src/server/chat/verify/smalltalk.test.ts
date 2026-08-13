import { describe, expect, it } from "bun:test";
import { isUncheckableAnswer, judgeSmalltalk, SMALLTALK_MAX_CHARS } from "./smalltalk.ts";
import type { JsonCall } from "../llm.ts";

const answering = (text: string): JsonCall => async () => ({
  text, usage: { input: 5, output: 2 }, generationId: "gen-1", latencyMs: 3,
});

describe("isUncheckableAnswer", () => {
  it("passes plain greetings and courtesies", () => {
    expect(isUncheckableAnswer("Hello! How can I help you with the Sky Atlas today?")).toBe(true);
    expect(isUncheckableAnswer("You're welcome — happy to help.")).toBe(true);
    expect(isUncheckableAnswer("Goodbye!")).toBe(true);
  });

  it("fails on a doc_no shape", () => {
    expect(isUncheckableAnswer("Sure — see A.1.6 for that.")).toBe(false);
  });

  it("fails on an atlas link or any markdown link", () => {
    expect(isUncheckableAnswer("See [the scope](/atlas/abc) for details.")).toBe(false);
    expect(isUncheckableAnswer("Check [this](https://example.com).")).toBe(false);
  });

  it("fails on a reference-style citation label", () => {
    expect(isUncheckableAnswer("The rule requires it [1]")).toBe(false);
  });

  it("fails on a uuid fragment", () => {
    expect(isUncheckableAnswer("that doc is deadbeef-1234-5678-9abc-def012345678")).toBe(false);
  });

  it("fails on an evm address", () => {
    expect(isUncheckableAnswer("the vault is 0xdeadBEEF")).toBe(false);
  });

  it("fails on any figure — numbers are the verifier's business", () => {
    expect(isUncheckableAnswer("The rate is about five percent, roughly 5")).toBe(false);
  });

  it("fails on long answers regardless of content", () => {
    expect(isUncheckableAnswer("a".repeat(SMALLTALK_MAX_CHARS + 1))).toBe(false);
  });
});

describe("judgeSmalltalk", () => {
  it("returns true only for an explicit {\"smalltalk\": true} ruling", async () => {
    const run = await judgeSmalltalk({ call: answering('{"smalltalk": true}'), model: "m", question: "hello" });
    expect(run.smalltalk).toBe(true);
    expect(run.usage).toEqual({ input: 5, output: 2 });
  });

  it("extracts the JSON from surrounding prose", async () => {
    const run = await judgeSmalltalk({ call: answering('Sure: {"smalltalk": true} there you go'), model: "m", question: "hi" });
    expect(run.smalltalk).toBe(true);
  });

  it("fails closed on a false ruling, garbage, wrong types, and empty output", async () => {
    for (const text of ['{"smalltalk": false}', "not json at all", '{"smalltalk": "yes"}', ""]) {
      const run = await judgeSmalltalk({ call: answering(text), model: "m", question: "hello" });
      expect(run.smalltalk).toBe(false);
    }
  });

  it("fails closed when the call throws", async () => {
    const throwing: JsonCall = async () => {
      throw new Error("provider down");
    };
    const run = await judgeSmalltalk({ call: throwing, model: "m", question: "hello" });
    expect(run.smalltalk).toBe(false);
    expect(run.usage).toBeNull();
  });
});
