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
