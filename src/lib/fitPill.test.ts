import { describe, it, expect } from "vitest";
import { fitPillFontSize, PILL_MAX_PX, PILL_MIN_PX } from "./fitPill";

describe("fitPillFontSize", () => {
  it("uses the max size when the label easily fits", () => {
    expect(fitPillFontSize("CORE", 400)).toBe(PILL_MAX_PX);
  });

  it("never drops below the readable floor for a long label in a tiny gutter", () => {
    expect(fitPillFontSize("ACTIVE DATA CONTROLLER", 30)).toBe(PILL_MIN_PX);
  });

  it("stays within [min, max] for any width", () => {
    for (const w of [-10, 0, 5, 50, 120, 1000]) {
      const f = fitPillFontSize("ACTIVE DATA CONTROLLER", w);
      expect(f).toBeGreaterThanOrEqual(PILL_MIN_PX);
      expect(f).toBeLessThanOrEqual(PILL_MAX_PX);
    }
  });
});
