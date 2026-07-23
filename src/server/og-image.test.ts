import { describe, it, expect } from "bun:test";
import { truncateTitle, titleFontSize, getOgImage, getCardImage, cardFromQuery, renderCard, ogCacheKey, type CardSpec } from "./og-image.ts";

const PNG_MAGIC = "89504e470d0a1a0a";

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

  it("ogCacheKey combines UUID prefix, doc number, preview, and title", () => {
    expect(ogCacheKey(UUID, "Title", "A.1")).toBe("56b15d7d-c|A.1||Title");
    expect(ogCacheKey(UUID, "Title", "A.1", "PR #1")).toBe("56b15d7d-c|A.1|PR #1|Title");
  });

  it("a preview doc card re-renders vs the live one", async () => {
    const live = await getOgImage(UUID, "Accessibility Scope", "A.1");
    const prev = await getOgImage(UUID, "Accessibility Scope", "A.1", "PR #184");
    expect(prev).not.toBe(live!);
  });
});

describe("cardFromQuery", () => {
  const spec = (q: string) => cardFromQuery(new URLSearchParams(q));
  it("maps each kind (and defaults on unknown/missing)", () => {
    expect(spec("kind=radar")).toEqual({ kind: "radar" });
    expect(spec("kind=radar-actor&name=Spark")).toEqual({ kind: "radarActor", agent: "Spark" });
    expect(spec("kind=reports")).toEqual({ kind: "reports" });
    expect(spec("kind=report&name=Stale Dates")).toEqual({ kind: "report", name: "Stale Dates" });
    expect(spec("kind=connect")).toEqual({ kind: "connect" });
    expect(spec("kind=preview&label=PR #1")).toEqual({ kind: "preview", label: "PR #1" });
    expect(spec("")).toEqual({ kind: "default" });
    expect(spec("kind=nonsense")).toEqual({ kind: "default" });
  });
});

describe("renderCard / getCardImage", () => {
  const KINDS: CardSpec[] = [
    { kind: "default" },
    { kind: "radar" },
    { kind: "radarActor", agent: "Spark Protocol" },
    { kind: "radarActor", agent: "" }, // empty → placeholder branch
    { kind: "reports" },
    { kind: "report", name: "Integrator Reward Relationships" },
    { kind: "report", name: "" },
    { kind: "connect" },
    { kind: "preview", label: "PR #184" },
    { kind: "preview", label: "" },
    { kind: "doc", docNo: "A.1", title: "Accessibility Scope" },
    { kind: "doc", docNo: "", title: "No Number" }, // no eyebrow branch
    { kind: "doc", docNo: "A.1", title: "Scope", preview: "PR #184" }, // preview eyebrow branch
  ];

  it("renders a valid PNG for every card kind", async () => {
    for (const spec of KINDS) {
      const png = await renderCard(spec);
      expect(png).not.toBeNull();
      expect(png!.subarray(0, 8).toString("hex")).toBe(PNG_MAGIC);
    }
  });

  it("getCardImage memoizes by spec", async () => {
    const a = await getCardImage({ kind: "radar" });
    const b = await getCardImage({ kind: "radar" });
    expect(b).toBe(a!);
    const c = await getCardImage({ kind: "reports" });
    expect(c).not.toBe(a!);
  });
});
