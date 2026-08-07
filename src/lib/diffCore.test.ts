import { describe, it, expect } from "vitest";
import { lcsOps, mergeOps, wordDiff, charDiff, pairAdjacentLines, trimContext, capDiff, lineDiff } from "./diffCore";
import type { DiffLine } from "./history";

function rebuild(ops: [string, string][], keep: string[]): string {
  return ops.filter(([op]) => keep.includes(op)).map(([, tok]) => tok).join("");
}

describe("lcsOps", () => {
  it("marks every token '=' when both sides are identical", () => {
    const ops = lcsOps(["a", "b", "c"], ["a", "b", "c"]);
    expect(ops).toEqual([["=", "a"], ["=", "b"], ["=", "c"]]);
  });

  it("marks every token '+' when the old side is empty", () => {
    expect(lcsOps([], ["x", "y"])).toEqual([["+", "x"], ["+", "y"]]);
  });

  it("marks every token '-' when the new side is empty", () => {
    expect(lcsOps(["x", "y"], [])).toEqual([["-", "x"], ["-", "y"]]);
  });

  it("returns [] for two empty arrays", () => {
    expect(lcsOps([], [])).toEqual([]);
  });

  it("reconstructs both original sequences from the op stream (round-trip invariant)", () => {
    const a = ["the", " ", "cat", " ", "sat", " ", "here"];
    const b = ["the", " ", "dog", " ", "sat", " ", "there"];
    const ops = lcsOps(a, b);
    expect(rebuild(ops, ["=", "-"])).toBe(a.join(""));
    expect(rebuild(ops, ["=", "+"])).toBe(b.join(""));
  });

  it("finds the common subsequence across a reordering", () => {
    const ops = lcsOps(["a", "b", "c"], ["c", "a", "b"]);
    expect(rebuild(ops, ["=", "-"])).toBe("abc");
    expect(rebuild(ops, ["=", "+"])).toBe("cab");
    // "ab" is the longest common subsequence — must survive as "=".
    const equalTokens = ops.filter(([op]) => op === "=").map(([, t]) => t);
    expect(equalTokens).toEqual(["a", "b"]);
  });
});

describe("mergeOps", () => {
  it("merges consecutive same-op tokens into one segment", () => {
    const raw: [string, string][] = [
      ["=", "a"],
      ["=", "b"],
      ["+", "c"],
      ["+", "d"],
      ["-", "e"],
    ];
    expect(mergeOps(raw)).toEqual([
      ["=", "ab"],
      ["+", "cd"],
      ["-", "e"],
    ]);
  });

  it("returns [] for an empty input", () => {
    expect(mergeOps([])).toEqual([]);
  });

  it("keeps adjacent segments of different ops separate", () => {
    expect(
      mergeOps([
        ["=", "a"],
        ["-", "b"],
        ["=", "c"],
      ]),
    ).toEqual([
      ["=", "a"],
      ["-", "b"],
      ["=", "c"],
    ]);
  });
});

describe("wordDiff", () => {
  it("tokenizes on words/whitespace/punctuation and diffs at the word level", () => {
    const segs = wordDiff("the cat sat", "the dog sat");
    expect(rebuild(segs as [string, string][], ["=", "-"])).toBe("the cat sat");
    expect(rebuild(segs as [string, string][], ["=", "+"])).toBe("the dog sat");
    expect(segs.some(([op, t]) => op === "-" && t === "cat")).toBe(true);
    expect(segs.some(([op, t]) => op === "+" && t === "dog")).toBe(true);
  });

  it("treats punctuation as its own token", () => {
    const segs = wordDiff("Hello, world.", "Hello world.");
    // the comma is dropped — expect a standalone '-' segment for it.
    expect(segs.some(([op, t]) => op === "-" && t === ",")).toBe(true);
  });

  it("returns a single '=' segment for identical lines", () => {
    expect(wordDiff("same line", "same line")).toEqual([["=", "same line"]]);
  });

  it("treats a missing line ('') as an empty token stream", () => {
    const segs = wordDiff("", "new text");
    expect(segs).toEqual([["+", "new text"]]);
  });
});

describe("charDiff", () => {
  it("diffs two short identifiers character by character", () => {
    const segs = charDiff("abc123", "abd123");
    expect(rebuild(segs as [string, string][], ["=", "-"])).toBe("abc123");
    expect(rebuild(segs as [string, string][], ["=", "+"])).toBe("abd123");
    expect(segs.some(([op, t]) => op === "-" && t === "c")).toBe(true);
    expect(segs.some(([op, t]) => op === "+" && t === "d")).toBe(true);
  });

  it("returns a single '=' segment for identical strings", () => {
    expect(charDiff("xyz", "xyz")).toEqual([["=", "xyz"]]);
  });
});

