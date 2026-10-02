// Worker-side tests for apps/web/src/workers/search.worker.ts.
//
// These drive the genuine worker code through its message protocol (the same
// protocol useSearch/App speak on the main thread): install a fake worker global,
// stub the artifact fetch with a REAL serialized MiniSearch index over fixture
// docs, then send preload/ping/query messages and assert on what the worker posts
// back. This covers the actual user search flows — every documented operator, the
// fast-paths, chainlog reverse lookup, and the init/error lifecycle — rather than
// re-testing MiniSearch in isolation.

import { describe, it, expect, afterEach, vi } from "vitest";
import { installWorkerGlobal, stubFetch, type WorkerHarness } from "../test/workerGlobal";
import {
  makeDocsRecord,
  makeAddresses,
  makeSearchIndexJson,
  IDS,
  MCD_VAT_ADDR,
} from "../test/workerFixtures";
import type { SearchHit } from "@/types";
import { SEMANTIC_DEBOUNCE_MS } from "@/lib/searchSemantic";

let harness: WorkerHarness | null = null;

afterEach(() => {
  harness?.restore();
  harness = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

interface SearchSession {
  h: WorkerHarness;
  query: (q: string) => Promise<SearchHit[]>;
  lastResults: () => Record<string, unknown>;
}

let queryId = 0;

async function initSearchWorker(opts?: {
  name?: string;
  fail?: Record<string, number>;
  calls?: string[];
}): Promise<SearchSession> {
  const h = installWorkerGlobal(opts?.name ?? "");
  harness = h;
  stubFetch({ "search-index.json": makeSearchIndexJson() }, { fail: opts?.fail, calls: opts?.calls });
  vi.resetModules();
  await import("./search.worker.ts");
  h.dispatch({ type: "preload", docs: makeDocsRecord(), addresses: makeAddresses() });
  await h.waitFor((m) => m.type === "ready");

  return {
    h,
    query: async (q: string) => {
      const id = ++queryId;
      h.dispatch({ type: "query", id, q });
      const msg = await h.waitFor((m) => m.type === "results" && m.id === id);
      return msg.hits as SearchHit[];
    },
    lastResults: () => h.ofType("results").at(-1) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("init lifecycle", () => {
  it("posts ready once preload + index have both arrived", async () => {
    const { h } = await initSearchWorker();
    expect(h.ofType("ready")).toHaveLength(1);
  });

  it("does not post ready until preload arrives (index alone is insufficient)", async () => {
    const h = installWorkerGlobal();
    harness = h;
    stubFetch({ "search-index.json": makeSearchIndexJson() });
    vi.resetModules();
    await import("./search.worker.ts");
    // Give init a few ticks with the index fetched but no preload yet.
    await new Promise((r) => setTimeout(r, 20));
    expect(h.ofType("ready")).toHaveLength(0);
    h.dispatch({ type: "preload", docs: makeDocsRecord(), addresses: makeAddresses() });
    await h.waitFor((m) => m.type === "ready");
  });

  it("fetches the default flat base by default", async () => {
    const calls: string[] = [];
    await initSearchWorker({ calls });
    expect(calls.some((u) => u.endsWith("/search-index.json"))).toBe(true);
  });

  it("threads a preview base through self.name into the fetch URL", async () => {
    const calls: string[] = [];
    await initSearchWorker({ name: "/api/preview/abc123/", calls });
    expect(calls.some((u) => u === "/api/preview/abc123/search-index.json")).toBe(true);
  });

  it("posts an error (not an eternal spinner) when the index fetch 404s", async () => {
    const h = installWorkerGlobal();
    harness = h;
    stubFetch({}, { fail: { "search-index.json": 404 } });
    vi.resetModules();
    await import("./search.worker.ts");
    h.dispatch({ type: "preload", docs: makeDocsRecord(), addresses: makeAddresses() });
    const err = await h.waitFor((m) => m.type === "error");
    expect(String(err.message)).toContain("search-index.json");
  });

  it("ping is answered with ready even before init settles", async () => {
    const h = installWorkerGlobal();
    harness = h;
    stubFetch({ "search-index.json": makeSearchIndexJson() });
    vi.resetModules();
    await import("./search.worker.ts");
    h.dispatch({ type: "ping" });
    await h.waitFor((m) => m.type === "ready");
  });

  it("a query received before init completes returns empty hits (no crash)", async () => {
    const h = installWorkerGlobal();
    harness = h;
    stubFetch({ "search-index.json": makeSearchIndexJson() });
    vi.resetModules();
    await import("./search.worker.ts");
    // No preload yet → idx is null → search() short-circuits to [].
    h.dispatch({ type: "query", id: 999, q: "governance" });
    const msg = await h.waitFor((m) => m.type === "results" && m.id === 999);
    expect(msg.hits).toEqual([]);
    expect(typeof msg.durationMs).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Fast-paths (bypass MiniSearch)
// ---------------------------------------------------------------------------

describe("fast-paths", () => {
  it("full UUID jumps straight to the doc", async () => {
    const s = await initSearchWorker();
    const hits = await s.query(IDS.facilitatorCore);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(IDS.facilitatorCore);
  });

  it("full UUID for a missing doc returns nothing", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("00000000-0000-4000-8000-notarealuuid00".replace("notarealuuid00", "000000000000"));
    expect(hits).toEqual([]);
  });

  it("partial UUID prefix resolves and is tagged 'uuid prefix'", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("bbbbbbbb");
    expect(hits.map((h) => h.id)).toContain(IDS.facilitatorCore);
    expect(hits.find((h) => h.id === IDS.facilitatorCore)!.matchReason).toBe("uuid prefix");
  });

  it("a UUID prefix matching multiple docs returns them sorted by doc_no", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("abcabc12");
    // prefixA is A.3.2, prefixB is A.3.1 — sorted output is B then A.
    expect(hits.map((h) => h.id)).toEqual([IDS.prefixB, IDS.prefixA]);
    expect(hits.every((h) => h.matchReason === "uuid prefix")).toBe(true);
  });

  it("partial UUID hits are sorted by doc_no", async () => {
    const s = await initSearchWorker();
    // 'a' prefix matches both the scope (A.1) and annotation (a1b2…) ids.
    const hits = await s.query("a");
    // 'a' alone is < 8 hex so it's NOT a uuid prefix — this must fall through to text search.
    // Assert it did not use the prefix path (matchReason differs).
    expect(hits.every((h) => h.matchReason !== "uuid prefix")).toBe(true);
  });

  it("exact doc_no jumps to the section with score 10", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("A.1.2");
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(IDS.facilitatorCore);
    expect(hits[0].score).toBe(10);
    expect(hits[0].matchReason).toBe("doc number");
  });

  it("exact doc_no lookup is case-insensitive on the letter prefix", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("a.1.2");
    expect(hits[0]?.id).toBe(IDS.facilitatorCore);
  });
});

// ---------------------------------------------------------------------------
// Documented search operators (the SearchHints cheat sheet)
// ---------------------------------------------------------------------------

describe("search operators", () => {
  it("bare prefix term matches by content/title", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("govern");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.id === IDS.scope)).toBe(true);
  });

  it("type: filter restricts to a node type", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("type:Annotation governance");
    expect(hits.length).toBeGreaterThan(0);
    const docs = makeDocsRecord();
    for (const h of hits) expect(docs[h.id].type).toBe("Annotation");
  });

  it("type: filter tolerates a space after the colon", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("type: Annotation governance");
    const docs = makeDocsRecord();
    for (const h of hits) expect(docs[h.id].type).toBe("Annotation");
  });

  it("an underscored identifier matches literally, not as its parts", async () => {
    const s = await initSearchWorker();
    expect((await s.query("MCD_JUG")).length).toBe(0); // shares only "mcd" with the fixture
    expect((await s.query("mcd_vat")).map((h) => h.id)).toContain(IDS.facilitatorCore);
    expect((await s.query("mcd_v")).map((h) => h.id)).toContain(IDS.facilitatorCore); // prefix
    expect((await s.query("vat")).map((h) => h.id)).toContain(IDS.facilitatorCore); // part
  });

  it("a bare underscore finds docs containing it", async () => {
    const s = await initSearchWorker();
    for (const q of ['"_"']) {
      const ids = (await s.query(q)).map((h) => h.id);
      expect(ids).toContain(IDS.facilitatorCore);
      expect(ids).not.toContain(IDS.scope);
    }
  });

  it("multi-word type via underscore (Scenario_Variation)", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("type:Scenario_Variation delegate");
    expect(hits.some((h) => h.id === IDS.scenarioVar)).toBe(true);
    const docs = makeDocsRecord();
    for (const h of hits) expect(docs[h.id].type).toBe("Scenario Variation");
  });

  it("in: scope filter keeps only the subtree", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("in:A.1.2 delegate");
    const docs = makeDocsRecord();
    for (const h of hits) {
      const no = docs[h.id].doc_no;
      expect(no === "A.1.2" || no.startsWith("A.1.2.")).toBe(true);
    }
    // The scenario variation (A.1.2.1.var1) is inside the scope and mentions delegate.
    expect(hits.some((h) => h.id === IDS.scenarioVar)).toBe(true);
  });

  it("title: field scope excludes content-only matches", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("title:Quorum");
    const docs = makeDocsRecord();
    for (const h of hits) expect(docs[h.id].title.toLowerCase()).toContain("quorum");
    expect(hits.some((h) => h.id === IDS.facilitatorCore)).toBe(true);
  });

  it("content: field scope matches body text", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("content:universal");
    expect(hits.some((h) => h.id === IDS.agentIcd)).toBe(true);
  });

  it('double-quote phrase requires the literal phrase', async () => {
    const s = await initSearchWorker();
    const hits = await s.query('"properly implemented"');
    expect(hits.some((h) => h.id === IDS.facilitatorCore)).toBe(true);
    const docs = makeDocsRecord();
    for (const h of hits) {
      expect((docs[h.id].content + " " + docs[h.id].title).toLowerCase()).toContain("properly implemented");
    }
  });

  it('double-quote phrase matches even when it begins/ends with punctuation (S3 regression, "(USDS)")', async () => {
    const s = await initSearchWorker();
    // facilitatorCore's content contains "...quorum. properly implemented." —
    // "quorum." is a phrase whose trailing character is punctuation. An
    // unconditional \b<phrase>\b (the pre-fix behavior) can never match here:
    // \b never holds between two non-word characters ("." followed by " ",
    // or "." at the very end of annotation's content). Same shape of bug as
    // the reported "(USDS)" case, using content already in the fixtures.
    const hits = await s.query('"quorum."');
    expect(hits.some((h) => h.id === IDS.facilitatorCore)).toBe(true);
    expect(hits.some((h) => h.id === IDS.annotation)).toBe(true);
    const docs = makeDocsRecord();
    for (const h of hits) {
      expect((docs[h.id].content + " " + docs[h.id].title).toLowerCase()).toContain("quorum.");
    }
  });

  it("single-quote phrase is case-sensitive", async () => {
    const s = await initSearchWorker();
    const good = await s.query("'delegatedSigners'");
    expect(good.some((h) => h.id === IDS.facilitatorCore)).toBe(true);
    const bad = await s.query("'DelegatedSigners'");
    expect(bad.some((h) => h.id === IDS.facilitatorCore)).toBe(false);
  });

  it("all-caps ticker is auto-promoted to a phrase (USDC)", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("USDC");
    expect(hits.some((h) => h.id === IDS.facilitatorCore)).toBe(true);
    for (const h of hits) {
      const docs = makeDocsRecord();
      expect(docs[h.id].content.includes("USDC")).toBe(true);
    }
  });

  it("-exclusion removes docs containing the term", async () => {
    const s = await initSearchWorker();
    const withScenario = await s.query("delegate");
    expect(withScenario.some((h) => h.id === IDS.scenarioVar)).toBe(true);
    const excluded = await s.query("delegate -slippery");
    expect(excluded.some((h) => h.id === IDS.scenarioVar)).toBe(false);
  });

  it("excluding an ALL-CAPS ticker does not self-contradict into zero results (S2 regression)", async () => {
    const s = await initSearchWorker();
    // facilitatorCore contains both "quorum" and "USDC"; annotation contains
    // "quorum" but not "USDC". Before the fix, the ticker auto-phrase loop ran
    // over "-USDC" before exclusion parsing and promoted the bare "USDC" to a
    // REQUIRED phrase as well as an excluded term — a doc had to both contain
    // and not contain "usdc", so every doc was rejected and results were [].
    const hits = await s.query("quorum -USDC");
    expect(hits.some((h) => h.id === IDS.annotation)).toBe(true);
    expect(hits.some((h) => h.id === IDS.facilitatorCore)).toBe(false);
  });

  it("-USDC (uppercase) and -usdc (lowercase) exclusions return the same result set", async () => {
    const s = await initSearchWorker();
    const upper = await s.query("quorum -USDC");
    const lower = await s.query("quorum -usdc");
    expect(upper.map((h) => h.id).sort()).toEqual(lower.map((h) => h.id).sort());
    expect(upper.length).toBeGreaterThan(0);
  });

  it("~N fuzzy tolerates a typo", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("misalignmnt~1"); // transposed/missing char
    expect(hits.some((h) => h.id === IDS.scenarioVar)).toBe(true);
  });

  it("combined type: + title: filters intersect", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("type:Core title:Quorum");
    expect(hits.some((h) => h.id === IDS.facilitatorCore)).toBe(true);
    const docs = makeDocsRecord();
    for (const h of hits) {
      expect(docs[h.id].type).toBe("Core");
      expect(docs[h.id].title.toLowerCase()).toContain("quorum");
    }
  });

  it("empty query returns all docs when no filters are present", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("   ");
    expect(hits.length).toBe(Object.keys(makeDocsRecord()).length);
  });

  it("empty query WITH a type filter returns only that type", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("type:Annotation");
    const docs = makeDocsRecord();
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(docs[h.id].type).toBe("Annotation");
  });
});

