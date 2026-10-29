// Reusing a previous snapshot's naming: its derivations come back whatever the
// inputs, its misses only under the same inputs and never for a diamond, and
// nothing crosses a NAMER_VERSION or survives `keep`.
import { describe, expect, it } from "bun:test";
import type { LiveRateLimit, PauSnapshot } from "../../lib/pau.ts";
import { DIAMOND_INPUTS, NAMER_VERSION, namingInputs, settledKeys } from "./key-memo.ts";

const V = "0x" + "a".repeat(40);
const limit = (key: string, derived?: LiveRateLimit["derived"]): LiveRateLimit => ({ key, configured: { maxAmount: "0", slope: "0" }, setAt: { block: 1, time: "", tx: "" }, changes: 1, data: null, available: null, ...(derived ? { derived } : {}) });
const prev = (keysNamedWith: string | undefined): PauSnapshot => ({
  deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic", ...(keysNamedWith ? { keysNamedWith } : {}),
  contracts: [{ role: "rateLimits", address: "0x1", events: 1, historyComplete: true, rateLimits: [limit("0xAA", { constant: "LIMIT_4626_DEPOSIT", args: [V] }), limit("0xbb")] }],
});

describe("namingInputs", () => {
  it("stamps the version and ignores order, case and repeats", () => {
    const a = namingInputs(["LIMIT_B", "LIMIT_A"], [V, V.toUpperCase().replace("0X", "0x")]);
    expect(a).toBe(namingInputs(["LIMIT_A", "LIMIT_B"], [V]));
    expect(a.startsWith(`${NAMER_VERSION}:`)).toBe(true);
    expect(a).not.toBe(namingInputs(["LIMIT_A", "LIMIT_B"], [V, "0x" + "b".repeat(40)]));
  });
});

describe("settledKeys", () => {
  const inputs = namingInputs(["LIMIT_4626_DEPOSIT"], [V]);
  const all = () => true;

  it("reuses a derivation whatever the inputs, and a miss only under the same inputs", () => {
    const same = settledKeys(prev(inputs), inputs, all);
    expect([same("0xaa")?.constant, same("0xbb"), same("0xcc")]).toEqual(["LIMIT_4626_DEPOSIT", null, undefined]);
    const moved = settledKeys(prev(inputs), namingInputs(["LIMIT_4626_DEPOSIT"], []), all);
    expect([moved("0xaa")?.constant, moved("0xbb")]).toEqual(["LIMIT_4626_DEPOSIT", undefined]);
  });
  it("never reuses a diamond's misses, nor what `keep` refuses", () => {
    expect(settledKeys(prev(DIAMOND_INPUTS), DIAMOND_INPUTS, all)("0xbb")).toBeUndefined();
    expect(settledKeys(prev(inputs), inputs, () => false)("0xaa")).toBeUndefined();
  });
  it("settles nothing from an unstamped snapshot or another version", () => {
    expect(settledKeys(prev(undefined), inputs, all)("0xaa")).toBeUndefined();
    expect(settledKeys(prev(`${NAMER_VERSION + 1}:x`), `${NAMER_VERSION + 1}:x`, all)("0xaa")).toBeUndefined();
    expect(settledKeys(undefined, inputs, all)("0xaa")).toBeUndefined();
  });
});
