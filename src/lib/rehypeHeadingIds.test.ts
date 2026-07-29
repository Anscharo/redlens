import { describe, it, expect } from "vitest";
import type { Root, Element } from "hast";
import { rehypeHeadingIds } from "./rehypeHeadingIds";
import type { AnatomyHeading } from "./anatomyHeadings";

const h = (tagName: "h2" | "h3", text: string): Element => ({
  type: "element",
  tagName,
  properties: {},
  children: [{ type: "text", value: text }],
});

const heading = (level: 2 | 3, text: string, slug: string): AnatomyHeading => ({ level, text, slug });

describe("rehypeHeadingIds", () => {
  it("stamps ids onto h2/h3 elements in document order", () => {
    const tree: Root = { type: "root", children: [h("h2", "Foo"), h("h3", "Bar")] };
    const headings = [heading(2, "Foo", "foo"), heading(3, "Bar", "bar")];
    rehypeHeadingIds(headings)()(tree);
    expect((tree.children[0] as Element).properties?.id).toBe("foo");
    expect((tree.children[1] as Element).properties?.id).toBe("bar");
  });

  it("is idempotent under repeated invocation on the same tree (React StrictMode double-invoke)", () => {
    const tree: Root = { type: "root", children: [h("h2", "Foo"), h("h3", "Bar")] };
    const transform = rehypeHeadingIds([heading(2, "Foo", "foo"), heading(3, "Bar", "bar")])();
    transform(tree);
    transform(tree); // simulate a second render pass over the same tree
    expect((tree.children[0] as Element).properties?.id).toBe("foo");
    expect((tree.children[1] as Element).properties?.id).toBe("bar");
  });

  it("each transformer call starts its own fresh cursor (independent segment trees)", () => {
    const plugin = (hs: AnatomyHeading[]) => rehypeHeadingIds(hs)();
    const treeA: Root = { type: "root", children: [h("h2", "One")] };
    const treeB: Root = { type: "root", children: [h("h2", "Two")] };
    plugin([heading(2, "One", "one")])(treeA);
    plugin([heading(2, "Two", "two")])(treeB);
    expect((treeA.children[0] as Element).properties?.id).toBe("one");
    expect((treeB.children[0] as Element).properties?.id).toBe("two");
  });

  it("leaves other elements (p, h4) untouched", () => {
    const p: Element = { type: "element", tagName: "p", properties: {}, children: [] };
    const tree: Root = { type: "root", children: [p] };
    rehypeHeadingIds([heading(2, "Foo", "foo")])()(tree);
    expect(p.properties?.id).toBeUndefined();
  });

  it("leaves a heading unstamped once the headings list runs out (more h2/h3s than entries)", () => {
    const tree: Root = { type: "root", children: [h("h2", "Foo"), h("h3", "Extra")] };
    rehypeHeadingIds([heading(2, "Foo", "foo")])()(tree);
    expect((tree.children[0] as Element).properties?.id).toBe("foo");
    expect((tree.children[1] as Element).properties?.id).toBeUndefined();
  });
});