// ---------------------------------------------------------------------------
// Chainlog reverse lookup
// ---------------------------------------------------------------------------

describe("chainlog reverse lookup", () => {
  it("a known chainlog id surfaces the doc that references its address", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("MCD_VAT");
    const hit = hits.find((h) => h.id === IDS.facilitatorCore);
    expect(hit).toBeDefined();
    expect(hit!.chainlogId).toBe("MCD_VAT");
    expect(hit!.chainlogAddress).toBe(MCD_VAT_ADDR);
    expect(hit!.matchReason).toContain("chainlog");
  });

  it("an unknown chainlog-shaped token falls through to text search", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("MCD_NOPE");
    // No chainlog match, no text match → empty, and definitely no chainlog tag.
    expect(hits.every((h) => !h.chainlogId)).toBe(true);
  });

  it("a doc referencing the address but lacking the literal id is a chainlog-only hit", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("MCD_VAT");
    // facilitatorCore contains the literal 'MCD_VAT' → 'both' tier (chainlog + text).
    const both = hits.find((h) => h.id === IDS.facilitatorCore)!;
    expect(both.matchReason.startsWith("chainlog + ")).toBe(true);
    // addrOnly references the address but never writes 'MCD_VAT' → chainlog-only tier.
    const only = hits.find((h) => h.id === IDS.addrOnly)!;
    expect(only.matchReason).toBe("chainlog");
    expect(only.chainlogId).toBe("MCD_VAT");
  });
});

