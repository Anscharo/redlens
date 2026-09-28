import { describe, expect, it } from "bun:test";
import { isUncheckableAnswer, SMALLTALK_MAX_CHARS } from "./smalltalk.ts";

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

  it("fails on a bare URL with no digits (autolink, not markdown)", () => {
    expect(isUncheckableAnswer("See https://sky.money for more.")).toBe(false);
    expect(isUncheckableAnswer("http://forum.sky.money/t/hello")).toBe(false);
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
