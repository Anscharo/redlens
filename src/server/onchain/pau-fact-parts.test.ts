// A fact's set_at: the change's time, tx and explorer link, and null where the
// history read holds no such change (a Solana limit set before its window).
import { describe, expect, it } from "bun:test";
import { setAt } from "./pau-fact-parts.ts";

describe("setAt", () => {
  it("links the transaction that set the value", () => {
    expect(setAt("solana", { time: "2026-02-11T00:00:00.000Z", tx: "sig" })).toEqual({ time: "2026-02-11T00:00:00.000Z", tx: "sig", url: "https://solscan.io/tx/sig" });
  });
  it("is null for a value with no stored change", () => {
    expect(setAt("solana", { time: "", tx: "" })).toBeNull();
  });
});