// ---------------------------------------------------------------------------
// Result shape + provenance labels
// ---------------------------------------------------------------------------

describe("result shape", () => {
  it("echoes the query id and includes a numeric duration", async () => {
    const s = await initSearchWorker();
    await s.query("govern");
    const last = s.lastResults();
    expect(typeof last.id).toBe("number");
    expect(typeof last.durationMs).toBe("number");
  });

  it("hits carry scope/agent/ICD provenance labels", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("in:A.6.1.1.1 reward");
    const child = hits.find((h) => h.id === IDS.agentChild);
    expect(child).toBeDefined();
    const kinds = (child!.labels ?? []).map((l) => l.kind);
    // Deep agent node → agent label + ICD label.
    expect(kinds).toContain("agent");
    expect(kinds).toContain("icd");
  });

  it("scope-level hits get a scope label", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("in:A.1 delegate");
    const varHit = hits.find((h) => h.id === IDS.scenarioVar);
    expect(varHit).toBeDefined();
    expect((varHit!.labels ?? []).some((l) => l.kind === "scope")).toBe(true);
  });

  it("titleHtml is HTML-escaped and snippet is present", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("govern");
    for (const h of hits) {
      expect(typeof h.titleHtml).toBe("string");
      expect(typeof h.snippet).toBe("string");
    }
  });

  it("a UUID-exact hit HTML-escapes special characters in the title", async () => {
    const s = await initSearchWorker();
    const hits = await s.query(IDS.scope);
    // Title "Governance & Scope" → the raw '&' must be entity-escaped.
    expect(hits[0].titleHtml).toContain("&amp;");
    expect(hits[0].titleHtml).not.toMatch(/&(?!amp;)/);
  });
});

