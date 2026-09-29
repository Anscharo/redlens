import { describe, expect, it } from "vitest";
import {
  RRF_K,
  anchorCouldServeScope,
  inScope,
  SEARCH_LANES,
  isSearchLane,
  rrfFuse,
  semanticQueryOf,
  semanticWorthAsking,
  trailingWord,
  MAX_SEMANTIC_QUERY,
} from "./searchSemantic";

describe("lane guard", () => {
  it("accepts exactly the declared lanes", () => {
    for (const l of SEARCH_LANES) expect(isSearchLane(l)).toBe(true);
    // A hand-edited URL must not reach the client as a lane its own enum does
    // not know. "fallback"/"woven" were blend strategies, never lanes, and are
    // both retired — a stale link carrying one must not resurrect anything.
    for (const bad of ["hybrid", "fallback", "woven", "", "LEXICAL", null, undefined, 1, {}]) {
      expect(isSearchLane(bad)).toBe(false);
    }
  });
});

describe("semanticQueryOf — in: scoping", () => {
  it("splits the scope out of the embedded text", () => {
    expect(semanticQueryOf("who approves rewards in:A.6")).toEqual({
      query: "who approves rewards",
      scope: "A.6",
    });
  });

  it("takes the scope however it is capitalised", () => {
    // The lexical leg parses `in:` with a /gi regex. When only this side was
    // case-sensitive, `In:A.6` read as unknown structured syntax and stood the
    // entire meaning lane down instead of scoping it.
    for (const q of ["rewards In:A.6", "rewards IN:a.6", "rewards in:A.6"]) {
      expect(semanticQueryOf(q)).toEqual({ query: "rewards", scope: "A.6" });
    }
  });

  it("still stands down on the filters only the lexical leg enforces", () => {
    expect(semanticQueryOf("type:Core rewards")).toBeNull();
    expect(semanticQueryOf("rewards -fees")).toBeNull();
    expect(semanticQueryOf("rewards~2")).toBeNull();
  });
});

describe("rrfFuse", () => {
  it("scores by 1/(K + rank + 1) and sums across lists", () => {
    const fused = rrfFuse([["a", "b"], ["b", "c"]]);
    expect(fused.get("a")).toBeCloseTo(1 / (RRF_K + 1), 12);
    expect(fused.get("b")).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1), 12);
    expect(fused.get("c")).toBeCloseTo(1 / (RRF_K + 2), 12);
    // Found by both legs ⇒ outranks either leg's own top hit.
    expect(fused.get("b")!).toBeGreaterThan(fused.get("a")!);
  });

  it("counts a repeated id within one list once per position", () => {
    // Two grouped anchors can be attributed onto the same leaf, so a list CAN
    // legitimately carry a duplicate; each rank contributes.
    expect(rrfFuse([["a", "a"]]).get("a")).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2), 12);
  });

  it("handles empty input", () => {
    expect(rrfFuse([]).size).toBe(0);
    expect(rrfFuse([[], []]).size).toBe(0);
  });
});

describe("semanticWorthAsking", () => {
  it("rejects prefixes too short to carry meaning, and over-long input", () => {
    expect(semanticWorthAsking("a")).toBe(false);
    expect(semanticWorthAsking("ac")).toBe(false);
    expect(semanticWorthAsking("acc")).toBe(true);
    expect(semanticWorthAsking("  acc  ")).toBe(true);
    expect(semanticWorthAsking("x".repeat(MAX_SEMANTIC_QUERY))).toBe(true);
    expect(semanticWorthAsking("x".repeat(MAX_SEMANTIC_QUERY + 1))).toBe(false);
  });
});

