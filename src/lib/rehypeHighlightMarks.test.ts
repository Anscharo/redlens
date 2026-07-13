import { describe, it, expect } from "vitest";
import type { Root, Element, Text } from "hast";
import { rehypeHighlightMarks } from "./rehypeHighlightMarks";
import { parseReportQuery } from "./reportFilter";

// Runs the plugin against a hast tree in place, mirroring how unified invokes
// it (attacher → transformer). Returns the mutated tree.
function run(tree: Root, query: string, mode: "broad" | "phrase" | "strict" = "broad"): Root {
  rehypeHighlightMarks(parseReportQuery(query, mode))()(tree);
  return tree;
}

// A <p> wrapping one text node — the common case NodeContent produces.
const para = (value: string): Root => ({
  type: "root",
  children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value }] }],
});

const kids = (tree: Root) => (tree.children[0] as Element).children;
const isMark = (n: unknown): n is Element =>
  !!n && (n as Element).type === "element" && (n as Element).tagName === "mark";
const markTexts = (tree: Root): string[] =>
  kids(tree).filter(isMark).map((m) => (m.children[0] as Text).value);

describe("rehypeHighlightMarks", () => {
  it("splits a text node into text / <mark> / text around the needle", () => {
    const t = run(para("the rate update"), "rate");
    const c = kids(t);
    expect(c).toHaveLength(3);
    expect((c[0] as Text).value).toBe("the ");
    expect(isMark(c[1]) && (c[1] as Element).properties?.className).toEqual(["q-mark"]);
    expect(markTexts(t)).toEqual(["rate"]);
    expect((c[2] as Text).value).toBe(" update");
  });

  it("marks a needle at index 0 with no leading text node", () => {
    const t = run(para("rate rising"), "rate");
    expect(isMark(kids(t)[0])).toBe(true);
    expect(markTexts(t)).toEqual(["rate"]);
  });

  it("prefers the longest needle on overlap (longest-first alternation)", () => {
    // Both "rat" and "rate" match at the same spot; the long one must win.
    expect(markTexts(run(para("the rate"), "rat rate"))).toEqual(["rate"]);
  });

  it("marks every occurrence", () => {
    expect(markTexts(run(para("rate then rate"), "rate"))).toEqual(["rate", "rate"]);
  });

  it("strict mode is case-sensitive", () => {
    expect(markTexts(run(para("rate and Rate"), "'Rate'", "strict"))).toEqual(["Rate"]);
    // broad/default folds case
    expect(markTexts(run(para("rate and Rate"), "rate"))).toEqual(["rate", "Rate"]);
  });

  it("leaves a non-matching tree untouched (single text node)", () => {
    const t = run(para("nothing here"), "rate");
    expect(kids(t)).toHaveLength(1);
    expect((kids(t)[0] as Text).value).toBe("nothing here");
  });

  it("empty query is a no-op", () => {
    const t = run(para("the rate"), "   ");
    expect(kids(t)).toHaveLength(1);
  });

  it("does not re-mark text already inside a <mark> (guard against nesting)", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "mark",
          properties: { className: ["q-mark"] },
          children: [{ type: "text", value: "rate" }],
        },
      ],
    };
    run(tree, "rate");
    const mark = tree.children[0] as Element;
    expect(mark.children).toHaveLength(1);
    expect((mark.children[0] as Text).value).toBe("rate");
  });

  it("splices independently across multiple text nodes / siblings", () => {
    const tree: Root = {
      type: "root",
      children: [
        { type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "rate one" }] },
        { type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "two rate" }] },
      ],
    };
    run(tree, "rate");
    const p0 = (tree.children[0] as Element).children;
    const p1 = (tree.children[1] as Element).children;
    expect(p0.filter(isMark).map((m) => ((m as Element).children[0] as Text).value)).toEqual(["rate"]);
    expect(isMark(p0[0])).toBe(true); // "rate one" → mark first
    expect(isMark(p1[p1.length - 1])).toBe(true); // "two rate" → mark last
  });
});
