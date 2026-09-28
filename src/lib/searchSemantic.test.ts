import { describe, expect, it } from "vitest";
import {
  RRF_K,
  SEARCH_LANES,
  SEMANTIC_STRATEGIES,
  isSearchLane,
  isSemanticStrategy,
  rrfFuse,
  semanticQueryOf,
  semanticWorthAsking,
  MAX_SEMANTIC_QUERY,
} from "./searchSemantic";

describe("strategy / lane guards", () => {
  it("accept exactly the declared members", () => {
    for (const s of SEMANTIC_STRATEGIES) expect(isSemanticStrategy(s)).toBe(true);
    for (const l of SEARCH_LANES) expect(isSearchLane(l)).toBe(true);
    // A bad env var or a hand-edited URL must not reach the client as a
    // strategy its own enum doesn't know.
    for (const bad of ["hybrid", "", "OFF", null, undefined, 1, {}]) {
      expect(isSemanticStrategy(bad)).toBe(false);
      expect(isSearchLane(bad)).toBe(false);
    }
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
  it("passes plain prose through", () => {
    expect(semanticQueryOf("who signs off on a rewards change")).toBe(
      "who signs off on a rewards change",
    );
  });

  it("drops quote markers but keeps the words", () => {
    expect(semanticQueryOf('"threshold requirements"')).toBe("threshold requirements");
    expect(semanticQueryOf("'Delegated Signers'")).toBe("Delegated Signers");
  });

  it("stands down on structured syntax the lexical leg alone enforces", () => {
    // Every one of these would otherwise come back UNFILTERED from the semantic
    // leg — a `type:Core` search answered partly with documents that aren't Core.
    expect(semanticQueryOf("type:Core rewards")).toBeNull();
    expect(semanticQueryOf("in:A.2 governance")).toBeNull();
    expect(semanticQueryOf("title:Facilitator")).toBeNull();
    expect(semanticQueryOf("governance -rewards")).toBeNull();
    expect(semanticQueryOf("misaligment~1")).toBeNull();
  });

  it("stands down on a query too short to score", () => {
    expect(semanticQueryOf("ab")).toBeNull();
    expect(semanticQueryOf('""')).toBeNull();
  });

  it("truncates rather than sending an unbounded string", () => {
    expect(semanticQueryOf("word ".repeat(200))!.length).toBeLessThanOrEqual(MAX_SEMANTIC_QUERY);
  });

  it("does not mistake a bare colon or hyphen for field syntax", () => {
    // A trailing colon and a mid-word hyphen are ordinary prose, not filters.
    expect(semanticQueryOf("what about this: governance")).toBe("what about this: governance");
    expect(semanticQueryOf("sub-proxy spell")).toBe("sub-proxy spell");
  });
});
