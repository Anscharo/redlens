// normalize() is what lets "set back to default" and buildOverrideSnippet
// detect that two differently-formatted strings describe the same color.
// An off-by-one here (wrong case, an un-stripped space, a un-expanded
// shorthand hex) silently breaks the reset button: a token that IS at its
// default would still show as "overridden" and get exported to the CSS
// snippet.
import { describe, it, expect } from "vitest";
import { normalize } from "./palette-storage";

describe("normalize", () => {
  it("lowercases hex digits", () => {
    expect(normalize("#ABCDEF")).toBe("#abcdef");
  });

  it("expands 3-digit shorthand hex to 6 digits", () => {
    expect(normalize("#fff")).toBe("#ffffff");
    expect(normalize("#0f0")).toBe("#00ff00");
  });

  it("trims surrounding whitespace", () => {
    expect(normalize("  #ffffff  ")).toBe("#ffffff");
  });

  it("collapses whitespace between rgba() components to a single space", () => {
    expect(normalize("rgba( 255,250 ,240,0.12 )")).toBe("rgba(255, 250, 240, 0.12)");
  });

  it("collapses whitespace between rgb() components the same way", () => {
    expect(normalize("rgb(1,2,3)")).toBe("rgb(1, 2, 3)");
  });

  it("recognizes rgba()/rgb() regardless of case", () => {
    expect(normalize("RGBA(255, 0, 0, 1)")).toBe("rgba(255, 0, 0, 1)");
  });

  it("passes through an unrecognized value lowercased and trimmed", () => {
    expect(normalize("  Transparent  ")).toBe("transparent");
  });

  it("is idempotent — normalizing an already-normal value returns it unchanged", () => {
    expect(normalize("#ffffff")).toBe("#ffffff");
    expect(normalize("rgba(255, 250, 240, 0.12)")).toBe("rgba(255, 250, 240, 0.12)");
  });

  it("treats equivalent shorthand and full hex as equal once normalized", () => {
    expect(normalize("#FFF")).toBe(normalize("#ffffff"));
  });

  it("treats equivalent rgba() values with different spacing as equal once normalized", () => {
    expect(normalize("rgba(255, 250, 240, 0.12)")).toBe(normalize("rgba( 255,250 ,240,0.12 )"));
  });
});
