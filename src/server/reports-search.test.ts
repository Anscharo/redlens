import { describe, expect, it } from "bun:test";
import { handleReportsSearch, reportIndexSemanticHits } from "./reports-search.ts";

async function search(q: string): Promise<{ status: number; body: { hits: string[] } }> {
  const res = await handleReportsSearch(new Request(`http://x/api/reports/search?q=${encodeURIComponent(q)}`));
  return { status: res.status, body: (await res.json()) as { hits: string[] } };
}

describe("handleReportsSearch", () => {
  it("returns empty hits for a blank query without scoring", async () => {
    expect(await search("")).toEqual({ status: 200, body: { hits: [] } });
    expect(await search("   ")).toEqual({ status: 200, body: { hits: [] } });
    const res = await handleReportsSearch(new Request("http://x/api/reports/search"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hits: [] });
  });

  it("paraphrases of a title clear the floor; noise does not", async () => {
    const wallet = await search("wallet addresses");
    expect(wallet.status).toBe(200);
    expect(wallet.body.hits).toContain("onchain-addresses");

    const stale = await search("outdated dates");
    expect(stale.body.hits).toEqual(["stale-dates"]);

    const duties = await search("facilitator duties");
    expect(duties.body.hits).toContain("of-responsibilities");

    expect((await search("zzz-nonexistent")).body.hits).toEqual([]);
    expect((await search("hello world")).body.hits).toEqual([]);
  });
});

describe("reportIndexSemanticHits", () => {
  it("unwraps mode quotes the same way the client normalizer does", async () => {
    expect(await reportIndexSemanticHits('"outdated dates"')).toEqual(["stale-dates"]);
  });
});
