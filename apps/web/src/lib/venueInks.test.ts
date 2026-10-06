import { describe, expect, it } from "vitest";
import { ARC_OTHER_ID } from "./settlementArcRows";
import { venueInks } from "./venueInks";

const slotOf = (ink: string | undefined) => Number(/--msc-venue-(\d)/.exec(ink ?? "")?.[1]);

describe("venueInks", () => {
  it("gives the first five venues five different colours and the folded tails grey", () => {
    const keys = ["S1", "S2", "S3", "S4", "S5"];
    const inks = venueInks(keys, [[...keys, ARC_OTHER_ID]]);
    expect(new Set(keys.map((k) => inks.get(k))).size).toBe(5);
    expect(inks.get(ARC_OTHER_ID)).toBe("var(--gray)");
    expect(inks.get("_other")).toBe("var(--gray)");
  });

  it("never gives neighbours the same colour, or blue next to violet, in any stack or list", () => {
    const order = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const sequences = [
      ["F", "G", "A", "B", "C", "D", "E"],
      ["F", "G", "A", "H", "C", "B"],
      ["G", "A", "E", "D", "H", "F", "C", "B"],
    ];
    const inks = venueInks(order, sequences);
    for (const seq of sequences) {
      for (let i = 1; i < seq.length; i++) {
        const pair = [slotOf(inks.get(seq[i - 1])), slotOf(inks.get(seq[i]))];
        expect(pair[0]).not.toBe(pair[1]);
        expect(pair.sort().join()).not.toBe("1,5");
      }
    }
  });

  it("is the same map for both charts: a venue in the circle and the AUM list has one colour", () => {
    const inks = venueInks(["A", "B"], [["A", "B"], ["B", "C", "A"]]);
    expect([...inks.keys()]).toEqual(expect.arrayContaining(["A", "B", "C"]));
  });
});
