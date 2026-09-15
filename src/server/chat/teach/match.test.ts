import { describe, expect, it, test } from "bun:test";
import { rankTeachings, selectTeachings, TEACH_SMALL_NOTEBOOK, tokensOf, type RankedTeaching } from "./match.ts";
import type { TeachingRow } from "./store.ts";

const row = (id: string, subject: string, content: string): TeachingRow => ({ id, subject, content });

describe("tokensOf", () => {
  it("drops stopwords and short tokens", () => {
    const t = tokensOf("What is the Spark freeze document about?");
    expect(t.has("spark")).toBe(true);
    expect(t.has("freeze")).toBe(true);
    expect(t.has("the")).toBe(false);
    expect(t.has("what")).toBe(false);
  });
});

describe("rankTeachings / selectTeachings", () => {
  it("ranks a lexical hit above an unrelated note", () => {
    const ranked = rankTeachings("where is the spark freeze documented?", [
      row("a", "Spark freeze", "Spark freeze lives under the Spark artifact"),
      row("b", "Unrelated", "Operational Facilitators sign the weekly report"),
    ]);
    expect(ranked[0]!.id).toBe("a");
    expect(ranked[0]!.lex).toBeGreaterThan(ranked[1]!.lex);
  });

  it("injects a small notebook in full even when scores are low", () => {
    const ranked = rankTeachings("hello there", [
      row("a", "Note one", "Alpha beta gamma"),
      row("b", "Note two", "Delta epsilon zeta"),
    ]);
    expect(ranked.length).toBeLessThanOrEqual(TEACH_SMALL_NOTEBOOK);
    expect(selectTeachings(ranked).map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("filters a large notebook to matching rows", () => {
    const rows: TeachingRow[] = [
      row("hit", "Spark freeze", "Spark freeze lives under the Spark artifact"),
      ...Array.from({ length: 8 }, (_, i) => row(`n${i}`, `Other ${i}`, `Unrelated filler note number ${i} about rewards`)),
    ];
    const picked = selectTeachings(rankTeachings("tell me about the spark freeze", rows));
    expect(picked.some((r) => r.id === "hit")).toBe(true);
    expect(picked.length).toBeLessThanOrEqual(5);
  });

  it("dedupes the same id coming from two lanes", () => {
    const r = row("a", "Spark freeze", "Spark freeze lives under Spark");
    const ranked = rankTeachings("spark freeze", [r, r]);
    expect(ranked).toHaveLength(1);
  });
});

test("RankedTeaching shape is a TeachingRow plus scores", () => {
  const ranked: RankedTeaching[] = rankTeachings("spark", [row("a", "Spark", "Spark is a prime agent extra")]);
  expect(ranked[0]).toHaveProperty("lex");
  expect(ranked[0]).toHaveProperty("score");
});
