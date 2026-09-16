import { describe, expect, it, test } from "bun:test";
import { rankTeachings, selectTeachings, teachingEmbedText, tokensOf, type RankedTeaching } from "./match.ts";
import { onDeviceCosine, onDeviceEmbed } from "../../facts/similarity.ts";
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

  // Regression: a ≤4-note notebook used to inject in full, so one MSC note rode
  // every turn — including "what jobs are there in sky" and "hello there".
  it("injects nothing from a small notebook when no note matches", () => {
    const ranked = rankTeachings("hello there", [
      row("a", "Note one", "Alpha beta gamma"),
      row("b", "Note two", "Delta epsilon zeta"),
    ]);
    expect(selectTeachings(ranked)).toEqual([]);
  });

  it("keeps a small-notebook note on a direct term match and drops its unrelated sibling", () => {
    const rows = [
      row("msc", "MSC abbreviation meaning", "when i say msc i mean monthly settlement reports"),
      row("other", "Note two", "Delta epsilon zeta"),
    ];
    expect(selectTeachings(rankTeachings("what is the month with highest msc flow", rows)).map((r) => r.id)).toEqual(["msc"]);
    expect(selectTeachings(rankTeachings("what jobs are there in sky", rows))).toEqual([]);
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

  // Review of #386: notes were re-embedded on every turn. The stored vector's
  // SQL cosine now arrives as ternlight_sim and is used as-is; the on-device
  // embed is only the fallback for a row that has none.
  it("uses the SQL-computed ternlight_sim when present instead of re-embedding", () => {
    const ranked = rankTeachings("where is the spark freeze documented?", [
      { ...row("a", "Spark freeze", "Spark freeze lives under the Spark artifact"), ternlight_sim: 0.91 },
      { ...row("b", "Spark freeze", "Spark freeze lives under the Spark artifact"), ternlight_sim: null },
    ]);
    const a = ranked.find((r) => r.id === "a")!;
    const b = ranked.find((r) => r.id === "b")!;
    expect(a.ternlight).toBe(0.91);
    if (!onDeviceEmbed("x")) return; // ternlight unavailable here — fallback can't run
    expect(b.ternlight).not.toBeNull(); // fallback computed it
    expect(b.ternlight).not.toBe(0.91);
  });

  it("the write-time embed text is the same text the fallback embeds", () => {
    const q = onDeviceEmbed("spark freeze");
    const stored = onDeviceEmbed(teachingEmbedText("Spark freeze", "lives under Spark"));
    if (!q || !stored) return; // ternlight unavailable in this environment
    const [r] = rankTeachings("spark freeze", [row("a", "Spark freeze", "lives under Spark")]);
    expect(r!.ternlight).toBeCloseTo(onDeviceCosine(q, stored), 6);
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