describe("pairAdjacentLines", () => {
  it("passes '=' lines through unchanged", () => {
    const ops: [string, string][] = [["=", "unchanged"]];
    expect(pairAdjacentLines(ops)).toEqual([["=", "unchanged"]]);
  });

  it("pairs a 1:1 removal/addition run with shared content into a '~' word diff", () => {
    const ops: [string, string][] = [
      ["-", "the cat sat"],
      ["+", "the dog sat"],
    ];
    const result = pairAdjacentLines(ops);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
  });

  it("keeps a removal/addition pair with zero shared tokens as separate '-'/'+' lines", () => {
    // Single-word lines so there's no shared whitespace token either — a
    // multi-word line would share its inter-word spaces as '=' tokens.
    const ops: [string, string][] = [
      ["-", "Alpha"],
      ["+", "Zulu"],
    ];
    expect(pairAdjacentLines(ops)).toEqual([
      ["-", "Alpha"],
      ["+", "Zulu"],
    ]);
  });

  it("pairs the first min(removals, additions) lines and leaves the remainder unpaired", () => {
    const ops: [string, string][] = [
      ["-", "line one old"],
      ["-", "extra removed line"],
      ["+", "line one new"],
    ];
    const result = pairAdjacentLines(ops);
    // 1 removal pairs with the 1 addition; the 2nd removal has no partner.
    expect(result.some(([op]) => op === "~")).toBe(true);
    expect(result.some(([op, t]) => op === "-" && t === "extra removed line")).toBe(true);
  });

  it("breaks a run at an interleaving '=' context line", () => {
    const ops: [string, string][] = [
      ["-", "old text"],
      ["=", "context"],
      ["+", "new text"],
    ];
    const result = pairAdjacentLines(ops);
    // No shared removal/addition run spans the context line — both stay bare.
    expect(result).toEqual([
      ["-", "old text"],
      ["=", "context"],
      ["+", "new text"],
    ]);
  });
});

describe("trimContext", () => {
  it("returns [] when there are no changes at all", () => {
    const ops: DiffLine[] = [["=", "a"], ["=", "b"], ["=", "c"]];
    expect(trimContext(ops)).toEqual([]);
  });

  it("keeps a change with its ± context neighbours, no leading/trailing gap markers", () => {
    const ops: DiffLine[] = [["=", "a"], ["=", "b"], ["+", "c"], ["=", "d"], ["=", "e"]];
    // context=2 covers the whole array here, so nothing is trimmed.
    expect(trimContext(ops, 2)).toEqual(ops);
  });

  it("inserts a '…' gap between two changes separated by more than 2x context", () => {
    const ops: DiffLine[] = [
      ["+", "change one"],
      ["=", "u1"],
      ["=", "u2"],
      ["=", "u3"],
      ["=", "u4"],
      ["=", "u5"],
      ["+", "change two"],
    ];
    const result = trimContext(ops, 1);
    expect(result).toEqual([
      ["+", "change one"],
      ["=", "u1"],
      ["…"],
      ["=", "u5"],
      ["+", "change two"],
    ]);
  });

  it("trims unchanged lines beyond the context window at the edges", () => {
    const ops: DiffLine[] = [["=", "far"], ["=", "near"], ["+", "changed"], ["=", "near2"], ["=", "far2"]];
    expect(trimContext(ops, 1)).toEqual([["=", "near"], ["+", "changed"], ["=", "near2"]]);
  });
});

describe("capDiff", () => {
  it("returns lines unchanged when at or under the cap", () => {
    const lines: DiffLine[] = [["=", "a"], ["=", "b"]];
    expect(capDiff(lines, 5)).toEqual(lines);
    expect(capDiff(lines, 2)).toEqual(lines);
  });

  it("truncates and appends a trailing '…' when over the cap", () => {
    const lines: DiffLine[] = [["=", "a"], ["=", "b"], ["=", "c"]];
    expect(capDiff(lines, 2)).toEqual([["=", "a"], ["=", "b"], ["…"]]);
  });

  it("defaults the cap to 20", () => {
    const lines: DiffLine[] = Array.from({ length: 25 }, (_, i) => ["=", `l${i}`] as DiffLine);
    const result = capDiff(lines);
    expect(result).toHaveLength(21);
    expect(result[20]).toEqual(["…"]);
  });
});

describe("lineDiff", () => {
  it("diffs two multi-line texts, pairing a changed line into '~'", () => {
    const prev = "line one\nline two\nline three";
    const curr = "line one\nline TWO\nline three";
    const result = lineDiff(prev, curr);
    expect(result.some((l) => l[0] === "~")).toBe(true);
    expect(result.some((l) => l[0] === "=" && l[1] === "line one")).toBe(true);
  });

  it("treats missing text ('') as a single empty line, diffed against the new content", () => {
    const result = lineDiff("", "new");
    expect(result).toEqual([["-", ""], ["+", "new"]]);
  });

  it("is stable (produces no diff) for identical texts, but returns [] since there are no changes", () => {
    expect(lineDiff("same\ntext", "same\ntext")).toEqual([]);
  });

  it("does not cap long diffs — that's the caller's job (capDiff)", () => {
    const prev = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    const curr = Array.from({ length: 30 }, (_, i) => (i === 0 ? "CHANGED" : `l${i}`)).join("\n");
    const result = lineDiff(prev, curr);
    expect(result.some((l) => l[0] === "…")).toBe(false);
  });
});