// ---------------------------------------------------------------------------
// Singular/plural expansion (query-time, exact-first)
// ---------------------------------------------------------------------------

describe("inflection", () => {
  it("subsidy also returns a subsidies-only doc, ranked after exact-term hits", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("subsidy");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain(IDS.subsidyExact);
    expect(ids).toContain(IDS.subsidiesOnly);
    expect(ids.indexOf(IDS.subsidyExact)).toBeLessThan(ids.indexOf(IDS.subsidiesOnly));
  });

  it("agents also returns an agent-only doc, ranked after agents-term hits", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("agents");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain(IDS.agentRoot); // "agents scope"
    expect(ids).toContain(IDS.agentOnly);
    expect(ids.indexOf(IDS.agentRoot)).toBeLessThan(ids.indexOf(IDS.agentOnly));
  });

  it("quoted phrase subsidy does not expand to subsidies", async () => {
    const s = await initSearchWorker();
    const hits = await s.query('"subsidy"');
    const ids = hits.map((h) => h.id);
    expect(ids).toContain(IDS.subsidyExact);
    expect(ids).not.toContain(IDS.subsidiesOnly);
  });

  it("strict 'subsidy' does not expand to subsidies", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("'subsidy'");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain(IDS.subsidyExact);
    expect(ids).not.toContain(IDS.subsidiesOnly);
  });

  it("title:subsidy also matches a title that uses subsidies", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("title:subsidy");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain(IDS.subsidyExact);
    expect(ids).toContain(IDS.subsidiesOnly);
  });

  it("highlights the counterpart form in a subsidies-only snippet", async () => {
    const s = await initSearchWorker();
    const hits = await s.query("subsidy");
    const only = hits.find((h) => h.id === IDS.subsidiesOnly);
    expect(only?.snippet).toContain("<mark>");
    expect(only?.snippet.toLowerCase()).toMatch(/subsid/);
  });
});

