// contrastRatio() only accepts plain #rrggbb hex — SwatchGrid and ContrastAudit
// feed it live-editable palette values that could be rgba(), 3-digit shorthand,
// or garbage typed into the color picker's text field. A wrong answer here
// silently mis-badges a swatch as passing/failing WCAG instead of just hiding
// the badge, so every non-#rrggbb shape must come back null, never a guess.
import { describe, it, expect } from "vitest";
import { contrastRatio, rateContrast } from "./contrast";

describe("contrastRatio", () => {
  it("computes the WCAG ratio for two plain 6-digit hex colors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
  });

  it("is case-insensitive on hex digits", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
  });

  it.each([
    ["3-digit shorthand hex", "#fff"],
    ["8-digit hex with alpha channel", "#ffffffff"],
    ["missing the # prefix", "ffffff"],
    ["rgb() function form", "rgb(255, 255, 255)"],
    ["rgba() function form", "rgba(255, 255, 255, 1)"],
    ["a CSS named color", "white"],
    ["one digit short", "#fffff"],
    ["one digit long", "#fffffff"],
    ["empty string", ""],
  ])("returns null for %s (%j)", (_desc, value) => {
    expect(contrastRatio(value, "#000000")).toBeNull();
    expect(contrastRatio("#000000", value)).toBeNull();
  });
});

describe("rateContrast", () => {
  it("rates 7:1 and above as AAA, including the boundary", () => {
    expect(rateContrast(21)).toBe("AAA");
    expect(rateContrast(7)).toBe("AAA");
  });

  it("rates [4.5, 7) as AA", () => {
    expect(rateContrast(6.99)).toBe("AA");
    expect(rateContrast(4.5)).toBe("AA");
  });

  it("rates [3, 4.5) as AA Large", () => {
    expect(rateContrast(4.49)).toBe("AA Large");
    expect(rateContrast(3)).toBe("AA Large");
  });

  it("rates anything below 3:1 as Fail", () => {
    expect(rateContrast(2.99)).toBe("Fail");
    expect(rateContrast(1)).toBe("Fail");
  });
});
