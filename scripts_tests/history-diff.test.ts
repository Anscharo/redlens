// Changed-lines threading (history-diff.mjs). Pure: section-scoped LCS over content
// hashes → confident 1:1 edits (anchored), births, deaths, N:M ambiguous segments.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { diffThread, diffEditsMap, editConfidence, diffText } from "../scripts/htmlhist/history-diff.mjs";

let ord = 0;
const mk = (section: string, structuralKey: string, content: string, title = structuralKey) =>
  ({ section, structuralKey, content, title, contentHash: `h:${content}`, order: ord++ });

describe("diffThread", () => {
  it("pins identical stubs as anchors and threads the one that changed", () => {
    // three identical 'stub' rows + one target; only the target's content changes
    const a1 = mk("S", "STUB", "stub"), a2 = mk("S", "STUB", "stub");
    const t0 = mk("S", "TARGET", "v1"), a3 = mk("S", "STUB", "stub");
    const b1 = mk("S", "STUB", "stub"), b2 = mk("S", "STUB", "stub");
    const t1 = mk("S", "TARGET", "v2"), b3 = mk("S", "STUB", "stub");
    const r = diffThread([a1, a2, t0, a3], [b1, b2, t1, b3]);
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0].older).toBe(t0);
    expect(r.edits[0].newer).toBe(t1);
    expect(r.births).toHaveLength(0);
    expect(r.deaths).toHaveLength(0);
  });

  it("threads an edit whose structural key changed but content mostly survived", () => {
    const o = mk("S", "OLDKEY", "line1\nline2\nline3");
    const n = mk("S", "NEWKEY", "line1\nline2\nline3-edited");
    const r = diffThread([o], [n]);
    expect(r.edits.map((e: any) => [e.older, e.newer])).toEqual([[o, n]]);
  });

  it("does NOT fuse an unrelated delete+add (no shared content, different key)", () => {
    const o = mk("S", "AAA", "alpha");
    const n = mk("S", "BBB", "bravo");
    const r = diffThread([o], [n]);
    expect(r.edits).toHaveLength(0);
    expect(r.deaths).toEqual([o]);
    expect(r.births).toEqual([n]);
  });

  it("reports births and deaths outside a changed segment", () => {
    const keep = mk("S", "KEEP", "keep");
    const dead = mk("S", "DEAD", "dead");
    const keep2 = mk("S", "KEEP", "keep");
    const born = mk("S", "BORN", "born");
    const r = diffThread([keep, dead], [keep2, born]);
    // dead(-)/born(+) are adjacent & alone → gated to death+birth (no shared content)
    expect(r.deaths).toContain(dead);
    expect(r.births).toContain(born);
    expect(r.edits).toHaveLength(0);
  });

  it("flags an N:M changed segment as ambiguous (deferred, not guessed)", () => {
    const p = mk("S", "P", "p1"), q = mk("S", "Q", "q1");
    const p2 = mk("S", "P2", "p2"), q2 = mk("S", "Q2", "q2");
    const r = diffThread([p, q], [p2, q2]);
    expect(r.edits).toHaveLength(0);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].olders).toHaveLength(2);
    expect(r.ambiguous[0].newers).toHaveLength(2);
  });

  it("scopes by section — a change in one section never pairs across sections", () => {
    const o = mk("A", "K", "v1"), oB = mk("B", "K", "same");
    const n = mk("A", "K", "v2"), nB = mk("B", "K", "same");
    const r = diffThread([o, oB], [n, nB]);
    expect(r.edits.map((e: any) => e.older)).toEqual([o]); // only the A-section edit
  });
});

describe("diffEditsMap", () => {
  it("returns just the confident edits as older→newer", () => {
    const o = mk("S", "K", "x1"), n = mk("S", "K", "x2");
    const m = diffEditsMap([o], [n]);
    expect(m.get(o)).toBe(n);
    expect(m.size).toBe(1);
  });
});

describe("editConfidence", () => {
  it("is 1 when structural keys match", () => {
    expect(editConfidence(mk("S", "K", "a"), mk("S", "K", "b"))).toBe(1);
  });
  it("is the shared-line fraction when keys differ", () => {
    const c = editConfidence(mk("S", "X", "a\nb\nc\nd"), mk("S", "Y", "a\nb\nc\nZ"));
    expect(c).toBeCloseTo(3 / 4, 5);
  });
});

describe("diffText", () => {
  it("renders only the deleted/added lines", () => {
    const o = { content: "a\nb\nc" };
    const n = { content: "a\nB\nc" };
    expect(diffText(o, n)).toBe("- b\n+ B");
  });
});
