// Tiered matcher invariants (plan §4.2). The load-bearing behaviours: positional
// alignment inside identical-content and equal-size key buckets (so duplicated
// boilerplate does NOT flood the §10.4 decision queue), and genuine
// insert/delete/contention surfacing as unmatched / ambiguous.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { matchNodes } from "../scripts/lib/history-identity.mjs";

type N = { contentHash: string; structuralKey: string; content: string; order: number; section: string };
const mk = (o: Partial<N> & { order: number }): N => ({
  contentHash: o.contentHash ?? `h:${o.content ?? o.order}`,
  structuralKey: o.structuralKey ?? `k:${o.order}`,
  content: o.content ?? "",
  section: o.section ?? "S",
  order: o.order,
});
const W = "the quick brown fox jumps over the lazy dog and then again"; // 12 words

describe("tier 1 — exact content + positional bucket alignment", () => {
  it("pairs identical rows 1:1", () => {
    const a = [mk({ order: 0, content: "x" }), mk({ order: 1, content: "y" })];
    const b = [mk({ order: 0, content: "x" }), mk({ order: 1, content: "y" })];
    const r = matchNodes(a, b);
    expect(r.pairs.length).toBe(2);
    expect(r.pairs.every((p: any) => p.tier === 1)).toBe(true);
    expect(r.ambiguous.length).toBe(0);
  });

  it("duplicated boilerplate aligns by order — NOT ambiguous (the prototype's miss)", () => {
    // three identical-content rows on each side
    const dup = (order: number) => mk({ order, content: "boiler", contentHash: "H", structuralKey: "K" });
    const a = [dup(0), dup(1), dup(2)];
    const b = [dup(0), dup(1), dup(2)];
    const r = matchNodes(a, b);
    expect(r.pairs.length).toBe(3);
    expect(r.ambiguous.length).toBe(0);
  });

  it("identical-bucket resize leaves the extra as unmatched (deletion)", () => {
    const dup = (order: number) => mk({ order, content: "boiler", contentHash: "H", structuralKey: "K" });
    const a = [dup(0), dup(1), dup(2)];
    const b = [dup(0), dup(1)];
    const r = matchNodes(a, b);
    expect(r.pairs.length).toBe(2);
    expect(r.olderUnmatched.length).toBe(1);
  });
});

describe("tier 2 / 2.5 — structural key", () => {
  it("unique key with changed content → tier 2", () => {
    const a = [mk({ order: 0, content: "foo", structuralKey: "K1", contentHash: "h1" })];
    const b = [mk({ order: 0, content: "bar", structuralKey: "K1", contentHash: "h2" })];
    const r = matchNodes(a, b);
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0].tier).toBe(2);
  });

  it("equal-size key bucket aligns by order → tier 2.5", () => {
    // two rows share a structural key (Agent Scope DB deep-hierarchy case), bodies changed
    const a = [
      mk({ order: 0, content: "alpha-old", structuralKey: "K", contentHash: "a1" }),
      mk({ order: 1, content: "beta-old", structuralKey: "K", contentHash: "b1" }),
    ];
    const b = [
      mk({ order: 0, content: "alpha-new", structuralKey: "K", contentHash: "a2" }),
      mk({ order: 1, content: "beta-new", structuralKey: "K", contentHash: "b2" }),
    ];
    const r = matchNodes(a, b);
    expect(r.pairs.length).toBe(2);
    expect(r.pairs.every((p: any) => p.tier === 2.5)).toBe(true);
    // order preserved: order-0 ↔ order-0
    expect(r.pairs.find((p: any) => p.older.order === 0)!.newer.order).toBe(0);
  });

  it("UNEQUAL key bucket is NOT blindly aligned — deferred (no tier-2.5 guess)", () => {
    const a = [
      mk({ order: 0, content: W + " one", structuralKey: "K", contentHash: "a1" }),
      mk({ order: 1, content: W + " two", structuralKey: "K", contentHash: "b1" }),
    ];
    const b = [mk({ order: 0, content: W + " one", structuralKey: "K", contentHash: "a1" })];
    const r = matchNodes(a, b);
    // the identical one pairs at tier 1; the other is NOT force-aligned
    expect(r.pairs.some((p: any) => p.tier === 2.5)).toBe(false);
  });
});

describe("tier 3 — fuzzy + contention", () => {
  it("renamed doc (key+hash changed) with similar body → fuzzy pair", () => {
    const a = [mk({ order: 0, content: W + " alpha", structuralKey: "OLD", contentHash: "h1" })];
    const b = [mk({ order: 0, content: W + " alpha beta", structuralKey: "NEW", contentHash: "h2" })];
    const r = matchNodes(a, b, { fuzzyHi: 0.5 });
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0].tier).toBe(3);
  });

  it("two olders competing for one newer → contention (ambiguous, not paired)", () => {
    const a = [
      mk({ order: 0, content: W + " alpha", structuralKey: "O1", contentHash: "h1" }),
      mk({ order: 1, content: W + " alpha", structuralKey: "O2", contentHash: "h2" }),
    ];
    const b = [mk({ order: 0, content: W + " alpha", structuralKey: "N1", contentHash: "h3" })];
    const r = matchNodes(a, b, { fuzzyHi: 0.5 });
    expect(r.ambiguous.some((x: any) => x.reason === "contention")).toBe(true);
  });

  it("a row with no counterpart is unmatched (death/birth)", () => {
    const a = [mk({ order: 0, content: "gone forever and ever", structuralKey: "G", contentHash: "h1" })];
    const b: N[] = [];
    const r = matchNodes(a, b);
    expect(r.olderUnmatched.length).toBe(1);
    expect(r.pairs.length).toBe(0);
  });
});

describe("tier 4 — containment (seedHop)", () => {
  it("a newer body contained in an older parent → split link, not a pairing", () => {
    const parent = mk({ order: 0, content: W + " plus child sentence here", structuralKey: "P", contentHash: "hp" });
    const child = mk({ order: 0, content: W, structuralKey: "C", contentHash: "hc" });
    const r = matchNodes([parent], [parent, child], { seedHop: true });
    expect(r.contained.length).toBe(1);
    expect(r.contained[0].newer).toBe(child);
  });
});
