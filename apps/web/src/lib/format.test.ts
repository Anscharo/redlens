import { describe, it, expect } from "vitest";
import { shortAddr, shortLink } from "./format";

describe("shortAddr", () => {
  it("keeps the default 6 head / 4 tail chars around an ellipsis", () => {
    expect(shortAddr("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("respects custom head/tail counts", () => {
    expect(shortAddr("0xabcdef0000000000000000000000000000001234", 4, 6)).toBe("0xab…001234");
  });

  it("works on base58 (Solana) ids too", () => {
    expect(shortAddr("So11111111111111111111111111111111111111112")).toBe("So1111…1112");
  });
});

describe("shortLink", () => {
  it("drops the protocol and truncates a long final path segment", () => {
    expect(shortLink("https://plasmascan.to/address/0x5ce28f2dd353945db9ab3273a2a1dd1ab632e24b")).toBe(
      "plasmascan.to/address/0x5ce28f...",
    );
  });

  it("drops a leading www.", () => {
    expect(shortLink("https://www.etherscan.io/address/0xabc")).toBe("etherscan.io/address/0xabc");
  });

  it("leaves a short path segment untouched", () => {
    expect(shortLink("https://example.com/a/b")).toBe("example.com/a/b");
  });

  it("falls back to the input for an unparseable URL", () => {
    expect(shortLink("not a url")).toBe("not a url");
  });
});
