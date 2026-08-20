// Split from rehypeEvidencePills.test.ts to keep files near the ~150-line
// convention — covers the remaining uncovered branches: a code span with
// more than one child (never a lone-text tag), and an evidence tag that
// runs to the very end of its text node (no trailing text to push).
import { describe, it, expect } from "vitest";
import type { Root, Element, Text } from "hast";
import { rehypeEvidencePills } from "./rehypeEvidencePills";

function run(tree: Root): Root {
  rehypeEvidencePills()()(tree);
  return tree;
}

const kids = (tree: Root) => (tree.children[0] as Element).children;
const isPill = (n: unknown): n is Element =>
  !!n && (n as Element).type === "element" && (n as Element).tagName === "span" &&
  !!((n as Element).properties?.className as string[] | undefined)?.includes("evidence-pill");

describe("rehypeEvidencePills — code-span shape guard", () => {
  it("leaves a code span with more than one child untouched", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: {},
              children: [
                { type: "text", value: "[evidence level 2 · censused]" },
                { type: "element", tagName: "em", properties: {}, children: [] },
              ],
            },
          ],
        },
      ],
    };
    run(tree);
    const code = kids(tree)[0] as Element;
    expect(code.tagName).toBe("code");
    expect(code.children).toHaveLength(2);
  });
});

describe("rehypeEvidencePills — tag at the end of a text node", () => {
  it("turns a trailing tag into a pill with no trailing text node left over", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [{ type: "text", value: "CrossView claim [evidence level 1 · censused]" }],
        },
      ],
    };
    run(tree);
    const c = kids(tree);
    expect(c).toHaveLength(2);
    expect((c[0] as Text).value).toBe("CrossView claim ");
    expect(isPill(c[1])).toBe(true);
  });
});
