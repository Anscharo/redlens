import { describe, it, expect } from "vitest";
import { broadSuggestion } from "./searchSuggestions";

describe("broadSuggestion", () => {
  it("strips quotes and collapses whitespace when the mode is non-broad", () => {
    expect(broadSuggestion('  "stability   fee" ', "phrase", "lexical")).toBe("stability fee");
  });

  it("treats typed quotes as non-broad even in broad mode", () => {
    expect(broadSuggestion("'fees'", "broad", "lexical")).toBe("fees");
  });

  it("suggests nothing for a plain broad query", () => {
    expect(broadSuggestion("fees", "broad", "lexical")).toBeNull();
  });

  it("suggests nothing off the wording lane", () => {
    expect(broadSuggestion("fees", "strict", "semantic")).toBeNull();
  });

  it("suggests nothing when stripping leaves an empty query", () => {
    expect(broadSuggestion('""', "broad", "lexical")).toBeNull();
  });
});
