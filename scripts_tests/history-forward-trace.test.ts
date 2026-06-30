// Independent forward tracer + forward/reverse cross-check (plan §4.0 / §10.4).
// Pure-function fixtures: exact-hash carry, mutual-best residual, and a
// hand-constructed CONFLICT where the reverse greedy pick (order-first) and the
// forward mutual-best pick (highest-overlap) name different predecessors.
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
// @ts-expect-error — .mjs without types
import { forwardMatch, forwardTrace, diffPasses, forwardLinks } from "../scripts/lib/history-forward-trace.mjs";

type Node = any;
const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");
const node = (id: string, o: Partial<Node> & { order: number }): Node => ({
  title: o.title ?? id,
  doc_no: o.doc_no ?? null,
  type: o.type ?? "Core",
  section: o.section ?? "S",
  ancestors: o.ancestors ?? [],
  content: o.content ?? id,
  contentHash: o.contentHash ?? md5(o.content ?? id),
  structuralKey: o.structuralKey ?? `k:${id}`,
  order: o.order,
});
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ");

describe("forwardMatch", () => {
  it("pairs exact content by hash (symmetric tier 1)", () => {
    const a = node("a", { order: 0, content: "the body never changes here" });
    const a2 = node("a2", { order: 0, content: "the body never changes here" });
    const { pairs } = forwardMatch([a], [a2]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].method).toBe("exact");
    expect(pairs[0].older).toBe(a);
  });

  it("pairs a residual edit by mutual-best shingle overlap", () => {
    const w = words(16);
    const older = node("o", { order: 0, structuralKey: "ko", content: w });
    const newer = node("n", { order: 0, structuralKey: "kn", content: w.replace("w16", "w16x") });
    const { pairs } = forwardMatch([older], [newer]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].method).toBe("mutual-best");
  });
});

describe("forwardTrace", () => {
  it("carries one quasi-id across an unchanged doc and mints a new one for a birth", () => {
    const x0 = node("x", { order: 0, content: "stable doc body that does not change" });
    const x1 = node("x", { order: 0, content: "stable doc body that does not change" });
    const x2 = node("x", { order: 0, content: "stable doc body that does not change" });
    const born = node("y", { order: 1, content: "a brand new document appearing later on" });
    const commits = [
      { sha: "c0", nodes: [x0] },
      { sha: "c1", nodes: [x1] },
      { sha: "c2", nodes: [x2, born] },
    ];
    const { idOf, births, quasiCount } = forwardTrace(commits);
    expect(idOf.get(x0)).toBe(idOf.get(x1));
    expect(idOf.get(x1)).toBe(idOf.get(x2)); // same quasi-id threaded forward
    expect(idOf.get(born)).not.toBe(idOf.get(x2)); // birth gets its own
    expect(quasiCount).toBe(2);
    expect(births.find((b: any) => b.sha === "c2").n).toBe(1);
  });
});

describe("forwardLinks", () => {
  it("maps each newer node to the forward pass's predecessor key (content-addressed)", () => {
    const o = node("o", { order: 0, content: "stable doc body that does not change at all" });
    const n = node("n", { order: 0, content: "stable doc body that does not change at all" });
    const born = node("b", { order: 1, content: "a fresh document with no prior version anywhere" });
    const links = forwardLinks([{ sha: "o0000000", nodes: [o] }, { sha: "n0000000", nodes: [n, born] }]);
    expect(links.get(`n0000000:${n.contentHash}`)).toBe(`o0000000:${o.contentHash}`); // carried
    expect(links.get(`n0000000:${born.contentHash}`)).toBeNull(); // forward-birth
    expect(links.has(`o0000000:${o.contentHash}`)).toBe(false); // genesis nodes aren't "newer" of any hop
  });
});

describe("diffPasses", () => {
  it("agrees on an exact-content carry (no divergence)", () => {
    const a = node("a", { order: 0, content: "identical prose across the two commits here" });
    const a2 = node("a", { order: 0, content: "identical prose across the two commits here" });
    const { tally, divergences } = diffPasses([{ sha: "o", nodes: [a] }, { sha: "n", nodes: [a2] }]);
    expect(tally.agree).toBe(1);
    expect(tally.conflict).toBe(0);
    expect(divergences).toHaveLength(0);
  });

  it("flags a CONFLICT when reverse (order-first) and forward (best-overlap) disagree", () => {
    // older A (order 0) and B (order 1) share a structural key with newer N → reverse
    // tier 2.7 pairs the FIRST one (A) that clears the floor; forward mutual-best pairs
    // the HIGHEST-overlap one (B). N edits the tail: B drops 1 shingle (~0.80), A drops
    // 2 (~0.64) — both ≥0.6, but B is closer.
    const w = words(16).split(" ");
    const N = w.join(" ");
    const Bw = [...w]; Bw[15] = "w16b";
    const Aw = [...w]; Aw[14] = "w15a"; Aw[15] = "w16a";
    const A = node("A", { order: 0, structuralKey: "K", content: Aw.join(" ") });
    const B = node("B", { order: 1, structuralKey: "K", content: Bw.join(" ") });
    const Nn = node("N", { order: 0, structuralKey: "K", content: N });
    const { tally, divergences } = diffPasses([{ sha: "o", nodes: [A, B] }, { sha: "n", nodes: [Nn] }]);
    expect(tally.conflict).toBe(1);
    const d = divergences.find((x: any) => x.type === "conflict");
    expect(d.forwardOlder.title).toBe("B"); // forward → higher-overlap predecessor
    expect(d.reverseOlder.title).toBe("A"); // reverse → order-first predecessor
    expect(d.reverseOlder.tier).toBe(2.7);
  });
});
