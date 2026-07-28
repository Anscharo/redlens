import { describe, it, expect } from "vitest";
import { slugify, makeSlugger } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Instruments 1 · Ecosystem Accords")).toBe("instruments-1-ecosystem-accords");
  });

  it("strips punctuation not in {letter, number, space, hyphen}", () => {
    expect(slugify("Stability Fee (SF)!")).toBe("stability-fee-sf");
  });

  it("collapses repeated whitespace/hyphens and trims edges", () => {
    expect(slugify("  Weird   Spacing  ")).toBe("weird-spacing");
  });

  it("returns an empty string for text with no letters/numbers (all stripped)", () => {
    expect(slugify("--- !!! ---")).toBe("");
  });
});

describe("makeSlugger", () => {
  it("returns the base slug unmodified on first occurrence", () => {
    const slugger = makeSlugger();
    expect(slugger("Instruments")).toBe("instruments");
  });

  it("dedupes repeats with incrementing -1, -2 suffixes", () => {
    const slugger = makeSlugger();
    expect(slugger("Foo")).toBe("foo");
    expect(slugger("Foo")).toBe("foo-1");
    expect(slugger("Foo")).toBe("foo-2");
  });

  it("tracks distinct base slugs independently", () => {
    const slugger = makeSlugger();
    expect(slugger("A")).toBe("a");
    expect(slugger("B")).toBe("b");
    expect(slugger("A")).toBe("a-1");
  });

  it("falls back to 'section' for punctuation-only text, still deduped on repeat", () => {
    const slugger = makeSlugger();
    expect(slugger("---")).toBe("section");
    expect(slugger("!!!")).toBe("section-1");
  });
});
