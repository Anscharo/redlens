import { describe, it, expect } from "vitest";
import { scopeOf, toggleScope, withoutScope } from "./searchScope";
import { applyMode, modePillClick } from "./searchMode";

describe("scopeOf", () => {
  it("reads the in: token wherever it sits", () => {
    expect(scopeOf("in:A.1.2")).toBe("A.1.2");
    expect(scopeOf("delegate in:A.1.2 rules")).toBe("A.1.2");
  });

  it("answers the last token, as the worker does", () => {
    expect(scopeOf("in:A.1 foo in:A.6")).toBe("A.6");
  });

  it("is null without a token, and does not match inside a word", () => {
    expect(scopeOf("delegate rules")).toBeNull();
    expect(scopeOf("login:x")).toBeNull();
  });
});

describe("withoutScope", () => {
  it("drops every token, closing up only the space each one leaves", () => {
    expect(withoutScope('in:A.1 "foo bar" in:A.6 baz')).toBe('"foo bar" baz');
    expect(withoutScope("fees in:A.1.2")).toBe("fees");
  });

  it("keeps the reader's own spacing, which a quoted phrase matches literally", () => {
    expect(withoutScope('"foo  bar" in:A.1.2')).toBe('"foo  bar"');
  });

  it("never takes a closing quote typed against the token", () => {
    expect(withoutScope('"fees in:A.1.2"')).toBe('"fees"');
    expect(scopeOf('"fees in:A.1.2"')).toBe("A.1.2");
  });
});

describe("toggleScope", () => {
  it("scopes an empty query", () => {
    expect(toggleScope("", "A.1.2")).toBe("in:A.1.2");
  });

  it("leaves a phrase's inner spacing alone", () => {
    expect(toggleScope('"foo  bar"', "A.1.2")).toBe('"foo  bar" in:A.1.2');
  });

  it("appends after the reader's own terms, quotes untouched", () => {
    expect(toggleScope("delegate rules", "A.1.2")).toBe("delegate rules in:A.1.2");
    expect(toggleScope('"delegate rules"', "A.1.2")).toBe('"delegate rules" in:A.1.2');
    expect(toggleScope("'Delegate'", "A.1.2")).toBe("'Delegate' in:A.1.2");
  });

  it("replaces a scope to another document rather than stacking a second", () => {
    expect(toggleScope("in:A.6 fees", "A.1.2")).toBe("fees in:A.1.2");
  });

  it("lifts the scope when the query is already scoped to that document", () => {
    expect(toggleScope("fees in:A.1.2", "A.1.2")).toBe("fees");
    expect(toggleScope("in:a.1.2", "A.1.2")).toBe("");
  });
});

// The mode pills already treat in: as a field token; these pin that the two
// buttons compose in either order.
describe("in: with the mode pills", () => {
  it("phrase and strict wrap the free text only, leaving in: outside the quotes", () => {
    const q = toggleScope("delegate rules", "A.1.2");
    expect(applyMode(q, "phrase")).toBe('in:A.1.2 "delegate rules"');
    expect(modePillClick(q, "broad", "strict").newQuery).toBe("in:A.1.2 'delegate rules'");
  });

  it("a scope added to a quoted query keeps the phrase intact", () => {
    const quoted = modePillClick("delegate rules", "broad", "phrase").newQuery;
    expect(toggleScope(quoted, "A.1.2")).toBe('"delegate rules" in:A.1.2');
  });

  it("unwrapping a scoped phrase keeps the scope", () => {
    expect(modePillClick('in:A.1.2 "delegate rules"', "phrase", "broad").newQuery).toBe("in:A.1.2 delegate rules");
  });
});
