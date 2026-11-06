import { describe, expect, it } from "vitest";
import type { AddressCheck } from "@/lib/pauAddressChecks";
import type { LiveRateLimit } from "@/lib/pau";
import { addressRowMark } from "./addressMarks";

const key = (k: string, constant: string): LiveRateLimit => ({
  key: k, configured: { maxAmount: "1", slope: "0" }, setAt: { block: 1, time: "t", tx: "0xt" }, changes: 1, data: null, available: null, derived: { constant, args: [] },
});
const unstated = (limits: LiveRateLimit[]): AddressCheck => ({
  kind: "rate-limit-id", status: "not-stated", subject: "to be specified", reason: "the atlas states no ID yet", chain: "ethereum", limits, params: [], onchain: [], symbols: {},
});

describe("addressRowMark: an ID the atlas has not stated", () => {
  it("flags a likely key when the PAU holds one derived from the instance's addresses, listing each once", () => {
    const deposit = key("0x" + "a".repeat(64), "LIMIT_AAVE_DEPOSIT");
    const m = addressRowMark(unstated([deposit, deposit, key("0x" + "b".repeat(64), "LIMIT_AAVE_WITHDRAW")]), "doc");
    expect(m.mark).toBe("candidate");
    expect(m.lines.filter((l) => "label" in l).map((l) => ("label" in l ? l.label : ""))).toEqual(["LIMIT_AAVE_DEPOSIT", "LIMIT_AAVE_WITHDRAW"]);
  });

  it("stays a plain – when no such key is held", () => {
    expect(addressRowMark(unstated([]), "doc").mark).toBe("not-stated");
  });
});
