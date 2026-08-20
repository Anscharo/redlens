import { describe, it, expect } from "vitest";
import { isMathValue, isProseValue, remarkDeMathProse } from "./mathGuard";

describe("isProseValue / isMathValue", () => {
  it("keeps genuine inline math (LaTeX commands, sub/superscripts, symbols)", () => {
    // The contract that matters: none of these are reclassified as prose.
    for (const v of ["d_1", "\\sigma_U^2", "PD", "a", "20\\%", "\\rho_{UD}", "x = y", "a + b", "N", "w_U^i"]) {
      expect(isProseValue(v)).toBe(false);
    }
    // Spot-check the math-indicator helper on the clear cases.
    for (const v of ["d_1", "\\sigma_U^2", "PD", "20\\%", "x = y"]) expect(isMathValue(v)).toBe(true);
  });

  it("flags currency/table prose spans, including glued ranges", () => {
    expect(isProseValue("100k direct exposure | Minimal disruption, alternative paths exist | L")).toBe(true);
    expect(isProseValue("5 million allocated to the reserve buffer")).toBe(true);
    // Currency ranges with no whitespace/pipe (the table's Medium/High rows).
    expect(isProseValue("100k-1M")).toBe(true);
    expect(isProseValue("1M-10M")).toBe(true);
    expect(isProseValue("5bn")).toBe(true);
  });

  it("does not over-flag bare symbols/acronyms with no currency magnitude", () => {
    expect(isProseValue("PD")).toBe(false);
    expect(isProseValue("N")).toBe(false);
    expect(isProseValue("Base_Rate")).toBe(false); // has `_` → math
  });
});

describe("remarkDeMathProse", () => {
  const run = (tree: any) => {
    remarkDeMathProse()(tree);
    return tree;
  };

  it("rewrites a prose inlineMath node to a literal $…$ text node", () => {
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [
          { type: "inlineMath", value: "100k direct exposure | x | y" },
          { type: "inlineMath", value: "d_1" },
        ] },
      ],
    };
    const kids = run(tree).children[0].children;
    expect(kids[0]).toEqual({ type: "text", value: "$100k direct exposure | x | y$" });
    expect(kids[1]).toEqual({ type: "inlineMath", value: "d_1" }); // genuine math untouched
  });

  it("leaves display math ($$) nodes alone", () => {
    const tree = { type: "root", children: [{ type: "math", value: "some | prose | that would be prose inline" }] };
    expect(run(tree).children[0].type).toBe("math");
  });
});
