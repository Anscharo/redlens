import { describe, it, expect } from "vitest";
import { shortAddr } from "./format";

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
