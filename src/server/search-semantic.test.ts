import { afterEach, describe, expect, it } from "bun:test";
import { config } from "./config.ts";
import {
  SEMANTIC_K_DEFAULT,
  SEMANTIC_K_MAX,
  clampK,
  handleSemanticSearch,
  semanticDocSearch,
  semanticSearchAvailable,
  toWireHits,
} from "./search-semantic.ts";
import type { SemanticSearchResponse } from "../lib/searchSemantic.ts";

// config is a plain mutable object; restore whatever this process actually has
// so no later test file in the same `bun test` run inherits our value.
const REAL_KEY = config.openrouterApiKey;
afterEach(() => {
  config.openrouterApiKey = REAL_KEY;
});

async function get(qs: string): Promise<SemanticSearchResponse> {
  const res = await handleSemanticSearch(new Request(`http://x/api/search/semantic${qs}`));
  expect(res.status).toBe(200);
  return (await res.json()) as SemanticSearchResponse;
}

describe("clampK", () => {
  it("defaults, floors and caps", () => {
    expect(clampK(null)).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("")).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("abc")).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("0")).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("-5")).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("10")).toBe(10);
    expect(clampK("10.6")).toBe(11);
    // An unbounded k would be one pgvector row per unit in the whole corpus.
    expect(clampK("99999")).toBe(SEMANTIC_K_MAX);
  });
});

describe("toWireHits", () => {
  const docMap = new Map<string, unknown>([["a", 1], ["b", 1], ["c", 1]]);

  it("keeps order, drops duplicate leaves, and caps at k", () => {
    const hits = toWireHits(
      [
        { id: "a", score: 0.9 },
        { id: "a", score: 0.8 }, // second anchor attributed to the same leaf
        { id: "b", score: 0.7 },
        { id: "c", score: 0.6 },
      ],
      docMap,
      2,
    );
    expect(hits).toEqual([
      { id: "a", score: 0.9 },
      { id: "b", score: 0.7 },
    ]);
  });

  it("drops ids the client's doc map cannot resolve", () => {
    // A doc the served artifacts don't have (sha skew) would occupy a slot and
    // then vanish during hydration — worse than never being sent.
    const hits = toWireHits([{ id: "zz", score: 0.9 }, { id: "b", score: 0.5 }], docMap, 5);
    expect(hits).toEqual([{ id: "b", score: 0.5 }]);
  });

  it("reports viaTitle only for a child attribution", () => {
    const [child, group] = toWireHits(
      [
        { id: "a", score: 0.9, via: { group_id: "g", group_title: "Fluid sUSDS Vault", match_scope: "child" } },
        { id: "b", score: 0.8, via: { group_id: "g", group_title: "Fluid sUSDS Vault", match_scope: "group" } },
      ],
      docMap,
      5,
    );
    expect(child).toEqual({ id: "a", score: 0.9, viaTitle: "Fluid sUSDS Vault" });
    // The anchor itself matched, so its title IS this hit's title — repeating
    // it as "via …" would be noise.
    expect(group).toEqual({ id: "b", score: 0.8 });
  });
});

describe("availability", () => {
  it("follows the embedding key", () => {
    config.openrouterApiKey = "";
    expect(semanticSearchAvailable()).toBe(false);
    config.openrouterApiKey = "sk-test";
    expect(semanticSearchAvailable()).toBe(true);
  });

  it("answers 200 with available:false rather than 404 when unconfigured", async () => {
    // A 404 would be indistinguishable from "this route doesn't exist", and the
    // UI needs to be able to say WHY the lane is missing.
    config.openrouterApiKey = "";
    expect(await get("?q=who%20approves%20rewards")).toEqual({ hits: [], skipped: null, available: false });
  });

  it("never reports a missing key as a degraded leg", async () => {
    config.openrouterApiKey = "";
    expect((await get("?q=governance")).skipped).toBeNull();
  });
});

describe("query guards", () => {
  it("returns nothing, and embeds nothing, for a query too short to score", async () => {
    // A real key is set here: reaching the embed would be a network call.
    config.openrouterApiKey = "sk-test";
    expect(await get("?q=ab")).toEqual({ hits: [], skipped: null, available: true });
    expect(await get("?q=")).toEqual({ hits: [], skipped: null, available: true });
    expect(await get("")).toEqual({ hits: [], skipped: null, available: true });
    expect(await get("?q=%20%20%20")).toEqual({ hits: [], skipped: null, available: true });
  });

  it("passes k and type through without throwing", async () => {
    config.openrouterApiKey = "";
    const body = await semanticDocSearch("liquidation penalties", { k: 5, type: "Core" });
    expect(body).toEqual({ hits: [], skipped: null, available: false });
  });
});
