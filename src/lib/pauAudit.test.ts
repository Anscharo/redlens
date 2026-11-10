// Audit reasons: a disagreement placed by which side moved last, a limit off on
// both sides whose stated slope disagrees blamed on the atlas, and values that
// need no audit (match, not stated, not read) left out.
import { describe, expect, it } from "vitest";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { checkReason, switchedOffSlope } from "./pauAudit.ts";

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
  it("reads a key set before its history's window as the chain moving first, whenever the atlas wrote", () => {
    const c = check("mismatch");
    for (const atlas of ["2025-12-01", "2026-05-01"]) expect(checkReason(c, [c], { ...at(null, atlas), chainBefore: "2026-01-03T07:37:02.000Z" })).toBe("atlas-newer");
    expect(checkReason(c, [c], { ...at(null, null), chainBefore: "2026-01-03T07:37:02.000Z" })).toBe("order-unknown");
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

describe("checkReason with the Operator's reach", () => {
  const named = { atlasChanged: "2026-06-01", pr: 337, date: "2026-06-10", poll: { id: "0xp", title: "[Grove Artifact] Rate Limits", space: "grovefinance.eth" } };
  const routes = (kind: "raise" | "beyond") => ({ admins: ["0xa"], operator: { reach: kind === "raise" ? { kind, raises: 1, first: "t", last: "t" } : { kind } } });
  it("blames the Operator only where it can reach the value, and flags an off-spell item it cannot", () => {
    const c = check("mismatch");
    const offSpell = { kind: "off-spell" as const, named };
    expect(checkReason(c, [c], at("2026-04-01", "2026-06-01"), offSpell, routes("raise"))).toBe("operator-not-applied");
    expect(checkReason(c, [c], at("2026-04-01", "2026-06-01"), offSpell, routes("beyond"))).toBe("beyond-operator");
    expect(checkReason(c, [c], at("2026-04-01", "2026-06-01"), offSpell)).toBe("off-spell");
    expect(checkReason(c, [c], at("2026-04-01", "2026-06-01"), { kind: "unnamed", atlasChanged: "2026-06-01", pr: 1 }, routes("beyond"))).toBe("atlas-newer");
  });
});
