import { describe, expect, it } from "vitest";
import { REPORT_INDEX_CARDS, REPORT_INDEX_GROUPS } from "./reportCatalog";
import {
  buildReportFieldVecs,
  cosineSim,
  filterReportGroups,
  hitsFromScores,
  scoreReportQuery,
  SEMANTIC_MAX,
  SEMANTIC_MIN,
} from "./reportIndexSearch";

const idsOf = (query: string, extraIds?: Set<string>) =>
  filterReportGroups(REPORT_INDEX_GROUPS, query, extraIds).flatMap((g) => g.cards.map((c) => c.id));

describe("report index ternlight scoring", () => {
  it("paraphrases of a title beat the floor; noise stays under it", async () => {
    const { embed } = await import("@ternlight/base");
    const fieldVecs = buildReportFieldVecs(REPORT_INDEX_CARDS, embed);

    const score = (q: string) => scoreReportQuery(q, fieldVecs, embed, cosineSim);

    const wallet = score("wallet addresses");
    expect(wallet.get("onchain-addresses")!).toBeGreaterThanOrEqual(SEMANTIC_MIN);
    expect(idsOf("wallet addresses", hitsFromScores(wallet))).toContain("onchain-addresses");

    const stale = score("outdated dates");
    expect(stale.get("stale-dates")!).toBeGreaterThanOrEqual(SEMANTIC_MIN);
    expect(idsOf("outdated dates", hitsFromScores(stale))).toEqual(["stale-dates"]);

    const duties = score("facilitator duties");
    expect(duties.get("of-responsibilities")!).toBeGreaterThanOrEqual(SEMANTIC_MIN);
    expect(idsOf("facilitator duties", hitsFromScores(duties))).toContain("of-responsibilities");

    const processList = score("process list");
    expect(processList.get("processes")!).toBeGreaterThanOrEqual(SEMANTIC_MIN);

    const who = score("who has to do what");
    expect(who.get("of-responsibilities")!).toBeGreaterThanOrEqual(SEMANTIC_MIN);

    const responsible = score("who is responsible");
    expect(responsible.get("of-responsibilities")!).toBeGreaterThanOrEqual(SEMANTIC_MIN);
    expect(idsOf("who is responsible", hitsFromScores(responsible))).toContain("of-responsibilities");

    const typos = hitsFromScores(score("typos in the atlas"));
    expect(typos.size).toBeLessThanOrEqual(SEMANTIC_MAX);
    expect(typos).toContain("potential-mistakes");

    // Direct name is lexical; the score lane still ranks it first.
    const name = score("stale dates");
    expect(name.get("stale-dates")!).toBeGreaterThan(SEMANTIC_MIN);

    expect(idsOf("zzz-nonexistent", hitsFromScores(score("zzz-nonexistent")))).toEqual([]);
    expect(idsOf("hello world", hitsFromScores(score("hello world")))).toEqual([]);
    expect(idsOf("etherscan", hitsFromScores(score("etherscan")))).toEqual([]);
    expect(idsOf("pizza", hitsFromScores(score("pizza")))).toEqual([]);
  });
});
