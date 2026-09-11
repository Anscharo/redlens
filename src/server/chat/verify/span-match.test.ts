// Span-matching primitives: locality (not just vocabulary), fuzzy tolerance,
// link-markup stripping, and locateSpan's entry-index bookkeeping.
import { test, expect } from "bun:test";
import { locateSpan, spanOverlap, stripLinkMarkup, tokenize, SPAN_MATCH_THRESHOLD } from "./span-match.ts";
import type { EvidenceEntry } from "./verifier.ts";

const entry = (content: string, label = "[E1]"): EvidenceEntry => ({ label, tool: "atlas_get", args: "{}", content });

test("spanOverlap requires LOCALITY, not just vocabulary", () => {
  const hay = "the alpha document is here. many unrelated words fill the gap. the beta document is there.";
  expect(spanOverlap("the alpha document is here", hay)).toBe(1);
  expect(spanOverlap("the alpha document is there", hay)).toBeLessThan(1);
  // every word exists in the haystack, but never together:
  expect(spanOverlap("alpha beta document", hay)).toBeLessThan(0.8);
  expect(spanOverlap("", hay)).toBe(0);
});

test("spanOverlap forgives imperfect copying", () => {
  const hay = "contains all data and specifications for Spark's Instances of the Pioneer Chain Primitive.";
  const sloppy = spanOverlap("contains all data and specification for Spark Instances of the Pioneer Chain Primitive", hay);
  expect(sloppy).toBeGreaterThanOrEqual(0.8);
});

// tokenize itself is case-SENSITIVE (its regex only matches [a-z0-9]) — every
// caller feeds it already-lowercased text via normalizeForMatch, so this
// fixture is lowercase too, matching real usage.
test("tokenize drops punctuation, keeps figures whole, naive-folds plurals", () => {
  expect(tokenize("spark's instances, 0.2%!")).toEqual(["spark", "s", "instance", "0.2%"]);
});

test("stripLinkMarkup collapses inline links to their text and drops reference definition lines", () => {
  expect(stripLinkMarkup("See [the doc](/atlas/abc-123) for details.")).toBe("See the doc for details.");
  expect(stripLinkMarkup(["[label]: /atlas/abc-123", "", "The rule is [5%][label]."].join("\n")))
    .toBe("\nThe rule is [5%][label].");
});

test("locateSpan: exact containment wins over fuzzy overlap, and reports the matching entry index", () => {
  const evidence = [entry("nothing relevant here"), entry("The minimum capital ratio is 8.75% under the risk framework.")];
  const { best, entryIndex } = locateSpan("capital ratio is 8.75%", evidence);
  expect(best).toBe(1);
  expect(entryIndex).toBe(1);
});

test("locateSpan: best sliding-window overlap across entries when nothing is exact", () => {
  const evidence = [
    entry("the alpha document is here. many unrelated words fill the gap. the beta document is there."),
    entry("completely unrelated content"),
  ];
  const { best, entryIndex } = locateSpan("the alpha document is there", evidence);
  expect(best).toBeGreaterThan(0);
  expect(best).toBeLessThan(1);
  expect(entryIndex).toBe(0);
});

test("locateSpan: an empty or whitespace span never counts as a match, even against empty-string evidence", () => {
  const evidence = [entry(""), entry("some real content")];
  expect(locateSpan("", evidence)).toEqual({ best: 0, entryIndex: -1 });
  expect(locateSpan("   ", evidence)).toEqual({ best: 0, entryIndex: -1 });
});

test("locateSpan: nothing found → entryIndex -1, best 0", () => {
  const evidence = [entry("completely unrelated content")];
  expect(locateSpan("Spark has an active Pioneer Chain instance", evidence)).toEqual({ best: 0, entryIndex: -1 });
});

test("SPAN_MATCH_THRESHOLD is the shared 0.8 bar", () => {
  expect(SPAN_MATCH_THRESHOLD).toBe(0.8);
});
