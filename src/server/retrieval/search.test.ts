// Pure tool-layer unit tests. Run under `bun test` (NOT vitest) — these modules
// import Bun's `SQL`, which doesn't exist in node-vitest. vitest.config.ts
// excludes src/server for that reason.
//
// The semantic leg is pinned off for the non-runSemantic cases below:
// runSemantic is only inert while `config.openrouterApiKey` is falsy, and that
// was previously left to ambient env — bun auto-loads `.env.local`, so a
// developer with a real key would otherwise turn any runSemantic-touching case
// into a live embedding request (embed.ts then retries 4x with 1s/2s/4s/8s of
// real sleep on any hiccup). The runSemantic failure-path tests set the key
// themselves and restore the PINNED empty state (not ambient) in afterEach,
// so the pin holds for every case that follows them.
import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import { rrfMerge, matchesPhrases, buildSnippet, buildAgentSnippet, withTimeout, runSemantic, attributeSemanticHits, residualQuery, filterByType, type Hit } from "./search.ts";
import { config } from "../config.ts";
import type { AtlasNode, Indexes } from "./indexes.ts";

let prevKey: string;
beforeAll(() => {
  prevKey = config.openrouterApiKey;
  config.openrouterApiKey = "";
});
afterAll(() => {
  config.openrouterApiKey = prevKey;
});

// ── runSemantic — embed-leg failure paths ────────────────────────────────────
// Stubs config.openrouterApiKey + globalThis.fetch directly (the same pattern
// as embed.test.ts / zz-db-integration.test.ts's semantic-leg tests) — NOT
// mock.module. A module.mock of embed.ts here was tried and reverted: it left
// a delegate wrapper installed in the registry for the rest of this `bun test`
// process (mock.module has no per-file undo), and a live-binding re-read of
// its own "unmocked" export inside afterEach ended up resolving back to the
// mock itself — an infinite call loop that only showed up once this file ran
// alongside zz-db-integration.test.ts. Plain global stubs carry none of that
// cross-file registry risk.
const ix = {} as unknown as Indexes; // runSemantic's ix param is unused

const prevTimeout = config.semanticEmbedTimeoutMs;
const prevFetch = globalThis.fetch;
afterEach(() => {
  config.openrouterApiKey = ""; // back to the beforeAll pin, not ambient env
  config.semanticEmbedTimeoutMs = prevTimeout;
  globalThis.fetch = prevFetch;
});

test("runSemantic returns skipped:null (no reason) when no API key is configured — permanent config state, not degradation", async () => {
  config.openrouterApiKey = "";
  const res = await runSemantic(ix, "governance", undefined, 5);
  expect(res).toEqual({ hits: [], skipped: null });
});

test("runSemantic reports a skip reason when the embed call times out", async () => {
  config.openrouterApiKey = "test-key";
  config.semanticEmbedTimeoutMs = 20;
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch; // never resolves
  const res = await runSemantic(ix, "governance", undefined, 5);
  expect(res.hits).toEqual([]);
  expect(res.skipped).toMatch(/embed timed out after 20ms/);
});

// A non-timeout runtime failure (embedBatch's provider-error rejection, or a
// pgvector query error after a successful embed) hits the SAME catch and the
// SAME `skipped: err.message` passthrough exercised above — there's no
// separate branch to unit-test here. embedBatch's own retry-exhaustion timing
// (~15s of backoff before it rejects) is embed.ts's concern, not runSemantic's,
// and is out of scope (see file header). The passthrough for a fast,
// non-timeout rejection is covered end-to-end in
// zz-db-integration.test.ts ("a semantic-leg failure degrades to lexical-only
// instead of failing the whole query" — pgvector rejects immediately, no
// retry loop involved).

test("withTimeout resolves when the promise beats the deadline", async () => {
  const v = await withTimeout(Promise.resolve(42), 1000, "x");
  expect(v).toBe(42);
});

test("withTimeout rejects when the promise is slower than the deadline (embed fallback path)", async () => {
  // A never-settling embed must not hang the caller: runSemantic catches this
  // rejection and returns [] so the query degrades to lexical-only.
  const hang = new Promise<number>(() => {});
  await expect(withTimeout(hang, 20, "embed")).rejects.toThrow(/embed timed out after 20ms/);
});

test("buildSnippet compacts prose — strips articles and abbreviates known words", () => {
  const s = buildSnippet("The governance of the parameters is defined for the ecosystem.", "governance");
  expect(s).toContain("Gov."); // governance → Gov.
  expect(s).toContain("Params."); // parameters → Params.
  expect(s).not.toMatch(/(^|\s)the(\s|$)/i); // articles dropped
});

