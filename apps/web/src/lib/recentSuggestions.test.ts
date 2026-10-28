import { describe, it, expect } from "vitest";
import { MAX_SUGGESTIONS, matchingRecents } from "./recentSuggestions";

const R = (...qs: string[]) => qs.map((q) => ({ q, n: 1 }));
const qs = (rows: { q: string }[]) => rows.map((r) => r.q);

describe("matchingRecents", () => {
  it("offers every recent, up to the cap, for an empty field or a bare quote pair", () => {
    const many = R("a", "b", "c", "d", "e", "f", "g");
    for (const q of ["", "  ", '""', "''"]) expect(matchingRecents(many, q)).toHaveLength(MAX_SUGGESTIONS);
  });

  it("narrows to recents the typed text is a prefix of, ignoring case", () => {
    expect(qs(matchingRecents(R("vat", "Value", "jug"), "VA"))).toEqual(["vat", "Value"]);
  });

  it("never offers the typed search itself", () => {
    expect(qs(matchingRecents(R("vat", "vatican"), "VAT"))).toEqual(["vatican"]);
  });
});