describe("semanticQueryOf", () => {
  it("passes plain prose through, with no scope", () => {
    expect(semanticQueryOf("who signs off on a rewards change")).toEqual({
      query: "who signs off on a rewards change",
    });
  });

  it("drops quote markers but keeps the words", () => {
    expect(semanticQueryOf('"threshold requirements"')).toEqual({ query: "threshold requirements" });
    expect(semanticQueryOf("'Delegated Signers'")).toEqual({ query: "Delegated Signers" });
  });

  it("stands down on structured syntax the lexical leg alone enforces", () => {
    // Every one of these would otherwise come back UNFILTERED from the semantic
    // leg — a `type:Core` search answered partly with documents that aren't Core.
    expect(semanticQueryOf("type:Core rewards")).toBeNull();
    expect(semanticQueryOf("title:Facilitator")).toBeNull();
    expect(semanticQueryOf("governance -rewards")).toBeNull();
    expect(semanticQueryOf("misaligment~1")).toBeNull();
  });

  it("stands down on a query too short to score", () => {
    expect(semanticQueryOf("ab")).toBeNull();
    expect(semanticQueryOf('""')).toBeNull();
  });

  it("truncates rather than sending an unbounded string", () => {
    expect(semanticQueryOf("word ".repeat(200))!.query.length).toBeLessThanOrEqual(MAX_SEMANTIC_QUERY);
  });

  it("splits an in: subtree out of the text instead of embedding it", () => {
    // Left in, the model would be scoring documents against the literal
    // string "in:A.6.1" — which is not what the reader asked about.
    expect(semanticQueryOf("in:A.6.1 who approves rewards")).toEqual({
      query: "who approves rewards",
      scope: "A.6.1",
    });
    expect(semanticQueryOf("who approves rewards in:a.6.1")).toEqual({
      query: "who approves rewards",
      scope: "A.6.1",
    });
  });

  it("still stands down when in: is combined with syntax only the lexical leg enforces", () => {
    expect(semanticQueryOf("in:A.6 type:Core rewards")).toBeNull();
    expect(semanticQueryOf("in:A.6 rewards -bridge")).toBeNull();
  });

  it("stands down on a scope with nothing left to score", () => {
    expect(semanticQueryOf("in:A.6.1")).toBeNull();
  });

  it("does not mistake a word merely ending in 'in' for the in: filter", () => {
    expect(semanticQueryOf("min:5 rewards")).toBeNull();
  });

  it("does not mistake a bare colon or hyphen for field syntax", () => {
    // A trailing colon and a mid-word hyphen are ordinary prose, not filters.
    expect(semanticQueryOf("what about this: governance")).toEqual({ query: "what about this: governance" });
    expect(semanticQueryOf("sub-proxy spell")).toEqual({ query: "sub-proxy spell" });
  });
});

describe("inScope", () => {
  it("includes the document itself and everything under it", () => {
    expect(inScope("A.2", "A.2")).toBe(true);
    expect(inScope("A.2.1.4", "A.2")).toBe(true);
    expect(inScope("a.2.1.4", "A.2")).toBe(true); // case-insensitive, like the lexical leg
  });

  it("compares on the dotted segment, so A.2 does not swallow A.22", () => {
    expect(inScope("A.22", "A.2")).toBe(false);
    expect(inScope("A.22.1", "A.2")).toBe(false);
    expect(inScope("B.2.1", "A.2")).toBe(false);
  });

  it("a parent is not inside its child", () => {
    expect(inScope("A.2", "A.2.1")).toBe(false);
  });
});

describe("anchorCouldServeScope", () => {
  it("keeps anchors ABOVE the scope — they hold the leaves inside it", () => {
    // Grouped anchors are ancestors of their members, so an anchor at A.6.1.1
    // can carry a leaf at A.6.1.1.3.7. Filtering anchors to the scope alone
    // would drop exactly the rows the scope was asking for.
    expect(anchorCouldServeScope("A.6.1.1", "A.6.1.1.3.7")).toBe(true);
    expect(anchorCouldServeScope("A.6.1.1.3.7.2", "A.6.1.1.3.7")).toBe(true);
    expect(anchorCouldServeScope("A.6.1.1.3.7", "A.6.1.1.3.7")).toBe(true);
  });

  it("drops anchors on another branch entirely", () => {
    expect(anchorCouldServeScope("A.2.1", "A.6.1.1")).toBe(false);
    expect(anchorCouldServeScope("A.62", "A.6.1")).toBe(false);
  });
});

describe("trailingWord", () => {
  it("returns the word still being typed", () => {
    expect(trailingWord("collater")).toBe("collater");
    expect(trailingWord("who approves collater")).toBe("collater");
  });

  it("a trailing space or punctuation commits the word", () => {
    // You do not type a space into the middle of a word, so there is nothing
    // left to wait for.
    expect(trailingWord("collateral ")).toBe(null);
    expect(trailingWord("rewards, ")).toBe(null);
    expect(trailingWord("who approves rewards?")).toBe(null);
  });

  it("strips the operators a word can be wearing", () => {
    expect(trailingWord("-fees")).toBe("fees");
    expect(trailingWord("title:facilitator")).toBe("facilitator");
    expect(trailingWord("facilitator~2")).toBe("facilitator");
  });

  it("is not fooled by things that are not words in progress", () => {
    expect(trailingWord("")).toBe(null);
    expect(trailingWord("in:A.6")).toBe(null); // a subtree filter
    expect(trailingWord("A.2.7.1")).toBe(null); // an identifier
    expect(trailingWord("2026")).toBe(null); // a figure
  });
});
