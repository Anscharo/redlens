import { describe, expect, it } from "vitest";
import { ARC_OTHER_ID } from "../../lib/settlementArcLayout";
import { venueInks } from "./SettlementArcSvg";

describe("venueInks", () => {
  it("gives every drawn venue its own colour and the folded tail grey", () => {
    const keys = ["S1", "S2", "S3", "S4", "S5", ARC_OTHER_ID];
    const inks = venueInks(keys);
    const named = keys.slice(0, 5).map((k) => inks.get(k));
    expect(new Set(named).size).toBe(5);
    for (const ink of named) expect(ink).toMatch(/^var\(--msc-venue-[1-5]\)$/);
    expect(inks.get(ARC_OTHER_ID)).toBe("var(--gray)");
  });

  it("follows the venue, not its rank", () => {
    expect(venueInks(["S1", "S2"]).get("S2")).toBe(venueInks(["S2", "S1"]).get("S2"));
  });
});
