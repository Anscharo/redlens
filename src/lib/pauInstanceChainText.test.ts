// A chain named as a whole word anywhere in a title: exactly one chain, the
// longer name taking its words first, no match inside another word.
import { describe, expect, it } from "vitest";
import { chainInText } from "./pauInstanceChain.ts";

describe("chainInText", () => {
  it("finds the one chain a title names", () => {
    expect(chainInText("Monolithic Mainnet Controller Contract Functions")).toBe("ethereum");
    expect(chainInText("Relayer Functions On Arbitrum")).toBe("arbitrum");
  });
  it("lets a longer name take its words, so OP Mainnet is Optimism and not Ethereum", () => {
    expect(chainInText("OP Mainnet Controller Functions")).toBe("optimism");
  });
  it("names none where a title names two chains or none, or only part of a word", () => {
    expect(chainInText("Bridging From Ethereum To Arbitrum")).toBeNull();
    expect(chainInText("Relayer Functions")).toBeNull();
    expect(chainInText("Database Maintenance")).toBeNull();
  });
});
