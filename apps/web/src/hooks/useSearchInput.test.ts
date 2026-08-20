import { describe, it, expect } from "vitest";
import { applyMode, isMixedQuotes } from "./useSearchInput";

// ---------------------------------------------------------------------------
// applyMode — broad mode is always a no-op
// ---------------------------------------------------------------------------

describe("applyMode: broad", () => {
  it("returns plain text unchanged", () => {
    expect(applyMode("governance", "broad")).toBe("governance");
  });
  it("returns field filters unchanged", () => {
    expect(applyMode("type:Core delegate", "broad")).toBe("type:Core delegate");
  });
  it("returns a query with double quotes unchanged", () => {
    expect(applyMode('"foo"', "broad")).toBe('"foo"');
  });
});

// ---------------------------------------------------------------------------
// applyMode — phrase wraps bare terms in double quotes
// ---------------------------------------------------------------------------

describe("applyMode: phrase", () => {
  it("wraps a single bare term", () => {
    expect(applyMode("governance", "phrase")).toBe('"governance"');
  });

  it("wraps multiple bare terms as one phrase", () => {
    expect(applyMode("properly implemented", "phrase")).toBe('"properly implemented"');
  });

  it("in: filter passes through; bare term is wrapped", () => {
    expect(applyMode("in:A.1.2 delegate", "phrase")).toBe('in:A.1.2 "delegate"');
  });

  it("type: filter passes through; bare term is wrapped", () => {
    expect(applyMode("type:Core delegate", "phrase")).toBe('type:Core "delegate"');
  });

  it("exclusion token passes through; bare term is wrapped", () => {
    expect(applyMode("-slippery alignment", "phrase")).toBe('-slippery "alignment"');
  });

  it("query with only field tokens returns unchanged", () => {
    expect(applyMode("type:Core", "phrase")).toBe("type:Core");
  });

  it("quoted multi-word field value is preserved; free text is wrapped", () => {
    expect(applyMode('type:"Type Specification" content', "phrase")).toBe(
      'type:"Type Specification" "content"',
    );
  });

  it("bypasses when query already contains double quotes", () => {
    expect(applyMode('"foo bar"', "phrase")).toBe('"foo bar"');
  });

  it("bypasses when query already contains single quotes", () => {
    expect(applyMode("'foo'", "phrase")).toBe("'foo'");
  });

  it("bypasses when query contains a fuzzy suffix", () => {
    expect(applyMode("foo~2", "phrase")).toBe("foo~2");
  });
});

// ---------------------------------------------------------------------------
// applyMode — strict wraps bare terms in single quotes
// ---------------------------------------------------------------------------

describe("applyMode: strict", () => {
  it("wraps a single bare term", () => {
    expect(applyMode("delegatedSigners", "strict")).toBe("'delegatedSigners'");
  });

  it("wraps multiple bare terms as one phrase", () => {
    expect(applyMode("Delegated Signers", "strict")).toBe("'Delegated Signers'");
  });

  it("type: filter passes through; bare term uses single quotes", () => {
    expect(applyMode("type:Core delegate", "strict")).toBe("type:Core 'delegate'");
  });

  it("bypasses when query already contains single quotes", () => {
    expect(applyMode("'existing'", "strict")).toBe("'existing'");
  });

  it("bypasses when query contains a fuzzy suffix", () => {
    expect(applyMode("foo~1", "strict")).toBe("foo~1");
  });
});

// ---------------------------------------------------------------------------
// isMixedQuotes — detects partial/hand-typed quote mixing
// ---------------------------------------------------------------------------

describe("isMixedQuotes", () => {
  it("returns false for plain text (no quotes)", () => {
    expect(isMixedQuotes("governance")).toBe(false);
  });

  it("returns false for a cleanly double-quoted phrase", () => {
    expect(isMixedQuotes('"properly implemented"')).toBe(false);
  });

  it("returns false for a cleanly single-quoted phrase", () => {
    expect(isMixedQuotes("'delegatedSigners'")).toBe(false);
  });

  it("returns false for field filter + clean quote wrap", () => {
    expect(isMixedQuotes('type:Core "foo bar"')).toBe(false);
  });

  it("returns true when some free terms are quoted and some are not", () => {
    expect(isMixedQuotes('"foo" bar')).toBe(true);
  });

  it("returns true when bare term precedes a quoted term", () => {
    expect(isMixedQuotes('foo "bar"')).toBe(true);
  });

  it("returns true for scope filter + mixed free text", () => {
    expect(isMixedQuotes('in:A.1.2 "foo" bar')).toBe(true);
  });
});
