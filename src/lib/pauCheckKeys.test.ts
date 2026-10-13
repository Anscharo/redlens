// A key the value check resolved is named by the instance stating the value;
// a key the index already names keeps its name.
import { describe, expect, it } from "vitest";
import type { AtlasKeyRef } from "./pauView.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { withCheckedKeys } from "./pauCheckKeys.ts";

const check = (key: string | null, extra: Partial<ValueCheck> = {}): ValueCheck => ({
  docId: "value-doc", instance: "Curve AUSD/USDC Swaps", instanceDocId: "instance-doc", label: "Swap maxAmount", field: "maxAmount", stated: "5M", status: "match", key, chain: "ethereum", kind: "monolithic", contract: "0xrl", limit: null, readAt: null, ...extra,
});
const [K1, K2, K3] = ["0x" + "1".repeat(64), "0x" + "2".repeat(64), "0x" + "3".repeat(64)];

describe("withCheckedKeys", () => {
  it("names a checked key by its instance, linked to the instance's document, without the field word", () => {
    const out = withCheckedKeys(new Map(), [check(K1, { via: "0xpool" }), check(K1, { label: "Swap slope", field: "slope" })]);
    expect(out.get(K1)).toEqual([{ docId: "instance-doc", label: "Curve AUSD/USDC Swaps · Swap", via: "0xpool" }]);
  });
  it("keeps a name the index already has, and skips a check that found no key", () => {
    const named = new Map<string, AtlasKeyRef[]>([[K2, [{ docId: "d", label: "stated" }]]]);
    const out = withCheckedKeys(named, [check(K2), check(null), check(K3, { instanceDocId: null })]);
    expect(out.get(K2)).toEqual([{ docId: "d", label: "stated" }]);
    expect(out.get(K3)).toEqual([{ docId: "value-doc", label: "Curve AUSD/USDC Swaps · Swap" }]);
    expect(out.size).toBe(2);
  });
});