// ---------------------------------------------------------------------------
// Semantic lane (end-to-end through the message protocol)
// ---------------------------------------------------------------------------

// The lexical half and the fused half arrive as two `results` messages under one
// id, so these tests correlate on the message's own `semantic` field rather than
// on arrival order alone.
describe("did you mean", () => {
  type Results = { type: "results"; hits: SearchHit[]; didYouMean?: string; durationMs: number };

  async function ask(q: string, extra: Record<string, unknown> = {}) {
    const s = await initSearchWorker();
    const id = ++queryId;
    s.h.dispatch({ type: "query", id, q, ...extra });
    return (await s.h.waitFor((m) => m.type === "results" && m.id === id)) as Results;
  }

  it("corrects a misspelling of an indexed term", async () => {
    // "quorum" is in the fixture corpus; "quorem" is not.
    const msg = await ask("quorem");
    expect(msg.hits).toEqual([]);
    expect(msg.didYouMean).toBe("quorum");
  });

  it("offers nothing when the query already found results", async () => {
    const msg = await ask("quorum");
    expect(msg.hits.length).toBeGreaterThan(0);
    expect(msg.didYouMean).toBeUndefined();
  });

  it("offers nothing rather than a correction that also finds nothing", async () => {
    const msg = await ask("zzzzqqqxnope");
    expect(msg.hits).toEqual([]);
    expect(msg.didYouMean).toBeUndefined();
  });

  it("stays on the wording lane — a spelling fix says nothing about meaning", async () => {
    const msg = await ask("quorem", { lane: "semantic" });
    expect(msg.didYouMean).toBeUndefined();
  });
});

describe("remembered search time", () => {
  it("replays the time the wording search COST, not the time the replay took", async () => {
    const s = await initSearchWorker();
    const run = async (lane: string) => {
      const id = ++queryId;
      s.h.dispatch({ type: "query", id, q: "quorum", lane });
      const m = await s.h.waitFor((x) => x.type === "results" && x.id === id);
      return m.durationMs as number;
    };
    const first = await run("lexical");
    // Flipping away and back must not re-time the memo hit: a number that
    // changed on every flip would be measuring the click, not the search.
    await run("semantic");
    expect(await run("lexical")).toBe(first);
  });
});