// The agent counterpart must NOT do any of that: an agent quotes its tool
// results and the verifier checks those quotes against them, so a compacted
// snippet either ships mangled text to the user or gets the answer hard-failed
// for a quote that faithfully reproduced what the tool returned.
test("buildAgentSnippet keeps prose verbatim — no words dropped or abbreviated", () => {
  const src = "The governance of the parameters is defined for the ecosystem.";
  const s = buildAgentSnippet(src, "governance");
  expect(s).toBe(src);
  expect(s).not.toContain("Gov.");
  expect(s).not.toContain("Params.");
});

test("buildAgentSnippet windows around the hit and stays a literal substring", () => {
  const src =
    "Alpha beta gamma delta epsilon. ".repeat(12) +
    "Core GovOps manages the overall dispute resolution process, including establishing communication channels. " +
    "Zeta eta theta iota kappa. ".repeat(12);
  const s = buildAgentSnippet(src, "dispute");
  expect(s).toContain("dispute resolution process");
  expect(s.startsWith("…") && s.endsWith("…")).toBe(true);
  // The only transform allowed is collapsing whitespace runs, which the
  // verifier's normalizeForMatch applies to both sides too.
  const body = s.replace(/^…|…$/g, "");
  expect(src.replace(/\s+/g, " ")).toContain(body);
  // Windowed, not the whole document, and never cut mid-word.
  expect(body.length).toBeLessThanOrEqual(240);
  expect(body).toMatch(/^\S/);
  expect(body).toMatch(/\S$/);
});

test("buildAgentSnippet on a short doc returns it whole with no ellipses", () => {
  expect(buildAgentSnippet("Short body text.", "body")).toBe("Short body text.");
  expect(buildAgentSnippet("", "body")).toBe("");
});

test("attributeSemanticHits fuses a semantic parent with a lexical descendant onto the child", () => {
  const parent: AtlasNode = {
    id: "p", doc_no: "A.1.1", title: "Parent", type: "Core", depth: 3,
    parentId: null, content: "parent body", order: 0, addressRefs: [],
  };
  const child: AtlasNode = {
    id: "c", doc_no: "A.1.1.1", title: "Network", type: "Core", depth: 4,
    parentId: "p", content: "Ethereum Mainnet", order: 0, addressRefs: [],
  };
  const ix = { docMap: new Map([["p", parent], ["c", child]]) } as Indexes;
  const lex: Hit[] = [{ id: "c", rank: 0, score: 10, source: "lexical" }];
  const sem: Hit[] = [{ id: "p", rank: 0, score: 0.9, source: "semantic", memberIds: ["p", "c"] }];
  const out = attributeSemanticHits("network", lex, sem, ix);
  expect(out[0]!.id).toBe("c");
  expect(out[0]!.via?.group_id).toBe("p");
  expect(out[0]!.via?.match_scope).toBe("child");
  const merged = rrfMerge(lex, out);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.id).toBe("c");
  expect(merged[0]!.sources.sort()).toEqual(["lexical", "semantic"]);
});

test("filterByType runs after leaf-pick so a Core child of a grouped Section parent is kept", () => {
  const parent: AtlasNode = {
    id: "p", doc_no: "A.1.1", title: "Parent", type: "Section", depth: 3,
    parentId: null, content: "parent body", order: 0, addressRefs: [],
  };
  const child: AtlasNode = {
    id: "c", doc_no: "A.1.1.1", title: "Network", type: "Core", depth: 4,
    parentId: "p", content: "Ethereum Mainnet", order: 0, addressRefs: [],
  };
  const ix = { docMap: new Map([["p", parent], ["c", child]]) } as Indexes;
  const lex: Hit[] = [];
  const sem: Hit[] = [{ id: "p", rank: 0, score: 0.9, source: "semantic", memberIds: ["p", "c"] }];
  const attributed = attributeSemanticHits("network", lex, sem, ix);
  expect(attributed[0]!.id).toBe("c");
  expect(filterByType(attributed, ix, "Core")).toHaveLength(1);
  expect(filterByType(attributed, ix, "Section")).toHaveLength(0);
});

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

describe("residualQuery", () => {
  it("removes words the retrieved groups already account for", () => {
    // The instance name dominates the query embedding, so members win by echoing it
    // rather than by answering. Inside a group that name discriminates nothing.
    const q = "which chain does Ethereum Mainnet - Fluid sUSDS ERC4626 Vault run on";
    const out = residualQuery(q, ["Ethereum Mainnet - Fluid sUSDS ERC4626 Vault Instance Configuration Document"]);
    expect(out).toBe("which chain does run on");
  });

  it("strips the union of several anchor titles", () => {
    const out = residualQuery("who controls Grove Freezer Multisig", ["Grove Multisigs", "Freezer Multisig"]);
    expect(out).toBe("who controls");
  });

  it("keeps the original query when everything would be stripped", () => {
    // An empty residual carries no signal at all; the unstripped query is strictly better.
    const q = "Freezer Multisig";
    expect(residualQuery(q, ["Freezer Multisig"])).toBe(q);
  });
});
