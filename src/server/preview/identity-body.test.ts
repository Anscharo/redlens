// Run via `bun test src/server`. Pure unit tests — no DB, no network.
import { describe, it, expect } from "bun:test";
import { detectIdentitySwaps, bodyReplaced, bodyWhollyReplaced, lineOverlap, wantsSimilarity, REPLACE_MAX_COSINE, type SwapNode } from "./identity.ts";
import { mapOf, OZONE_OLD, SKY_PRIMITIVES, STEP_OLD, STEP_NEW, STEP_COSINE } from "./identity-fixtures.ts";

describe("the body test", () => {
  it("bodyWhollyReplaced: replaced only when the lines AND the words are both gone", () => {
    const one = "The ALMProxy for Keel is whitelisted on the LitePSM contract and reviewed yearly.";
    expect(bodyWhollyReplaced(one, one.replace("ALMProxy", "ALM Proxy"))).toBe(false); // small edit
    expect(bodyWhollyReplaced(OZONE_OLD, SKY_PRIMITIVES)).toBe(true); // different document
    const many = ["alpha line", "beta line", "gamma line", "delta line", "epsilon line"].join("\n");
    expect(bodyWhollyReplaced(many, many)).toBe(false);
    expect(bodyWhollyReplaced(many, ["one", "two", "three", "four", "five"].join("\n"))).toBe(true);
    // Too little text to judge.
    expect(bodyWhollyReplaced("The rate is 5%.", "The cap is 9m.")).toBe(false);
  });

  it("bodyWhollyReplaced: a re-indented bullet list is not a replacement", () => {
    // The shape of all 15 real lint edits the size-routed gate still badged: a
    // glyph and indent change touches EVERY line, so no line survives, while
    // every word does.
    const before = [
      "The parameters of the pool are:",
      "        ◦ Supply cap: 500,000,000 USDS",
      "        ◦ Borrow cap: 250,000,000 USDS",
      "        ◦ Liquidation threshold: 85%",
      "        ◦ Reserve factor: 10%",
    ].join("\n");
    const after = before.replace(/ {8}◦/g, "    -").replace("are:", "are :");
    expect(lineOverlap(before, after)).toBe(0);
    expect(bodyWhollyReplaced(before, after)).toBe(false);
  });
});

describe("detectIdentitySwaps — judged by meaning when a similarity is supplied", () => {
  const main = mapOf([{ id: "2c2b", doc_no: "A.6.1.4", title: "Approve Contract Spend", content: STEP_OLD }]);
  const preview = mapOf([{ id: "2c2b", doc_no: "A.6.1.4", title: "Swap USDC To DAI", content: STEP_NEW }]);
  const run = (similarity?: (id: string) => number | undefined) =>
    detectIdentitySwaps({ changed: ["2c2b"], added: [], mainById: main, previewById: preview, similarity }).identitySwap;

  it("catches a real repurposed step that lines and words let through", () => {
    // The two steps share their code scaffold and their vocabulary, so more
    // than half the old words survive in order and the word measure says
    // "edited". This is the blind spot the vector closes.
    expect(bodyWhollyReplaced(STEP_OLD, STEP_NEW)).toBe(false);
    expect(run()).toEqual({});
    expect(run(() => STEP_COSINE)["2c2b"]).toMatchObject({ oldTitle: "Approve Contract Spend", newTitle: "Swap USDC To DAI" });
  });

  it("spares a retitled document whose meaning held", () => {
    // Every plain rename in the measured history scores 0.905 or more on Qwen
    // vectors (0.929 on Gemini), above either model's bar.
    expect(run(() => 0.905)).toEqual({});
  });

  it("falls back to lines and words when the caller has no score for the document", () => {
    expect(run(() => undefined)).toEqual({});
  });

  it("never judges a body of three lines or fewer by meaning", () => {
    // On short bodies no cosine bar beat the word measure, so a low score
    // must not flag a one-line body the word measure calls an edit.
    const one = "The ALMProxy for Keel is whitelisted on the LitePSM contract and reviewed yearly.";
    const m = mapOf([{ id: "x", doc_no: "A.1", title: "Whitelisting", content: one }]);
    const p = mapOf([{ id: "x", doc_no: "A.1", title: "Allowlisting Rules", content: one.replace("ALMProxy", "ALM Proxy") }]);
    expect(detectIdentitySwaps({ changed: ["x"], added: [], mainById: m, previewById: p, similarity: () => 0.1 }).identitySwap).toEqual({});
  });

  it("bodyReplaced: the bar is inclusive, and a body too small to judge is never replaced", () => {
    expect(bodyReplaced(STEP_OLD, STEP_NEW, REPLACE_MAX_COSINE)).toBe(true);
    expect(bodyReplaced(STEP_OLD, STEP_NEW, REPLACE_MAX_COSINE + 0.001)).toBe(false);
    expect(bodyReplaced("a\nb\nc\nd", "w\nx\ny\nz", 0.1)).toBe(false);
  });

  it("wantsSimilarity: only a retitled, judgeable body of more than three lines", () => {
    const node = (title: string, content: string): SwapNode => ({ id: "x", doc_no: "A.1", title, content });
    expect(wantsSimilarity(node("Approve Contract Spend", STEP_OLD), node("Swap USDC To DAI", STEP_NEW))).toBe(true);
    expect(wantsSimilarity(node("Approve Contract Spend", STEP_OLD), node("Approve  Contract-Spend", STEP_NEW))).toBe(false); // same title, respelled
    expect(wantsSimilarity(node("Operational GovOps", OZONE_OLD), node("Sky Primitives", SKY_PRIMITIVES))).toBe(false); // one line
    expect(wantsSimilarity(node("Approve Contract Spend", STEP_OLD), node("Swap USDC To DAI", ""))).toBe(false); // blanked
    expect(wantsSimilarity(undefined, node("Swap USDC To DAI", STEP_NEW))).toBe(false);
  });
});