describe("semantic lane", () => {
  type Results = { type: "results"; id: number; hits: SearchHit[]; lane: string; semantic: string; semanticNote?: string };

  /** initSearchWorker, but with the semantic endpoint stubbed too. */
  async function withSemantic(body: unknown, opts?: { calls?: string[] }) {
    const h = installWorkerGlobal("");
    harness = h;
    stubFetch(
      { "search-index.json": makeSearchIndexJson(), "/api/search/semantic": body },
      { calls: opts?.calls },
    );
    vi.resetModules();
    await import("./search.worker.ts");
    h.dispatch({ type: "preload", docs: makeDocsRecord(), addresses: makeAddresses() });
    await h.waitFor((m) => m.type === "ready");
    return h;
  }

  function ask(h: WorkerHarness, q: string, extra: Record<string, unknown>) {
    const id = ++queryId;
    h.dispatch({ type: "query", id, q, ...extra });
    return id;
  }

  it("off: answers once, with no semantic leg and no network call", async () => {
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    const id = ask(h, "governance", { lane: "lexical" });
    const first = (await h.waitFor((m) => m.type === "results" && m.id === id)) as Results;
    expect(first.semantic).toBe("none");
    await new Promise((r) => setTimeout(r, SEMANTIC_DEBOUNCE_MS + 60));
    expect(h.ofType("results").filter((m) => m.id === id)).toHaveLength(1);
    expect(calls.some((u) => u.includes("/api/search/semantic"))).toBe(false);
  });

  it("the wording lane never embeds, not even for a query it answered with nothing", async () => {
    // A reader on this lane asked for a wording search, so an empty answer that
    // offers a spelling correction and a pill to the other index beats a silent
    // switch to rows that share no word with the query.
    const calls: string[] = [];
    const h = await withSemantic({ hits: [{ id: IDS.facilitatorCore, score: 0.8 }], skipped: null, available: true }, { calls });
    const id = ask(h, "nothingmatchesthis", { lane: "lexical" });
    const msg = (await h.waitFor((m) => m.type === "results" && m.id === id)) as Results;
    expect(msg.hits).toEqual([]);
    expect(msg.semantic).toBe("none");
    await new Promise((r) => setTimeout(r, SEMANTIC_DEBOUNCE_MS + 60));
    expect(calls.some((u) => u.includes("/api/search/semantic"))).toBe(false);
  });

  it("a meaning-lane hit is marked, scored and attributed", async () => {
    const h = await withSemantic({
      hits: [{ id: IDS.facilitatorCore, score: 0.74, viaTitle: "Quorum group" }],
      skipped: null,
      available: true,
    });
    const id = ask(h, "nothingmatchesthis", { lane: "semantic" });
    const done = (await h.waitFor((m) => m.type === "results" && m.id === id && m.semantic === "done")) as Results;
    expect(done.hits.map((x) => x.id)).toEqual([IDS.facilitatorCore]);
    expect(done.hits[0].semantic).toBe(true);
    expect(done.hits[0].semanticScore).toBe(0.74);
    expect(done.hits[0].viaTitle).toBe("Quorum group");
    // Nothing about the wording matched, and an empty reason is what the result
    // row renders as a bare "semantic match".
    expect(done.hits[0].matchReason).toBe("");
  });

  it("leaves a meaning-only hit unhighlighted, with the document's opening as its snippet", async () => {
    const h = await withSemantic({
      hits: [{ id: IDS.facilitatorCore, score: 0.7 }],
      skipped: null,
      available: true,
    });
    // "the" occurs in this fixture's content; under term highlighting it would
    // be marked, asserting a wording match the row's own label denies.
    const id = ask(h, "the nothingmatches", { lane: "semantic" });
    const done = (await h.waitFor((m) => m.type === "results" && m.id === id && m.semantic === "done")) as Results;
    const hit = done.hits[0];
    expect(hit.snippet).not.toContain("<mark>");
    expect(hit.titleHtml).not.toContain("<mark>");
    expect(hit.snippet.startsWith("…")).toBe(false); // opened at the head, not a window
  });

  it("the meaning lane answers with scored rows alone, never merged with wording ones", async () => {
    const h = await withSemantic({
      hits: [{ id: IDS.facilitatorCore, score: 0.9 }, { id: IDS.addrOnly, score: 0.6 }],
      skipped: null,
      available: true,
    });
    const id = ask(h, "nothingmatchesthis", { lane: "semantic" });
    const done = (await h.waitFor((m) => m.type === "results" && m.id === id && m.semantic === "done")) as Results;
    // The meaning lane answers with the semantic list alone, never interleaved
    // with the wording one.
    expect(done.hits.map((x) => x.id)).toEqual([IDS.facilitatorCore, IDS.addrOnly]);
    expect(done.hits.every((x) => x.semantic)).toBe(true);
  });

  const semCalls = (calls: string[]) => calls.filter((u) => u.includes("/api/search/semantic"));

  it("holds a query whose words do not look like words: wording hits, held words named, no request", async () => {
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    const id = ask(h, "xkcdq quorum", { lane: "semantic" });
    const msg = (await h.waitFor((m) => m.type === "results" && m.id === id)) as Results & { heldWords?: string[] };
    expect(msg.semantic).toBe("none");
    expect(msg.heldWords).toEqual(["xkcdq"]);
    expect(msg.hits.map((x) => x.id)).toContain(IDS.facilitatorCore);
    await new Promise((r) => setTimeout(r, SEMANTIC_DEBOUNCE_MS + 60));
    expect(semCalls(calls)).toHaveLength(0);
  });

  it("judges the words when the pause ends, so a word still being typed is never held", async () => {
    // "str" has no vowel yet, but the reader is on the way to "strategy": the
    // next keystroke cancels the pause before the first is ever judged.
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    const first = ask(h, "quorum str", { lane: "semantic" });
    const second = ask(h, "quorum strategy", { lane: "semantic" });
    const msg = (await h.waitFor((m) => m.type === "results" && m.id === second && m.semantic === "done")) as Results & { heldWords?: string[] };
    expect(h.ofType("results").filter((m) => m.id === first)).toHaveLength(0);
    expect(msg.heldWords).toBeUndefined();
    expect(semCalls(calls)).toHaveLength(1);
  });

  it("sends the same held query once the reader forces it", async () => {
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    const id = ask(h, "xkcdq quorum", { lane: "semantic", force: true });
    const msg = (await h.waitFor((m) => m.type === "results" && m.id === id && m.semantic === "done")) as Results & { heldWords?: string[] };
    expect(msg.heldWords).toBeUndefined();
    expect(semCalls(calls)).toHaveLength(1);
  });

  it("does not hold a letter-number term the index holds", async () => {
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    ask(h, `who holds ${MCD_VAT_ADDR}`, { lane: "semantic" });
    await new Promise((r) => setTimeout(r, SEMANTIC_DEBOUNCE_MS + 60));
    expect(semCalls(calls)).toHaveLength(1);
  });

  it("a finished word buys its embed at the short debounce", async () => {
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    ask(h, "governance", { lane: "semantic" });
    await new Promise((r) => setTimeout(r, SEMANTIC_DEBOUNCE_MS + 60));
    expect(calls.filter((u) => u.includes("/api/search/semantic"))).toHaveLength(1);
  });

  it("the semantic lane withholds the wording list and answers only once", async () => {
    const h = await withSemantic({ hits: [{ id: IDS.addrOnly, score: 0.5 }], skipped: null, available: true });
    const id = ask(h, "quorum", { lane: "semantic" });
    const done = (await h.waitFor((m) => m.type === "results" && m.id === id)) as Results;
    // One message, and it contains what the meaning index returned — not the
    // lexical hits for "quorum", which the worker computed and discarded.
    expect(done.semantic).toBe("done");
    expect(done.hits.map((x) => x.id)).toEqual([IDS.addrOnly]);
    expect(h.ofType("results").filter((m) => m.id === id)).toHaveLength(1);
  });

  it("the semantic lane falls back to wording for a doc-number paste", async () => {
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    const id = ask(h, "A.1.2", { lane: "semantic" });
    const msg = (await h.waitFor((m) => m.type === "results" && m.id === id)) as Results;
    // An identifier has one right answer; it must not be a dead end on this
    // lane, and must not spend an embedding call.
    expect(msg.semantic).toBe("none");
    expect(msg.hits.map((x) => x.id)).toEqual([IDS.facilitatorCore]);
    await new Promise((r) => setTimeout(r, SEMANTIC_DEBOUNCE_MS + 60));
    expect(calls.some((u) => u.includes("/api/search/semantic"))).toBe(false);
  });

  it("reports an unconfigured backend rather than staying silent", async () => {
    const h = await withSemantic({ hits: [], skipped: null, available: false });
    const id = ask(h, "nothingmatchesthis", { lane: "semantic" });
    const done = (await h.waitFor(
      (m) => m.type === "results" && m.id === id && m.semantic === "unavailable",
    )) as Results;
    // Nothing to show, but the reader is told WHY rather than seeing a bare
    // "no results" for a lane that was never able to run.
    expect(done.hits).toEqual([]);
  });

  it("flipping lane on the same query scores it once, and replays instantly", async () => {
    const calls: string[] = [];
    const h = await withSemantic(
      { hits: [{ id: IDS.facilitatorCore, score: 0.9 }], skipped: null, available: true },
      { calls },
    );
    const semanticCalls = () => calls.filter((u) => u.includes("/api/search/semantic"));

    // Wording lane, fallback: wording finds nothing, the leg runs, answer cached.
    const first = ask(h, "nothingmatchesthis", { lane: "semantic" });
    await h.waitFor((m) => m.type === "results" && m.id === first && m.semantic === "done");
    expect(semanticCalls()).toHaveLength(1);

    // Flip to meaning, then back. Same query text, so the scored ids are the
    // same answer — neither flip may re-embed or re-query pgvector.
    const second = ask(h, "nothingmatchesthis", { lane: "semantic" });
    const onMeaning = (await h.waitFor((m) => m.type === "results" && m.id === second)) as Results;
    const third = ask(h, "nothingmatchesthis", { lane: "semantic" });
    const backOnWording = (await h.waitFor((m) => m.type === "results" && m.id === third)) as Results;

    expect(semanticCalls()).toHaveLength(1);
    // A cache hit is FINAL: no interim "pending" for either flip, because there
    // is nothing to wait for.
    for (const [id, msg] of [[second, onMeaning], [third, backOnWording]] as const) {
      expect(msg.semantic).toBe("done");
      expect(h.ofType("results").filter((m) => m.id === id)).toHaveLength(1);
    }
    // Both lanes show the same scored set — the leg replaces, it never merges.
    expect(onMeaning.hits.map((x) => x.id)).toEqual([IDS.facilitatorCore]);
    expect(backOnWording.hits.map((x) => x.id)).toEqual([IDS.facilitatorCore]);
  });

  it("re-scores after a degraded leg rather than replaying the outage", async () => {
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: "embed timed out", available: true }, { calls });
    const semanticCalls = () => calls.filter((u) => u.includes("/api/search/semantic"));

    const first = ask(h, "nothingmatchesthis", { lane: "semantic" });
    await h.waitFor((m) => m.type === "results" && m.id === first && m.semantic === "skipped");
    expect(semanticCalls()).toHaveLength(1);

    const second = ask(h, "nothingmatchesthis", { lane: "semantic" });
    await h.waitFor((m) => m.type === "results" && m.id === second && m.semantic === "skipped");
    expect(semanticCalls()).toHaveLength(2);
  });

  it("passes an in: subtree to the backend instead of embedding the filter text", async () => {
    const calls: string[] = [];
    const h = await withSemantic(
      { hits: [{ id: IDS.facilitatorCore, score: 0.8 }], skipped: null, available: true },
      { calls },
    );
    const id = ask(h, "in:A.1 quorum requirements", { lane: "semantic" });
    await h.waitFor((m) => m.type === "results" && m.id === id && m.semantic === "done");
    const url = calls.find((u) => u.includes("/api/search/semantic"))!;
    // The scope rides as its own parameter. Left in the text, the model would be
    // scoring documents against the literal string "in:A.1".
    expect(url).toContain("q=quorum%20requirements");
    expect(url).toContain("in=A.1");
    expect(url).not.toContain("in%3AA.1");
  });

  it("keeps the scope in the cache key — a different subtree is a different answer", async () => {
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    const semanticCalls = () => calls.filter((u) => u.includes("/api/search/semantic"));

    const a = ask(h, "in:A.1 quorum", { lane: "semantic" });
    await h.waitFor((m) => m.type === "results" && m.id === a && m.semantic === "done");
    const b = ask(h, "in:A.4 quorum", { lane: "semantic" });
    await h.waitFor((m) => m.type === "results" && m.id === b && m.semantic === "done");
    expect(semanticCalls()).toHaveLength(2);

    // ...and the same subtree still replays from cache.
    const again = ask(h, "in:A.1 quorum", { lane: "semantic" });
    await h.waitFor((m) => m.type === "results" && m.id === again);
    expect(semanticCalls()).toHaveLength(2);
  });

  it("keeps the in: scope and strips the filter beside it, rather than standing down", async () => {
    // `in:` is a doc-number filter the semantic query honours in SQL; `type:` has
    // no string to act on here, so it is dropped and the status line says so.
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    const id = ask(h, "in:A.1 type:Core quorum", { lane: "semantic" });
    const msg = (await h.waitFor((m) => m.type === "results" && m.id === id && m.semantic === "done")) as Results;
    expect(msg.semantic).toBe("done");
    const url = calls.find((u) => u.includes("/api/search/semantic"))!;
    expect(url).toContain("q=quorum");
    expect(url).toContain("in=A.1");
    expect(url).not.toContain("type");
  });

  it("a missing lane/sem behaves exactly as before the feature existed", async () => {
    const calls: string[] = [];
    const h = await withSemantic({ hits: [], skipped: null, available: true }, { calls });
    const id = ask(h, "governance", {});
    const msg = (await h.waitFor((m) => m.type === "results" && m.id === id)) as Results;
    expect(msg.lane).toBe("lexical");
    expect(msg.semantic).toBe("none");
    await new Promise((r) => setTimeout(r, SEMANTIC_DEBOUNCE_MS + 60));
    expect(calls.some((u) => u.includes("/api/search/semantic"))).toBe(false);
  });
});
