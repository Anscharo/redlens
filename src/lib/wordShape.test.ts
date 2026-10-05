import { describe, expect, it } from "vitest";
import { heldWords, looksLikeWord } from "./wordShape";

const none = () => false;

describe("looksLikeWord", () => {
  it("holds strings that are not word-shaped", () => {
    for (const t of ["xkcdq", "a1b2c", "aaaa", "qzx", "brzzzzzzk", "zxcvb", "abc123", "hjkl"]) {
      expect(looksLikeWord(t), t).toBe(false);
    }
  });

  it("passes ordinary words, including consonant-heavy ones", () => {
    for (const t of ["collateral", "rhythm", "strengths", "twelfths", "catchphrase", "governance", "qatar", "iraq", "quorum", "exquisite", "acquire"]) {
      expect(looksLikeWord(t), t).toBe(true);
    }
  });

  it("passes figures, ordinals, versions, identifiers and one-letter tokens", () => {
    for (const t of ["2026", "2nd", "10x", "v2", "l2", "mcd_vat", "a", "x", "naïve", "資料"]) {
      expect(looksLikeWord(t), t).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(looksLikeWord("XKCDQ")).toBe(false);
    expect(looksLikeWord("Governance")).toBe(true);
  });
});

describe("heldWords", () => {
  it("returns the offending tokens in order, without repeats", () => {
    expect(heldWords("xkcdq governance qzx, XKCDQ", none)).toEqual(["xkcdq", "qzx"]);
  });

  it("lets an indexed token through whatever its shape", () => {
    const indexed = new Set(["erc4626", "dss"]);
    expect(heldWords("erc4626 dss xkcdq", (t) => indexed.has(t.toLowerCase()))).toEqual(["xkcdq"]);
  });

  it("keeps an underscore inside one token", () => {
    expect(heldWords("mcd_vat erc4626_redeem", none)).toEqual([]);
  });

  it("holds nothing for a plain question", () => {
    expect(heldWords("who approves the rewards for collateral?", none)).toEqual([]);
  });

  it("holds none of a sample of real retrieval-eval phrasings", () => {
    const sample = [
      "who can change the delegate quorum for the SparkLend rate limit",
      "sparklend usdc rate limit",
      "which agent controls the ALM Proxy on Base",
      "operational facilitator responsibilities",
      "what does the Accessibility Scope define",
      "stale dates report",
    ];
    for (const q of sample) expect(heldWords(q, none), q).toEqual([]);
  });

  it("holds under 1% of a sample of ordinary English words", () => {
    const words = ["about", "above", "account", "address", "agent", "alignment", "amount", "approve", "atlas", "balance", "bridge", "burn", "claim", "collateral", "control", "core", "delegate", "document", "exchange", "facilitator", "fee", "governance", "hundred", "interest", "liquidity", "mint", "network", "oracle", "protocol", "quorum", "reward", "risk", "scope", "strengths", "treasury", "vault", "yield"];
    expect(words.filter((w) => !looksLikeWord(w))).toEqual([]);
  });
});
