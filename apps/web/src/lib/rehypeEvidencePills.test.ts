import { describe, it, expect } from "vitest";
import type { Root, Element, Text } from "hast";
import { rehypeEvidencePills } from "./rehypeEvidencePills";

function run(tree: Root): Root {
  rehypeEvidencePills()()(tree);
  return tree;
}

const para = (value: string): Root => ({
  type: "root",
  children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value }] }],
});

const codeSpan = (value: string): Root => ({
  type: "root",
  children: [
    {
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "element", tagName: "code", properties: {}, children: [{ type: "text", value }] }],
    },
  ],
});

const kids = (tree: Root) => (tree.children[0] as Element).children;
const isPill = (n: unknown): n is Element =>
  !!n && (n as Element).type === "element" && (n as Element).tagName === "span" &&
  !!((n as Element).properties?.className as string[] | undefined)?.includes("evidence-pill");
const pillText = (n: Element) => (n.children[0] as Text).value;
const pillClass = (n: Element) => ((n.properties?.className ?? []) as string[]).join(" ");

describe("rehypeEvidencePills", () => {
  it("turns a mid-paragraph evidence tag into a pill, keeping surrounding text", () => {
    const t = run(para("CrossView claim [evidence level 2 · source-read ✓ 2026-07-27]: all ten."));
    const c = kids(t);
    expect(c).toHaveLength(3);
    expect((c[0] as Text).value).toBe("CrossView claim ");
    expect(isPill(c[1]) && pillText(c[1] as Element)).toBe("L2 · source-read ✓ 2026-07-27");
    expect(pillClass(c[1] as Element)).toBe("evidence-pill evidence-pill-2");
    expect((c[2] as Text).value).toBe(": all ten.");
  });

  it("turns an italic label line's leading tag into a pill", () => {
    const t = run(para("[evidence level 1 · censused] — doc-type counts are script-censused."));
    const c = kids(t);
    expect(isPill(c[0])).toBe(true);
    expect(pillText(c[0] as Element)).toBe("L1 · censused");
    expect((c[1] as Text).value).toBe(" — doc-type counts are script-censused.");
  });

  it("unwraps a backtick-wrapped tag (inline code span) into a pill", () => {
    const t = run(codeSpan("[evidence level 4 · unverified]"));
    const c = kids(t);
    expect(c).toHaveLength(1);
    expect(isPill(c[0])).toBe(true);
    expect(pillText(c[0] as Element)).toBe("L4 · unverified");
    expect(pillClass(c[0] as Element)).toBe("evidence-pill evidence-pill-4");
  });

  it("leaves a code span with extra content around the tag as plain code", () => {
    const t = run(codeSpan("see [evidence level 3 · corroborated] here"));
    const c = kids(t);
    expect((c[0] as Element).tagName).toBe("code");
  });

  it("leaves the deliberately-malformed combined-tag example untouched", () => {
    const t = run(
      para("never a combined [evidence level 3 · corroborated / evidence level 4 · unverified]-style range"),
    );
    const c = kids(t);
    expect(c).toHaveLength(1);
    expect((c[0] as Text).value).toContain("[evidence level 3 · corroborated / evidence level 4 · unverified]");
  });

  it("handles multiple tags in one text node", () => {
    const t = run(para("first [evidence level 1 · censused] then [evidence level 3 · corroborated] end"));
    const pills = kids(t).filter(isPill);
    expect(pills.map(pillText)).toEqual(["L1 · censused", "L3 · corroborated"]);
  });

  it("leaves plain text with no tag untouched", () => {
    const t = run(para("nothing to see here"));
    expect(kids(t)).toHaveLength(1);
  });
});
