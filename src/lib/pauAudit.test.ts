// Audit reasons: a disagreement placed by which side moved last, a limit off on
// both sides whose stated slope disagrees blamed on the atlas, and values that
// need no audit (match, not stated, not read) left out.
import { describe, expect, it } from "vitest";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { checkReason, lastContentChange, switchedOffSlope } from "./pauAudit.ts";

const data = (maxAmount: string, slope: string) => ({ maxAmount, slope, lastAmount: "0", lastUpdated: "0" });
const check = (status: ValueCheck["status"], extra: Partial<ValueCheck> = {}): ValueCheck => ({
  docId: "d", instance: "I", instanceDocId: null, label: "Inflow maxAmount", field: "maxAmount", stated: "5", status, key: "0xk", chain: "ethereum", kind: "monolithic", contract: "0xc", limit: null, readAt: null, ...extra,
});
const at = (chain: string | null, atlas: string | null) => ({ chain, atlas });

describe("checkReason", () => {
  it("places a mismatch by which side moved last, and nowhere when the dates cannot tell", () => {
    const c = check("mismatch");
    expect(checkReason(c, [c], at("2026-05-01", "2026-04-01"))).toBe("chain-newer");
    expect(checkReason(c, [c], at("2026-04-01", "2026-05-01"))).toBe("atlas-newer");
    expect(checkReason(c, [c], at("2026-04-01", "2026-04-01"))).toBe("order-unknown");
    expect(checkReason(c, [c], at(null, "2026-04-01"))).toBe("order-unknown");
  });
  it("maps the other statuses, and leaves out values that need no audit", () => {
    const reasons = (["not-set", "no-key", "ambiguous", "units-unknown", "match", "not-stated", "unread", "no-deployment", "unparsed", "unknown-chain"] as const).map((s) => checkReason(check(s), [], at(null, null)));
    expect(reasons).toEqual(["not-set", "no-key", "several-keys", "units-unknown", null, null, null, null, null, null]);
  });
  it("blames the atlas for a slope stated on a limit both sides switch off", () => {
    const limit = { key: "0xk", configured: { maxAmount: "0", slope: "0" }, setAt: { block: 1, time: "2026-01-01T00:00:00Z", tx: "0xt" }, changes: 1, data: data("0", "0"), available: "0" };
    const slope = check("mismatch", { field: "slope", label: "Inflow slope", limit });
    const max = check("match", { limit });
    expect(switchedOffSlope(slope, [slope, max])).toBe(true);
    expect(checkReason(slope, [slope, max], at("2026-01-01", "2026-06-01"))).toBe("switched-off-slope");
    expect(switchedOffSlope(slope, [slope])).toBe(false);
  });
});

describe("lastContentChange", () => {
  it("takes the latest addition or real edit, ignoring moves and cosmetic edits", () => {
    expect(lastContentChange([
      { date: "2026-01-01T10:00:00Z", changeType: "added" },
      { date: "2026-03-01", changeType: "modified", changeKind: "semantic" },
      { date: "2026-04-01", changeType: "modified", changeKind: "typo" },
      { date: "2026-05-01", changeType: "moved" },
    ])).toBe("2026-03-01");
    expect(lastContentChange([])).toBeNull();
  });
});
