import { describe, it, expect } from "vitest";
import type { Root, Element, ElementContent, Text } from "hast";
import type { AtlasNode } from "@/types";
import type { AtlasBundle } from "@/lib/docsTypes";
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
const AMBIG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const AMBIG_B = "aaaaaaaa-1111-1111-1111-111111111111";
const resolver = buildDocRefResolver(
  bundleFrom([
    mk(FULL, "A.3.2", "Stability Fee Mechanics And Governance Overview Extended"),
    mk(AMBIG_A, "A.5.1", "First Ambiguous"),
    mk(AMBIG_B, "A.5.2", "Second Ambiguous"),
  ]),
);

function run(tree: Root): Root {
  rehypeDocRefs(resolver)()(tree);
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

const mixedPara = (children: ElementContent[]): Root => ({
  type: "root",
  children: [{ type: "element", tagName: "p", properties: {}, children }],
});

const kids = (tree: Root) => (tree.children[0] as Element).children;
const textOf = (nodes: ElementContent[]) =>
  nodes.filter((n): n is Text => n.type === "text").map((n) => n.value).join("");
const isLink = (n: unknown): n is Element => !!n && (n as Element).type === "element" && (n as Element).tagName === "a";
const linkText = (n: Element) => (n.children[0] as Text).value;

describe("rehypeDocRefs", () => {
  it("turns a full-uuid code span into a DOC_NO • Title link", () => {
    const t = run(codeSpan(FULL));
    const c = kids(t);
    expect(c).toHaveLength(1);
    expect(isLink(c[0])).toBe(true);
    const link = c[0] as Element;
    expect(linkText(link)).toBe("A.3.2 • Stability Fee Mechanics And Governanc…");
    expect(link.properties?.href).toBe("/atlas?id=" + FULL);
    expect(link.properties?.title).toBe("A.3.2 - Stability Fee Mechanics And Governance Overview Extended");
  });

  it("turns a unique short 8-hex pointer code span into a link", () => {
    const t = run(codeSpan("55999acf"));
    const c = kids(t);
    expect(isLink(c[0])).toBe(true);
    expect(linkText(c[0] as Element)).toContain("A.3.2 •");
  });

  it("leaves an ambiguous short pointer as plain code", () => {
    const t = run(codeSpan("aaaaaaaa"));
    const c = kids(t);
    expect((c[0] as Element).tagName).toBe("code");
  });

  it("leaves an unresolvable short pointer as plain code", () => {
    const t = run(codeSpan("deadbeef"));
    const c = kids(t);
    expect((c[0] as Element).tagName).toBe("code");
  });

  it("linkifies a bare doc_no with trailing sentence punctuation, excluding the punctuation", () => {
    const t = run(para("See A.3.2 for details."));
    const c = kids(t);
    expect(c).toHaveLength(3);
    expect((c[0] as Text).value).toBe("See ");
    expect(isLink(c[1])).toBe(true);
    expect((c[2] as Text).value).toBe(" for details.");
  });

  it("keeps the leading slash as plain prose decoration outside the link", () => {
    const t = run(para("see /A.3.2 here"));
    const c = kids(t);
    expect((c[0] as Text).value).toBe("see /");
    expect(isLink(c[1])).toBe(true);
    expect((c[2] as Text).value).toBe(" here");
  });

  it("leaves an unresolvable doc_no (e.g. renumbered atlas) as plain text", () => {
    const t = run(para("see A.99.99 here"));
    const c = kids(t);
    expect(c).toHaveLength(1);
    expect((c[0] as Text).value).toBe("see A.99.99 here");
  });

  it("does not linkify a doc_no inside an evidence-pill span", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["evidence-pill", "evidence-pill-1"] },
          children: [{ type: "text", value: "A.3.2 · censused" }],
        },
      ],
    };
    rehypeDocRefs(resolver)()(tree);
    const span = tree.children[0] as Element;
    expect(span.children).toHaveLength(1);
    expect((span.children[0] as Text).value).toBe("A.3.2 · censused");
  });

  it("handles multiple doc_nos in one text node", () => {
    const t = run(para("first A.3.2 then A.5.1 end"));
    const links = kids(t).filter(isLink);
    expect(links).toHaveLength(2);
    expect(linkText(links[0] as Element)).toContain("A.3.2");
    expect(linkText(links[1] as Element)).toContain("A.5.1");
  });

  describe("same-doc citation-pair collapse (uuid code span + slash-doc_no)", () => {
    const codeOf = (value: string): Element => ({
      type: "element",
      tagName: "code",
      properties: {},
      children: [{ type: "text", value }],
    });

    it("collapses `uuid` /doc_no for the SAME doc into one link, dropping the slash", () => {
      const t = run(mixedPara([codeOf(FULL), { type: "text", value: " /A.3.2 (weekly cadence)" }]));
      const c = kids(t);
      const links = c.filter(isLink);
      expect(links).toHaveLength(1);
      expect(linkText(links[0] as Element)).toContain("A.3.2");
      const text = textOf(c);
      expect(text).not.toContain("/");
      expect(text).toBe(" (weekly cadence)");
    });

    it("collapses the reverse order (doc_no then the same doc's uuid code span) too", () => {
      const t = run(mixedPara([{ type: "text", value: "A.3.2 /" }, codeOf(FULL)]));
      const c = kids(t);
      const links = c.filter(isLink);
      expect(links).toHaveLength(1);
      expect(textOf(c)).not.toContain("/");
    });

    it("keeps both links (and the slash) when the code span and doc_no reference DIFFERENT docs", () => {
      const t = run(mixedPara([codeOf(FULL), { type: "text", value: " /A.5.1 elsewhere" }]));
      const c = kids(t);
      const links = c.filter(isLink);
      expect(links).toHaveLength(2);
      expect(linkText(links[0] as Element)).toContain("A.3.2");
      expect(linkText(links[1] as Element)).toContain("A.5.1");
      expect(textOf(c)).toContain("/");
    });

    it("a bare doc_no with no adjacent link is unaffected (nothing to collapse)", () => {
      const t = run(para("see A.3.2 alone"));
      const c = kids(t);
      expect(c.filter(isLink)).toHaveLength(1);
    });

    it("a bare uuid code span with no adjacent doc_no is unaffected (nothing to collapse)", () => {
      const t = run(codeSpan(FULL));
      const c = kids(t);
      expect(c.filter(isLink)).toHaveLength(1);
    });

    it('collapses the "Exemplar" idiom — doc_no, its own title spelled out, then the uuid code span', () => {
      // "A.3.2 Stability Fee Mechanics And Governance Overview Extended `uuid`"
      const t = run(
        mixedPara([
          { type: "text", value: "A.3.2 Stability Fee Mechanics And Governance Overview Extended " },
          codeOf(FULL),
        ]),
      );
      const c = kids(t);
      const links = c.filter(isLink);
      expect(links).toHaveLength(1);
      expect(linkText(links[0] as Element)).toContain("A.3.2");
    });

    it('collapses the Exemplar idiom even when the title wraps across a markdown soft line-break', () => {
      // Source wraps mid-title: "…Restrictions\n  On Removal… `uuid`"
      const t = run(
        mixedPara([
          { type: "text", value: "A.3.2 Stability Fee Mechanics And\n  Governance Overview Extended " },
          codeOf(FULL),
        ]),
      );
      const c = kids(t);
      expect(c.filter(isLink)).toHaveLength(1);
    });

    it('does NOT collapse via the title-match rule when the in-between text is prose, not the exact title', () => {
      const t = run(
        mixedPara([{ type: "text", value: "A.3.2 is discussed at length in " }, codeOf(FULL)]),
      );
      const c = kids(t);
      expect(c.filter(isLink)).toHaveLength(2);
    });
  });
});
