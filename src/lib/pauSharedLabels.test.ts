// An address-matched name carried by several keys is marked shared, so each
// row can add its constant; a name only one key carries, or one the atlas
// states by hash, is left alone.
import { describe, expect, it } from "vitest";
import { withSharedLabels } from "./pauSharedLabels.ts";

const VAULT = "0x" + "7".repeat(40);
const ref = (label: string, extra: Record<string, string> = {}) => ({ docId: "maple", label, via: VAULT, ...extra });

describe("withSharedLabels", () => {
  it("marks a matched name that two keys carry, and only those refs", () => {
    const out = withSharedLabels(new Map([
      ["0xwithdraw", [ref("Maple USDC · Outflow")]],
      ["0xredeem", [ref("Maple USDC · Outflow")]],
      ["0xdeposit", [ref("Maple USDC · Inflow")]],
    ]));
    expect(out.get("0xwithdraw")).toEqual([{ ...ref("Maple USDC · Outflow"), shared: true }]);
    expect(out.get("0xredeem")).toEqual([{ ...ref("Maple USDC · Outflow"), shared: true }]);
    expect(out.get("0xdeposit")).toEqual([ref("Maple USDC · Inflow")]);
  });
  it("leaves a name the atlas states by hash, and the same name under another chain heading", () => {
    const out = withSharedLabels(new Map([
      ["0xa", [{ docId: "maple", label: "Maple USDC · Outflow" }]],
      ["0xb", [{ docId: "maple", label: "Maple USDC · Outflow" }]],
      ["0xc", [ref("Swap", { chain: "base" })]],
      ["0xd", [ref("Swap", { chain: "ethereum" })]],
    ]));
    expect([...out.values()].flat().some((r) => "shared" in r)).toBe(false);
  });
});
