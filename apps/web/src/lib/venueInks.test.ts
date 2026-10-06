import { describe, expect, it } from "vitest";
import { ARC_OTHER_ID } from "./settlementArcRows";
import { venueInks } from "./venueInks";

describe("venueInks", () => {
  it("gives every circle venue its own colour and the folded tails grey", () => {
    const keys = ["S1", "S2", "S3", "S4", "S5", ARC_OTHER_ID];
    const inks = venueInks(keys, ["_other"]);
    const named = keys.slice(0, 5).map((k) => inks.get(k));
    expect(new Set(named).size).toBe(5);
    for (const ink of named) expect(ink).toMatch(/^var\(--msc-venue-[1-5]\)$/);
    expect(inks.get(ARC_OTHER_ID)).toBe("var(--gray)");
    expect(inks.get("_other")).toBe("var(--gray)");
  });

  it("follows the venue, not its rank", () => {
    expect(venueInks(["S1", "S2"]).get("S2")).toBe(venueInks(["S2", "S1"]).get("S2"));
  });

  it("lets the circle's venues claim distinct colours before AUM-only venues", () => {
    const inks = venueInks(["A", "B"], ["A", "C", "D", "E", "F", "G"]);
    expect(inks.get("A")).not.toBe(inks.get("B"));
    expect(new Set(["A", "B", "C", "D", "E"].map((k) => inks.get(k))).size).toBe(5);
    expect(inks.get("G")).toMatch(/^var\(--msc-venue-[1-5]\)$/);
  });
});
