import { describe, it, expect } from "bun:test";
import { truncateTitle, titleFontSize, getOgImage, ogCacheKey } from "./og-image.ts";

describe("truncateTitle", () => {
  it("leaves short titles unchanged", () => {
    expect(truncateTitle("Accessibility Scope")).toBe("Accessibility Scope");
  });
  it("truncates on a word boundary with an ellipsis", () => {
    const long = "The Very Long Document Title That Keeps Going On And On Beyond Ninety Characters To Test Truncation";
    const out = truncateTitle(long);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(91);
    expect(long.startsWith(out.slice(0, -1))).toBe(true); // prefix, no mid-word cut
  });
});

describe("titleFontSize", () => {
  it("shrinks monotonically as the title grows", () => {
    expect(titleFontSize(10)).toBeGreaterThan(titleFontSize(30));
    expect(titleFontSize(30)).toBeGreaterThan(titleFontSize(50));
    expect(titleFontSize(50)).toBeGreaterThan(titleFontSize(80));
  });
});

describe("getOgImage", () => {
  const UUID = "56b15d7d-cdd4-4594-bd95-4f094564ac04";

  it("renders a valid PNG and memoizes repeat calls", async () => {
    const a = await getOgImage(UUID, "Accessibility Scope", "A.1");
    expect(a).not.toBeNull();
    // PNG magic bytes.
    expect(a!.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(a!.length).toBeGreaterThan(1000);
    const b = await getOgImage(UUID, "Accessibility Scope", "A.1");
    expect(b).toBe(a!); // same cached buffer instance
  });

  it("re-renders when the title or doc number changes (UUID unchanged)", async () => {
    const a = await getOgImage(UUID, "Accessibility Scope", "A.1");
    const retitled = await getOgImage(UUID, "Accessibility Scope Renamed", "A.1");
    const renumbered = await getOgImage(UUID, "Accessibility Scope", "A.2");
    expect(retitled).not.toBe(a!); // title edit → fresh card, not the stale one
    expect(renumbered).not.toBe(a!); // doc_no edit → fresh card
    expect(retitled!.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("ogCacheKey combines UUID prefix, doc number, and title", () => {
    expect(ogCacheKey(UUID, "Title", "A.1")).toBe("56b15d7d-c|A.1|Title");
  });
});
