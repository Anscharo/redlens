// concepts-prefetch.ts's similarity lane (routeCensuses): load-bearing cases
// pinned from the `pnpm eval:census` bakeoff (202 labeled questions, plus a
// real-traffic check against DATABASE_URL) — the ones that decide whether the
// lane is safe to have on. See config.ts's chatCensusSimilarityMargin comment
// for why the shipped margin (0.4) sits well above what the labeled corpus
// alone would have picked: a lower margin fired on 12 of 67 distinct real
// chat messages, none of them census-shaped.
import { describe, it, expect } from "bun:test";
import { routeCensuses, matchConceptCensuses } from "./concepts-prefetch.ts";

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
    // pinned as a regression case in skills/registry.test.ts.
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
