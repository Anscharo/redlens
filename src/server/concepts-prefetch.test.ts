// concepts-prefetch.ts's similarity lane (routeCensuses): load-bearing cases
// pinned from the `pnpm eval:census` bakeoff (202 labeled questions, plus a
// real-traffic check against DATABASE_URL) — the ones that decide whether the
// lane is safe to have on. See config.ts's chatCensusSimilarityMargin comment
// for why the shipped margin (0.4) sits well above what the labeled corpus
// alone would have picked: a lower margin fired on 12 of 67 distinct real
// chat messages, none of them census-shaped.
import { describe, it, expect } from "bun:test";
import { routeCensuses, matchConceptCensuses } from "./concepts-prefetch.ts";
import { JEV_CENSUS_THRESHOLD } from "./chat/prefetch-judge.ts";
import { CENSUS_SLUGS, type CensusSlug } from "../lib/conceptsCensus.ts";

describe("routeCensuses — similarity lane", () => {
  it("recovers paraphrases the regex has no words for", () => {
    for (const [q, slug] of [
      ["what is banned?", "prohibition-language"],
      ["where does the atlas do math?", "formula-docs"],
      ["which lists in the atlas are still empty?", "registry-liveness"],
    ] as const) {
      expect(matchConceptCensuses(q)).not.toContain(slug); // regex genuinely misses these
      expect(routeCensuses(q)).toContain(slug);
    }
  });

  it("never fires on a specific document lookup wearing census vocabulary", () => {
    // The sharpest adversarial case: literally starts with "List Of", the
    // registry-liveness census's own title prefix — the exact phrasing
    // pinned as a regression case in facts/registry.test.ts.
    expect(routeCensuses("list of prime agents")).toEqual([]);
  });

  it("never fires on ordinary atlas questions or small talk", () => {
    for (const q of ["what is universal alignment?", "who is keel?", "hi", "thanks, that helped", "good morning"]) {
      expect(routeCensuses(q)).toEqual([]);
    }
  });

  it("stays off on open-ended chat questions the synthetic negative pool never produced", () => {
    // The real-traffic false fires that set the shipped margin (config.ts).
    // Pinned so a future ternlight bump can't silently reopen them.
    for (const q of [
      "Trace the governance path for an Atlas amendment.",
      "Who are all of the individuals noted by the Atlas?",
      "list every evm address that is mentioned in the atlas",
    ]) {
      expect(routeCensuses(q)).toEqual([]);
    }
  });

  it("respects an explicit margin override, which is how the eval sweeps thresholds against this exact function", () => {
    expect(routeCensuses("what is banned?", 0.6)).toEqual([]);
    expect(routeCensuses("what is banned?", 0.1)).toContain("prohibition-language");
  });

  it("caps combined regex+similarity routing at 3 slugs", () => {
    const fired = routeCensuses("do registries, document types, duplicated titles, formulas or prohibitions overlap?");
    expect(fired.length).toBeLessThanOrEqual(3);
  });
});

// jevCensus (chat/prefetch-judge.ts's pre-first-token judgement, threaded
// through facts/types.ts) REPLACES this lane rather than adding to it — see
// routeCensuses's own comment for the 2026-09-22 measurement. Every case here
// passes a `jevCensus` object, which is what turns the replacement on.
describe("routeCensuses — jevCensus replaces the similarity lane", () => {
  const zeros = (): Record<CensusSlug, number> =>
    Object.fromEntries(CENSUS_SLUGS.map((s) => [s, 0])) as Record<CensusSlug, number>;

  it("a question the similarity lane fires on stays unrouted when jevCensus scores it zero", () => {
    // Regression-pinned above (matchConceptCensuses genuinely misses these,
    // routeCensuses() with no jevCensus routes them via similarity).
    const q = "which lists in the atlas are still empty?";
    expect(routeCensuses(q)).toContain("registry-liveness"); // similarity lane, unchanged
    expect(routeCensuses(q, undefined, zeros())).toEqual([]); // jev present and says no — similarity never consulted
  });

  it("regex still fires even when jevCensus is present and says no to everything", () => {
    // "what is banned?" doesn't match the regex (that's `matchConceptCensuses`'s
    // job below), so use a phrase from SIGNATURES instead: "registry".
    expect(matchConceptCensuses("what about the registries?")).toEqual(["registry-liveness"]);
    expect(routeCensuses("what about the registries?", undefined, zeros())).toEqual(["registry-liveness"]);
  });

  it("a jevCensus slug at or above JEV_CENSUS_THRESHOLD is routed even with no regex match", () => {
    const jev = { ...zeros(), "formula-docs": JEV_CENSUS_THRESHOLD };
    expect(routeCensuses("does the atlas do any math anywhere?", undefined, jev)).toEqual(["formula-docs"]);
  });

  it("a slug just below the threshold is not routed", () => {
    const jev = { ...zeros(), "formula-docs": JEV_CENSUS_THRESHOLD - 0.01 };
    expect(routeCensuses("does the atlas do any math anywhere?", undefined, jev)).toEqual([]);
  });

  it("caps at MAX_CENSUSES, taking the top-scoring slugs first", () => {
    const jev = {
      ...zeros(),
      "formula-docs": 0.61,
      "prohibition-language": 0.95,
      "empty-scaffolding": 0.7,
      "title-templates": 0.65,
    };
    const fired = routeCensuses("q", undefined, jev);
    expect(fired).toHaveLength(3);
    expect(fired).toEqual(["prohibition-language", "empty-scaffolding", "title-templates"]);
  });

  it("unions with regex rather than replacing it, still capped at 3", () => {
    // "registries" is a regex hit; two more clear the jev threshold.
    const jev = { ...zeros(), "formula-docs": 0.9, "prohibition-language": 0.9 };
    const fired = routeCensuses("what about the registries?", undefined, jev);
    expect(fired).toContain("registry-liveness");
    expect(fired).toContain("formula-docs");
    expect(fired).toContain("prohibition-language");
    expect(fired).toHaveLength(3);
  });
});
