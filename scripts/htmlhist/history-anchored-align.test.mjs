import { describe, expect, it } from "vitest";
import { anchoredAlign } from "./history-anchored-align.mjs";

// md doc / html row factories — only the fields the aligner reads.
const md = (uuid, title, content = "", type = "Core") => ({ uuid, title, type, content });
const row = (title, content = "", type = "Core") => ({ title, type, content });

/** Seed map from explicit (rowIndex → uuid) claims. */
const seed = (rows, claims) => new Map(Object.entries(claims).map(([i, u]) => [rows[Number(i)], u]));

describe("anchoredAlign", () => {
  it("forces the single degenerate leaf between two anchors (the Global Activation Status case)", () => {
    const mdNodes = [
      md("u-primitive", "Agent Creation Primitive", "all data and specifications for Grove's Instance"),
      md("u-hub", "Primitive Hub Document", "base information relevant to Grove's usage"),
      md("u-gas", "Global Activation Status", "Completed"),
      md("u-active", "Active Instances Directory", "Directory of all Instances with status Active"),
    ];
    const rows = [
      row("Agent Creation Primitive", "all data and specifications for Grove's Instance"),
      row("Primitive Hub Document", "base information relevant to Grove's usage"),
      row("Global Activation Status", "Completed"),
      row("Active Instances Directory", "Directory of all Instances with status Active"),
    ];
    // the content matcher threaded the distinctive docs and missed the one-word leaf
    const claims = seed(rows, { 0: "u-primitive", 1: "u-hub", 3: "u-active" });

    const { pairs, stats } = anchoredAlign(mdNodes, rows, claims);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ mdUuid: "u-gas", htmlIndex: 2, rule: "gap-exact", contentEq: true });
    expect(stats.anchorsUsed).toBe(3);
  });

  it("fills a multi-doc gap when order forces the whole run", () => {
    const mdNodes = [md("a", "A"), md("x", "Global Activation Status"), md("y", "Active Instances Directory"), md("b", "B")];
    const rows = [row("A"), row("Global Activation Status"), row("Active Instances Directory"), row("B")];
    const { pairs } = anchoredAlign(mdNodes, rows, seed(rows, { 0: "a", 3: "b" }));
    expect(pairs.map((p) => [p.mdUuid, p.htmlIndex])).toEqual([["x", 1], ["y", 2]]);
    expect(pairs.every((p) => p.rule === "gap-exact")).toBe(true);
  });

  it("still pairs a uniquely-titled doc when the gap has an unequal run (a real #117 creation)", () => {
    const mdNodes = [md("a", "A"), md("new", "Brand New Doc"), md("x", "Global Activation Status"), md("b", "B")];
    const rows = [row("A"), row("Global Activation Status"), row("B")];
    const { pairs } = anchoredAlign(mdNodes, rows, seed(rows, { 0: "a", 2: "b" }));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ mdUuid: "x", htmlIndex: 1, rule: "gap-unique" });
  });

  it("abstains when the same slot repeats on both sides of an unequal gap", () => {
    const mdNodes = [md("a", "A"), md("g1", "Global Activation Status"), md("g2", "Global Activation Status"), md("b", "B")];
    const rows = [row("A"), row("Global Activation Status"), row("B")];
    const { pairs, gaps } = anchoredAlign(mdNodes, rows, seed(rows, { 0: "a", 2: "b" }));
    expect(pairs).toHaveLength(0);
    expect(gaps[0].reason).toBe("unforced");
  });

  it("never re-assigns a doc the seed already claimed", () => {
    const mdNodes = [md("a", "A"), md("x", "Global Activation Status"), md("b", "B")];
    const rows = [row("A"), row("Global Activation Status"), row("B")];
    const { pairs } = anchoredAlign(mdNodes, rows, seed(rows, { 0: "a", 1: "x", 2: "b" }));
    expect(pairs).toHaveLength(0);
  });

  it("treats document start/end as bounds, so head and tail regions still force", () => {
    const mdNodes = [md("lead", "Global Activation Status"), md("a", "A"), md("tail", "Trailing Doc")];
    const rows = [row("Global Activation Status"), row("A"), row("Trailing Doc")];
    const { pairs } = anchoredAlign(mdNodes, rows, seed(rows, { 1: "a" }));
    expect(pairs.map((p) => [p.mdUuid, p.htmlIndex])).toEqual([["lead", 0], ["tail", 2]]);
  });

  it("drops crossing anchors so a moved doc cannot bound a gap", () => {
    // "b" moved: it is 2nd in md order but last in html order, so it crosses "c".
    const mdNodes = [md("a", "A"), md("b", "B"), md("c", "C"), md("x", "Global Activation Status"), md("d", "D")];
    const rows = [row("A"), row("C"), row("Global Activation Status"), row("D"), row("B")];
    const { pairs, stats } = anchoredAlign(mdNodes, rows, seed(rows, { 0: "a", 1: "c", 3: "d", 4: "b" }));
    expect(stats.anchorsDroppedCrossing).toBe(1);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ mdUuid: "x", htmlIndex: 2 });
  });

  it("distinguishes same-title docs of different types", () => {
    const mdNodes = [md("a", "A"), md("x", "Status", "", "Core"), md("y", "Status", "", "Section"), md("b", "B")];
    const rows = [row("A"), row("Status", "", "Section"), row("Status", "", "Core"), row("B")];
    const { pairs } = anchoredAlign(mdNodes, rows, seed(rows, { 0: "a", 3: "b" }));
    // order-exact fails (types cross), but each type is unique on both sides
    expect(pairs.map((p) => [p.mdUuid, p.htmlIndex]).sort()).toEqual([["x", 2], ["y", 1]]);
  });

  it("ignores a uuid duplicated in the monolith as an anchor", () => {
    const mdNodes = [md("dup", "A"), md("dup", "A'"), md("x", "Global Activation Status"), md("b", "B")];
    const rows = [row("A"), row("Global Activation Status"), row("B")];
    const { stats } = anchoredAlign(mdNodes, rows, seed(rows, { 0: "dup", 2: "b" }));
    expect(stats.anchors).toBe(1); // only "b" anchors; "dup" is unusable
  });
});
