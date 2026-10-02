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
import { test, expect, describe, it, beforeAll, afterAll, afterEach } from "bun:test";
import { rrfMerge, fuseBriefings, semanticScopeSql, embedFailureReason, SCOPED_SCAN_SETTING, matchesPhrases, buildSnippet, buildAgentSnippet, withTimeout, runSemantic, runLexical, filterByType, type Hit } from "./search.ts";
import { attributeSemanticHits, lexicalResidual, buildLeafScorer } from "./leaf-attribution.ts";
import { fuseLeafScores, GROUP_ECHO_PENALTY, leafRuleFor, residualQuery, type LeafRow } from "./leaf-scores.ts";
import { _clearQueryEmbedCache } from "./embed.ts";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import type { AtlasNode, Indexes } from "./indexes.ts";
import { MINISEARCH_OPTIONS } from "../../lib/searchOptions.ts";
import MiniSearch from "minisearch";
import fs from "node:fs";
import path from "node:path";

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
  // The query-embed LRU is PROCESS-wide. The one-round-trip tests below stub a
  // successful embed, so without this they leave a vector cached for their query
  // text and the next FILE's embed-timeout test never reaches the network to time
  // out — which is how it failed once, a file away, with nothing to point at.
  _clearQueryEmbedCache();
});

test("runSemantic returns skipped:null (no reason) when no API key is configured — permanent config state, not degradation", async () => {
  config.openrouterApiKey = "";
  const res = await runSemantic(ix, "governance", undefined, 5);
  expect(res).toEqual({ hits: [], briefingHits: [], skipped: null });
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

// ── one round trip, not two ─────────────────────────────────────────────────
//
// Leaf attribution needs a SECOND query vector (the residual), and the cost of
// an embed is the round trip, not the payload — 2.3s p50 for one text and the
// same for two. So the residual rides in the query's own call, which is only
// possible because its text comes from the LEXICAL leg (in-memory, available
// before the embed) rather than from the semantic results.
test("runSemantic embeds the query and the residual in ONE request, and hands both vectors back", async () => {
  config.openrouterApiKey = "test-key";
  config.semanticEmbedTimeoutMs = 5_000;
  const bodies: unknown[] = [];
  globalThis.fetch = ((_u: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    const input = (JSON.parse(init.body) as { input: string[] }).input;
    return Promise.resolve(
      new Response(
        JSON.stringify({ data: input.map((_t, i) => ({ index: i, embedding: Array.from({ length: 1024 }, () => 0.03) })) }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as unknown as typeof fetch;

  const res = await runSemantic(ix, "who approves rewards", undefined, 5, undefined, "approves rewards");
  // ONE call, carrying BOTH texts — a second call here is the regression this
  // test exists for.
  expect(bodies).toHaveLength(1);
  expect((bodies[0] as { input: string[] }).input).toHaveLength(2);
  // pgvector is unreachable in this suite, so the leg degrades — and a degraded
  // leg reports no vectors, because with no hits there is nothing to attribute.
  expect(res.skipped).toBeTruthy();
  expect(res.vecs).toBeUndefined();
});

test("runSemantic sends ONE text when the residual came back identical to the query", async () => {
  // Nothing was left to strip. Embedding the same text twice would be paying for
  // a vector we already have.
  config.openrouterApiKey = "test-key";
  config.semanticEmbedTimeoutMs = 5_000;
  let inputs: string[] = [];
  globalThis.fetch = ((_u: string, init: { body: string }) => {
    inputs = (JSON.parse(init.body) as { input: string[] }).input;
    return Promise.resolve(
      new Response(JSON.stringify({ data: inputs.map((_t, i) => ({ index: i, embedding: Array.from({ length: 1024 }, () => 0.02) })) }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  await runSemantic(ix, "governance", undefined, 5, undefined, "governance");
  expect(inputs).toHaveLength(1);
});

test("buildLeafScorer never embeds — so it cannot time out", async () => {
  // The residual rides in the query's own call, so the scorer makes none of its
  // own. Any fetch from here is a second call that should not exist.
  let calls = 0;
  globalThis.fetch = (() => { calls++; return Promise.reject(new Error("no")); }) as unknown as typeof fetch;
  const grouped: Hit[] = [{ id: "g", rank: 0, score: 0.8, source: "semantic", memberIds: ["m1", "m2"] }];
  const vecs = { query: Array.from({ length: 1024 }, () => 0.01), residual: Array.from({ length: 1024 }, () => 0.02) };
  // pgvector is unreachable here, so this returns undefined (attribution falls
  // back to the lexical pick) — without having gone near the network.
  expect(await buildLeafScorer(grouped, vecs)).toBeUndefined();
  expect(calls).toBe(0);
});

test("buildLeafScorer stands down when there is no residual vector, rather than guessing", async () => {
  const grouped: Hit[] = [{ id: "g", rank: 0, score: 0.8, source: "semantic", memberIds: ["m1", "m2"] }];
  expect(await buildLeafScorer(grouped, undefined)).toBeUndefined();
  expect(await buildLeafScorer(grouped, { query: [0.1] })).toBeUndefined();
});

describe("fuseLeafScores", () => {
  const row = (doc_id: string, anchor_id: string, residual_sim: number, query_sim: number, group_sim: number): LeafRow =>
    ({ doc_id, anchor_id, residual_sim, query_sim, group_sim });

  it("ranks within each group, not across them", () => {
    // A crowded group's also-ran must not outrank a small group's best: choosing
    // a leaf is a choice among THAT group's members.
    const fused = fuseLeafScores([
      row("big1", "A", 0.9, 0.9, 0.1), row("big2", "A", 0.8, 0.8, 0.1), row("big3", "A", 0.7, 0.7, 0.1),
      row("small1", "B", 0.2, 0.2, 0.1), row("small2", "B", 0.1, 0.1, 0.1),
    ]);
    // Each group's top member gets the same top-rank score.
    expect(fused.get("big1")).toBeCloseTo(fused.get("small1")!, 12);
    expect(fused.get("big1")!).toBeGreaterThan(fused.get("big2")!);
    expect(fused.get("small1")!).toBeGreaterThan(fused.get("small2")!);
  });

  it("demotes the member that merely echoes its group's name", () => {
    // The real shape of the case the residual exists for: a member that repeats
    // the instance name matches the QUERY as well as the one that answers it
    // (the query contains that name), but less well the RESIDUAL (which has the
    // name stripped), and it sits far closer to its own anchor. Both rankings
    // then agree, and fusion keeps the answer.
    const fused = fuseLeafScores([
      row("echo", "A", 0.40, 0.80, 0.95),
      row("answer", "A", 0.55, 0.78, 0.10),
    ]);
    expect(fused.get("answer")!).toBeGreaterThan(fused.get("echo")!);
  });

  it("lets the residual ranking carry a member the echo term would not pick", () => {
    // The two rankings disagree; fusion keeps the one both rate highest overall.
    const fused = fuseLeafScores([
      row("byResidual", "A", 0.90, 0.10, 0.10),
      row("byEcho", "A", 0.10, 0.90, 0.10),
      row("neither", "A", 0.05, 0.05, 0.90),
    ]);
    expect(fused.get("neither")!).toBeLessThan(fused.get("byResidual")!);
    expect(fused.get("neither")!).toBeLessThan(fused.get("byEcho")!);
  });

  it("reads Postgres numerics that arrive as strings", () => {
    // pgvector arithmetic can come back as a string; Number() around every term
    // is what keeps the ordering from becoming lexicographic.
    const fused = fuseLeafScores([
      { doc_id: "a", anchor_id: "A", residual_sim: "0.9" as never, query_sim: "0.9" as never, group_sim: "0.1" as never },
      { doc_id: "b", anchor_id: "A", residual_sim: "0.10" as never, query_sim: "0.10" as never, group_sim: "0.1" as never },
    ]);
    expect(fused.get("a")!).toBeGreaterThan(fused.get("b")!);
  });

  it("ranks by the residual alone under the residual rule, which gemini-embedding-2 uses", () => {
    const rows = [row("byResidual", "A", 0.9, 0.1, 0.1), row("byEcho", "A", 0.1, 0.9, 0.1)];
    expect(leafRuleFor("google/gemini-embedding-2")).toEqual({ rankings: "residual" });
    const fused = fuseLeafScores(rows, leafRuleFor("google/gemini-embedding-2"));
    expect(fused.get("byResidual")!).toBeGreaterThan(fused.get("byEcho")!);
    // A model with no rule of its own fuses both, and the two tie here.
    const both = fuseLeafScores(rows, leafRuleFor("qwen/qwen3-embedding-8b"));
    expect(both.get("byResidual")).toBeCloseTo(both.get("byEcho")!, 12);
  });

  it("keeps the penalty a documented constant rather than a magic number", () => {
    expect(GROUP_ECHO_PENALTY).toBe(0.25);
  });
});

describe("lexicalResidual", () => {
  const docMap = new Map([
    ["a", { title: "Fluid sUSDS ERC4626 Vault" }],
    ["b", { title: "Network" }],
  ]) as unknown as Parameters<typeof lexicalResidual>[2];

  it("strips the words the lexical leg's own titles already explain", () => {
    const lex: Hit[] = [
      { id: "a", rank: 0, score: 1, source: "lexical" },
      { id: "b", rank: 1, score: 1, source: "lexical" },
    ];
    // "which chain is the Fluid sUSDS vault on" keeps only what discriminates
    // INSIDE the group; the instance name is carried by every member.
    expect(lexicalResidual("what network is the Fluid sUSDS vault on", lex, docMap)).toBe("what is the on");
  });

  it("keeps the whole query when the titles would strip everything", () => {
    const lex: Hit[] = [{ id: "b", rank: 0, score: 1, source: "lexical" }];
    expect(lexicalResidual("network", lex, docMap)).toBe("network");
  });

  it("is empty-safe when the lexical leg found nothing", () => {
    expect(lexicalResidual("who approves rewards", [], docMap)).toBe("who approves rewards");
  });
});

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

describe("the semantic ANN query and the index that serves it", () => {
  // Migration 024 makes the HNSW index PARTIAL on `NOT attribution_only`, which
  // is what stops a `LIMIT k` scan from spending slots on rows the query then
  // filters away (grouping puts ~5 attribution-only rows in the table per
  // searchable anchor). Postgres only uses a partial index when the query's
  // predicate implies the index's — so if these two drift apart, nothing errors:
  // the planner silently falls back to a sequential scan over every vector, and
  // 024 also dropped the full-table HNSW that used to catch it.
  const readSrc = (rel: string): string => fs.readFileSync(path.join(import.meta.dir, rel), "utf8");

  it("filter on the same predicate", () => {
    const query = readSrc("./search.ts");
    const migration = readSrc("../migrations/024_searchable_hnsw.sql");

    // Alias-insensitive: search.ts writes `e.attribution_only`, the index `attribution_only`.
    const predicate = /WHERE NOT (?:\w+\.)?attribution_only/;
    expect(query).toMatch(predicate);
    expect(migration).toMatch(predicate);
    expect(migration).toContain("USING hnsw (embedding vector_cosine_ops)");
  });
});

describe("runLexical inflection", () => {
  function lexicalIx(docs: Array<{ id: string; title: string; content: string; type?: string }>): Indexes {
    const mini = new MiniSearch(MINISEARCH_OPTIONS);
    const docMap = new Map<string, AtlasNode>();
    for (const d of docs) {
      const node: AtlasNode = {
        id: d.id,
        doc_no: d.id,
        title: d.title,
        type: d.type ?? "Core",
        depth: 1,
        parentId: null,
        content: d.content,
        order: 0,
        addressRefs: [],
      };
      docMap.set(d.id, node);
      mini.add({ id: d.id, title: d.title, doc_no: d.id, type: node.type, content: d.content });
    }
    return { mini, docMap } as unknown as Indexes;
  }

  it("ranks a subsidy-term doc above a subsidies-only doc, and includes both", () => {
    const ix = lexicalIx([
      { id: "b", title: "Other", content: "these subsidies apply" },
      { id: "a", title: "Rate", content: "this subsidy is paid" },
    ]);
    const hits = runLexical(ix, "subsidy", undefined, 10);
    expect(hits.map((h) => h.id)).toEqual(["a", "b"]);
    expect(hits[0].rank).toBe(0);
    expect(hits[1].rank).toBe(1);
  });

  it("drops inflection-only hits when k is filled by original-term matches", () => {
    const ix = lexicalIx([
      { id: "a", title: "Rate", content: "this subsidy is paid" },
      { id: "b", title: "Other", content: "these subsidies apply" },
    ]);
    expect(runLexical(ix, "subsidy", undefined, 1).map((h) => h.id)).toEqual(["a"]);
  });

  it("does not expand USDS", () => {
    const ix = lexicalIx([{ id: "a", title: "Token", content: "USDS savings" }]);
    expect(runLexical(ix, "USDS", undefined, 10).map((h) => h.id)).toEqual(["a"]);
  });
});

describe("semanticScopeSql", () => {
  it("is empty without a scope, so the unscoped statement is byte-identical to before", () => {
    expect(semanticScopeSql(undefined)).toBe("");
    expect(semanticScopeSql("")).toBe("");
  });

  it("binds $3 rather than interpolating the scope into the statement", () => {
    const clause = semanticScopeSql("A.6.1'; DROP TABLE atlas_doc_meta; --");
    expect(clause).not.toContain("DROP TABLE");
    expect(clause).toContain("$3");
  });

  it("covers the anchor being the scope, inside it, or an ancestor of it", () => {
    // The SQL twin of anchorCouldServeScope — a grouped anchor above the scope
    // carries the leaves inside it, so dropping those would empty the result.
    const clause = semanticScopeSql("A.6.1");
    expect(clause).toContain("upper(m.doc_no) = upper($3)");
    expect(clause).toContain("upper(m.doc_no) LIKE upper($3) || '.%'");
    expect(clause).toContain("upper($3) LIKE upper(m.doc_no) || '.%'");
  });

  it("compares case-insensitively, like its `inScope` twin", () => {
    // Three doc numbers in the current atlas end in a lowercase `.var1`
    // (Scenario Variations). Comparing an upper-cased scope against a raw
    // m.doc_no made `in:…​.var1` match nothing and the lane answer empty with
    // no reason — a silent miss, the worst shape a filter bug can take.
    const clause = semanticScopeSql("A.1.5.5.0.4.1.1.1.VAR1");
    expect(clause).not.toMatch(/[^(]m\.doc_no/); // never a bare column side
    expect(clause.match(/upper\(m\.doc_no\)/g)).toHaveLength(3);
  });

  it("appends the dot on every comparison, so A.2 cannot match A.22", () => {
    const clause = semanticScopeSql("A.2");
    // No bare-prefix LIKE anywhere: every LIKE operand carries the separator.
    expect(clause).not.toMatch(/LIKE upper\(\$3\) \|\| '%'/);
    expect(clause.match(/\|\| '\.%'/g)).toHaveLength(2);
  });

  it("runs a scoped statement under an exact scan, inside its own transaction", () => {
    // An HNSW scan finds ef_search (40) global neighbours and THEN filters them:
    // `in:A.6` with LIMIT 40 returns 3 rows through the index and 40 with the
    // index scan disabled. The setting must be SET LOCAL so the pooled
    // connection does not carry it into the next, unscoped query.
    expect(SCOPED_SCAN_SETTING).toMatch(/^SET LOCAL /);
    const src = fs.readFileSync(path.join(import.meta.dir, "./search.ts"), "utf8");
    expect(src).toContain("tx.unsafe(SCOPED_SCAN_SETTING)");
    expect(src).toContain("tx.unsafe(stmt, [lit, overFetch, scope])");
  });
});

// ─── embed failure reporting ────────────────────────────────────────────────
// The retry backoff (1+2+4+8 = 15s) outlives every caller's budget, so a plain
// provider error loses the race to the 10s timeout and reached the UI as "embed
// timed out". These pin the cause surviving that race.

describe("embedFailureReason", () => {
  it("reports the raced error alone when the provider never spoke", () => {
    expect(embedFailureReason(new Error("embed timed out after 10000ms"), {})).toBe(
      "embed timed out after 10000ms",
    );
  });

  it("adds what the provider actually said to a timeout", () => {
    const reason = embedFailureReason(new Error("embed timed out after 10000ms"), {
      lastError: "embeddings 401: invalid api key",
    });
    // A reader seeing only the stopwatch would think the internet was slow.
    expect(reason).toContain("embed timed out after 10000ms");
    expect(reason).toContain("embeddings 401: invalid api key");
  });

  it("does not repeat itself when the raced error IS the provider's", () => {
    const same = "embeddings 429: rate limited";
    expect(embedFailureReason(new Error(same), { lastError: same })).toBe(same);
  });

  it("bounds the provider's body — this lands in a one-line status", () => {
    const reason = embedFailureReason(new Error("embed timed out after 10000ms"), {
      lastError: `embeddings 500: ${"x".repeat(400)}`,
    });
    expect(reason.length).toBeLessThan(220);
    expect(reason).toContain("…");
  });

  it("survives a non-Error rejection", () => {
    expect(embedFailureReason("plain string", {})).toBe("plain string");
  });
});

// ── briefings: the second ranking ────────────────────────────────────────────
describe("fuseBriefings", () => {
  const leaf = (id: string, rank: number, score: number): Hit => ({ id, rank, score, source: "semantic", via: { group_id: "g", group_title: "G", match_scope: "child" } });
  const brief = (id: string, rank: number, score: number): Hit => ({ id, rank, score, source: "briefing" });

  it("returns the leaves unchanged when there are no briefings", () => {
    const leaves = [leaf("a", 0, 0.9), leaf("b", 1, 0.8)];
    expect(fuseBriefings(leaves, [])).toEqual(leaves);
  });

  it("adds a briefing-only hit, marked as such, with its own cosine", () => {
    const out = fuseBriefings([leaf("a", 0, 0.9)], [brief("z", 0, 0.41)]);
    const z = out.find((h) => h.id === "z")!;
    expect(z.source).toBe("briefing");
    expect(z.score).toBe(0.41);
    expect(z.memberIds).toBeUndefined();
  });

  it("keeps the semantic source, score and via for an id in both lists", () => {
    const out = fuseBriefings([leaf("a", 0, 0.9), leaf("b", 1, 0.8)], [brief("b", 0, 0.5)]);
    const b = out.find((h) => h.id === "b")!;
    expect(b.source).toBe("semantic");
    expect(b.score).toBe(0.8);
    expect(b.via?.match_scope).toBe("child");
  });

  it("orders by fused score and numbers the ranks by position", () => {
    // b is rank 1 in leaves and rank 0 in briefings, so it passes a.
    const out = fuseBriefings([leaf("a", 0, 0.9), leaf("b", 1, 0.8)], [brief("b", 0, 0.5), brief("c", 1, 0.4)]);
    expect(out.map((h) => h.id)).toEqual(["b", "a", "c"]);
    expect(out.map((h) => h.rank)).toEqual([0, 1, 2]);
  });
});

describe("rrfMerge with a briefing list", () => {
  const lex: Hit[] = [{ id: "a", rank: 0, score: 9, source: "lexical" }, { id: "b", rank: 1, score: 8, source: "lexical" }];
  const sem: Hit[] = [{ id: "b", rank: 0, score: 0.9, source: "semantic" }];

  it("is identical with an empty or omitted third list", () => {
    expect(rrfMerge(lex, sem, [])).toEqual(rrfMerge(lex, sem));
  });

  it("fuses all three lists in one stage", () => {
    const merged = rrfMerge(lex, sem, [{ id: "c", rank: 0, score: 0.3, source: "briefing" }, { id: "a", rank: 1, score: 0.2, source: "briefing" }]);
    expect(merged.map((m) => m.id).sort()).toEqual(["a", "b", "c"]);
    expect(merged.find((m) => m.id === "c")!.sources).toEqual(["briefing"]);
    expect(merged.find((m) => m.id === "a")!.sources.sort()).toEqual(["briefing", "lexical"]);
    const base = rrfMerge(lex, sem).find((m) => m.id === "a")!.rrf_score;
    expect(merged.find((m) => m.id === "a")!.rrf_score).toBeGreaterThan(base);
  });
});

// Assigned, not spied: once an earlier test file has `mock.module`d db.ts, `sql`
// is that file's stub and `spyOn(sql, "unsafe")` has nothing to wrap — the
// statement then fails for the wrong reason. A plain property assignment works
// on the real client and on any stub alike.
function stubUnsafe(impl: (text: string) => Promise<unknown>): () => void {
  const target = sql as unknown as { unsafe?: unknown };
  const had = Object.prototype.hasOwnProperty.call(target, "unsafe");
  const prev = target.unsafe;
  target.unsafe = impl;
  return () => {
    if (had) target.unsafe = prev;
    else delete target.unsafe;
  };
}

describe("runSemantic briefing statement", () => {
  it("a failing briefing statement leaves the unit hits and returns no briefing hits", async () => {
    config.openrouterApiKey = "test-key";
    config.semanticEmbedTimeoutMs = 5_000;
    globalThis.fetch = ((_u: string, init: { body: string }) => {
      const input = (JSON.parse(init.body) as { input: string[] }).input;
      return Promise.resolve(
        new Response(JSON.stringify({ data: input.map((_t, i) => ({ index: i, embedding: Array.from({ length: 1024 }, () => 0.01) })) }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
    const restore = stubUnsafe((text) => {
      if (text.includes("atlas_doc_briefings")) return Promise.reject(new Error('relation "atlas_doc_briefings" does not exist'));
      return Promise.resolve([{ id: "u1", type: "Core", score: 0.8, member_ids: null }]);
    });
    try {
      const res = await runSemantic(ix, "briefing failure query", undefined, 5);
      expect(res.skipped).toBeNull();
      expect(res.hits.map((h) => h.id)).toEqual(["u1"]);
      expect(res.briefingHits).toEqual([]);
    } finally {
      restore();
    }
  });

  it("returns briefing hits, floor-free and ranked by position, when the statement answers", async () => {
    config.openrouterApiKey = "test-key";
    config.semanticEmbedTimeoutMs = 5_000;
    globalThis.fetch = ((_u: string, init: { body: string }) => {
      const input = (JSON.parse(init.body) as { input: string[] }).input;
      return Promise.resolve(
        new Response(JSON.stringify({ data: input.map((_t, i) => ({ index: i, embedding: Array.from({ length: 1024 }, () => 0.01) })) }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
    const restore = stubUnsafe((text) =>
      Promise.resolve(
        text.includes("atlas_doc_briefings")
          ? [{ id: "b1", score: 0.12 }, { id: "b2", score: 0.1 }]
          : [],
      ),
    );
    try {
      const res = await runSemantic(ix, "briefing ok query", undefined, 5);
      expect(res.briefingHits).toEqual([
        { id: "b1", rank: 0, score: 0.12, source: "briefing" },
        { id: "b2", rank: 1, score: 0.1, source: "briefing" },
      ]);
    } finally {
      restore();
    }
  });
});
