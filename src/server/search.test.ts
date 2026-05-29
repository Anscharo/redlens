// Pure tool-layer unit tests. Run under `bun test` (NOT vitest) — these modules
// import Bun's `SQL`, which doesn't exist in node-vitest. vitest.config.ts
// excludes src/server for that reason.
import { test, expect } from "bun:test";
import { rrfMerge, matchesPhrases, type Hit } from "./search.ts";

test("rrfMerge fuses ranks, dedups by id, and records both sources", () => {
  const lex: Hit[] = [
    { id: "a", rank: 0, score: 9, source: "lexical" },
    { id: "b", rank: 1, score: 8, source: "lexical" },
  ];
  const sem: Hit[] = [
    { id: "b", rank: 0, score: 0.9, source: "semantic" },
    { id: "c", rank: 1, score: 0.8, source: "semantic" },
  ];
  const merged = rrfMerge(lex, sem);

  // "b" is hit by both legs → highest fused score → ranked first, both sources.
  expect(merged[0].id).toBe("b");
  expect(merged[0].sources.sort()).toEqual(["lexical", "semantic"]);
  // dedup: a, b, c each once.
  expect(merged.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  // monotonic non-increasing fused score.
  for (let i = 1; i < merged.length; i++) {
    expect(merged[i - 1].rrf_score).toBeGreaterThanOrEqual(merged[i].rrf_score);
  }
});

test("matchesPhrases requires every case-insensitive AND case-sensitive phrase", () => {
  // case-insensitive phrase present (in title)
  expect(matchesPhrases("Sky Savings Rate", "the rate is set", ["savings rate"], [])).toBe(true);
  // case-insensitive phrase absent
  expect(matchesPhrases("Title", "content", ["missing phrase"], [])).toBe(false);
  // case-sensitive phrase: exact case present
  expect(matchesPhrases("USDS token", "x", [], ["USDS"])).toBe(true);
  // case-sensitive phrase: wrong case must NOT match
  expect(matchesPhrases("usds token", "x", [], ["USDS"])).toBe(false);
  // all-of semantics: one missing → false
  expect(matchesPhrases("USDS savings rate", "x", ["savings rate"], ["MISSING"])).toBe(false);
});
