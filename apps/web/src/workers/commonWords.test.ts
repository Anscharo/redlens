import { describe, expect, it } from "vitest";
import { COMMON_WORD_COUNT, isCommonWord, parseCommonWords } from "./commonWords";

describe("parseCommonWords", () => {
  it("skips the provenance header and blank lines", () => {
    expect([...parseCommonWords("# where it came from\n\nhome\ncare\n")]).toEqual(["home", "care"]);
  });
});

describe("isCommonWord", () => {
  it("loaded the shipped list", () => {
    // A bundling mistake would leave this empty and every word would read as
    // half-typed — the failure the list exists to prevent, silently restored.
    expect(COMMON_WORD_COUNT).toBeGreaterThan(500);
  });

  it("knows a whole word the atlas only uses a longer form of", () => {
    expect(isCommonWord("slipper")).toBe(true); // the atlas has "slippery"
  });

  it("does not know a half-typed word", () => {
    expect(isCommonWord("collater")).toBe(false);
    expect(isCommonWord("governan")).toBe(false);
  });

  it("holds only what the atlas index cannot already decide", () => {
    // Words the atlas uses AS WRITTEN are settled by the index, so carrying
    // them here would be dead weight — the whole reason the list is 7 KB and
    // not 344 KB. See scripts/aux/fetch-common-words.mjs.
    expect(isCommonWord("governance")).toBe(false);
  });
});
