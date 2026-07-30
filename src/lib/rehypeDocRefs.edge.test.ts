// Split from rehypeDocRefs.test.ts to keep files near the ~150-line
// convention — targets the remaining uncovered branches: a code span that
// isn't a lone text child, a code span whose text isn't a uuid at all, a
// bare doc_no that runs right to the end of its text node, and Pass 3's
// two "not actually an adjacent link pair" guards.
import { describe, it, expect } from "vitest";
import type { Root, Element, Text } from "hast";
import type { AtlasNode } from "../types";
import type { AtlasBundle } from "./docsTypes";
import { buildDocRefResolver } from "./docRefResolver";
import { rehypeDocRefs } from "./rehypeDocRefs";

let order = 0;
const mk = (id: string, doc_no: string, title: string): AtlasNode => ({
  id,
  doc_no,
  title,
  type: "Core",
  depth: 1,
  parentId: null,
  content: "x",
  order: order++,
  addressRefs: [],
});

function bundleFrom(nodes: AtlasNode[]): AtlasBundle {
  const docs: Record<string, AtlasNode> = {};
  const docNoToId = new Map<string, string>();
  for (const n of nodes) {
    docs[n.id] = n;
    docNoToId.set(n.doc_no, n.id);
  }
  return { docs, docNoToId, byParent: new Map(), atlasCommit: null };
}

const FULL = "55999acf-75fe-4adf-8584-9746ef50d3e4";
const resolver = buildDocRefResolver(
  bundleFrom([mk(FULL, "A.3.2", "Stability Fee Mechanics And Governance Overview Extended")]),
);

function run(tree: Root): Root {
  rehypeDocRefs(resolver)()(tree);
  return tree;
}

const kids = (tree: Root) => (tree.children[0] as Element).children;
const isLink = (n: unknown): n is Element => !!n && (n as Element).type === "element" && (n as Element).tagName === "a";

describe("rehypeDocRefs — code-span shape guards", () => {
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
                { type: "text", value: FULL },
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

  it("leaves a code span whose text matches neither uuid pattern untouched", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [{ type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: "hello" }] }],
        },
      ],
    };
    run(tree);
    expect((kids(tree)[0] as Element).tagName).toBe("code");
  });
});

describe("rehypeDocRefs — bare doc_no at the end of a text node", () => {
  it("linkifies a doc_no with nothing after it, leaving no trailing text node", () => {
    const tree: Root = {
      type: "root",
      children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "See A.3.2" }] }],
    };
    run(tree);
    const c = kids(tree);
    expect(c).toHaveLength(2);
    expect((c[0] as Text).value).toBe("See ");
    expect(isLink(c[1])).toBe(true);
  });
});

describe("rehypeDocRefs — Pass 3 adjacency guards", () => {
  const codeOf = (value: string): Element => ({
    type: "element",
    tagName: "code",
    properties: {},
    children: [{ type: "text", value }],
  });

  it("does not collapse when the third sibling isn't a link (plain trailing text)", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [codeOf(FULL), { type: "text", value: " and more prose, no second link" }],
        },
      ],
    };
    run(tree);
    const c = kids(tree);
    expect(c.filter(isLink)).toHaveLength(1);
  });

  it("does not collapse when the separator slot is itself an element, not text", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            codeOf(FULL),
            { type: "element", tagName: "br", properties: {}, children: [] },
            { type: "text", value: "A.3.2" },
          ],
        },
      ],
    };
    run(tree);
    // Pass 2 also linkifies the bare "A.3.2" text into a second, same-target
    // link — Pass 3 must still refuse to collapse the pair since the
    // separator between them is a <br> element, not a text node.
    const c = kids(tree);
    expect(c.filter(isLink)).toHaveLength(2);
  });
});
