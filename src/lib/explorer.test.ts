import { describe, it, expect } from "vitest";
import { explorerUrl, EXPLORER } from "./explorer";

const EVM = "0x1234567890abcdef1234567890abcdef12345678";
const SOL = "So11111111111111111111111111111111111111112";

describe("explorerUrl", () => {
  it("prefers a precomputed url from the address map", () => {
    const addrMap = { [EVM.toLowerCase()]: { explorerUrl: "https://custom/x" } };
    expect(explorerUrl(EVM, { addrMap })).toBe("https://custom/x");
  });

  it("falls back to a chain hint over the address map when the map lacks the entry", () => {
    expect(explorerUrl(EVM, { chain: "Base" })).toBe(EXPLORER.base + EVM);
    expect(explorerUrl(EVM, { chain: "Arbitrum One" })).toBe(EXPLORER.arbitrum + EVM);
  });

  it("infers solana from the address shape when no hint is given", () => {
    expect(explorerUrl(SOL)).toBe(EXPLORER.solana + SOL);
  });

  it("defaults EVM-shaped addresses to ethereum", () => {
    expect(explorerUrl(EVM)).toBe(EXPLORER.ethereum + EVM);
  });
});
