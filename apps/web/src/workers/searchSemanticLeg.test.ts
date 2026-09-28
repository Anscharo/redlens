// Unit tests for the search worker's semantic leg — the decisions ("should this
// query be embedded at all?") and the fusion ("where does a meaning-only hit
// land among wording hits?"), plus the request lifecycle. No MiniSearch, no
// worker global: the leg is deliberately separable from both.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEMANTIC_K,
  cancelSemanticLeg,
  isIdentifierQuery,
  legStatus,
  runSemanticLeg,
  semanticLegQuery,
  weaveSemantic,
} from "./searchSemanticLeg";
import { SEMANTIC_DEBOUNCE_MS, type SemanticSearchResponse } from "@/lib/searchSemantic";
import type { SearchHit, WorkerOutMessage } from "@/types";

const NO_CHAINLOG = () => false;

function hit(id: string, over: Partial<SearchHit> = {}): SearchHit {
  return {
    id,
    score: 1,
    doc_no: "A.1",
    title: id,
    titleHtml: id,
    matchReason: "title",
    type: "Core",
    depth: 2,
    parentId: null,
    snippet: "",
    ...over,
  };
}

afterEach(() => {
  cancelSemanticLeg();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("isIdentifierQuery", () => {
  it("recognises the navigation shapes the lexical fast paths already answer", () => {
    expect(isIdentifierQuery("2f0e6b4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b", NO_CHAINLOG)).toBe(true);
    expect(isIdentifierQuery("2f0e6b4a", NO_CHAINLOG)).toBe(true); // uuid prefix
    expect(isIdentifierQuery("A.2.7.1.1", NO_CHAINLOG)).toBe(true);
    expect(isIdentifierQuery("NR-12", NO_CHAINLOG)).toBe(true);
    expect(isIdentifierQuery("MCD_VAT", (s) => s === "MCD_VAT")).toBe(true);
    // Not a chainlog id this atlas knows → ordinary text, worth scoring.
    expect(isIdentifierQuery("MCD_VAT", NO_CHAINLOG)).toBe(false);
    expect(isIdentifierQuery("who approves rewards", NO_CHAINLOG)).toBe(false);
  });
});

describe("semanticLegQuery", () => {
  it("never runs on the entities lane", () => {
    expect(semanticLegQuery("rewards", "graph", "woven", 0, NO_CHAINLOG)).toBeNull();
  });

  it("off: never runs", () => {
    expect(semanticLegQuery("rewards", "lexical", "off", 0, NO_CHAINLOG)).toBeNull();
  });

  it("fallback: runs only when the wording lane found nothing", () => {
    expect(semanticLegQuery("rewards", "lexical", "fallback", 3, NO_CHAINLOG)).toBeNull();
    expect(semanticLegQuery("rewards", "lexical", "fallback", 0, NO_CHAINLOG)).toBe("rewards");
  });

  it("woven: runs whatever the wording lane found", () => {
    expect(semanticLegQuery("rewards", "lexical", "woven", 3, NO_CHAINLOG)).toBe("rewards");
    expect(semanticLegQuery("rewards", "lexical", "woven", 0, NO_CHAINLOG)).toBe("rewards");
  });

  it("the semantic lane runs even under the off strategy — picking it IS the request", () => {
    expect(semanticLegQuery("rewards", "semantic", "off", 9, NO_CHAINLOG)).toBe("rewards");
  });

  it("stands down on an identifier or structured syntax, on every lane", () => {
    expect(semanticLegQuery("A.2.7.1", "semantic", "woven", 0, NO_CHAINLOG)).toBeNull();
    expect(semanticLegQuery("type:Core rewards", "semantic", "woven", 0, NO_CHAINLOG)).toBeNull();
    expect(semanticLegQuery("ab", "semantic", "woven", 0, NO_CHAINLOG)).toBeNull();
  });
});

describe("weaveSemantic", () => {
  it("marks a document found by both legs but keeps its lexical row", () => {
    const lex = [hit("a"), hit("b", { matchReason: "content", titleHtml: "<mark>b</mark>" })];
    const sem = [hit("b", { semantic: true, semanticScore: 0.81, matchReason: "", titleHtml: "b" })];
    const woven = weaveSemantic(lex, sem);
    const b = woven.find((h) => h.id === "b")!;
    // The highlighted title and the term-centred snippet only exist on the
    // lexical hit; the semantic one cannot reconstruct them.
    expect(b.titleHtml).toBe("<mark>b</mark>");
    expect(b.matchReason).toBe("content");
    expect(b.semantic).toBe(true);
    expect(b.semanticScore).toBe(0.81);
    // Found by both ⇒ fused above a single-leg hit.
    expect(woven[0].id).toBe("b");
  });

  it("appends meaning-only hits, carrying their group provenance", () => {
    const lex = [hit("a")];
    const sem = [hit("z", { semantic: true, semanticScore: 0.7, matchReason: "", viaTitle: "Fluid Vault" })];
    const woven = weaveSemantic(lex, sem);
    expect(woven.map((h) => h.id)).toEqual(["a", "z"]);
    expect(woven[1].viaTitle).toBe("Fluid Vault");
    expect(woven[0].semantic).toBeUndefined();
  });

  it("preserves lexical order among hits RRF cannot separate", () => {
    const lex = [hit("a"), hit("b"), hit("c")];
    // Nothing overlaps, so the fused scores mirror each list's own ranks: the
    // lexical ordering has to survive rather than being shuffled.
    expect(weaveSemantic(lex, []).map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("passes either list through untouched when the other is empty", () => {
    const lex = [hit("a")];
    const sem = [hit("z", { semantic: true })];
    expect(weaveSemantic(lex, [])).toBe(lex);
    expect(weaveSemantic([], sem)).toBe(sem);
  });
});

describe("legStatus", () => {
  it("separates 'cannot' from 'tried and failed' from 'fine'", () => {
    expect(legStatus({ hits: [], skipped: null, available: false })).toBe("unavailable");
    expect(legStatus({ hits: [], skipped: "embed timed out", available: true })).toBe("skipped");
    expect(legStatus({ hits: [], skipped: null, available: true })).toBe("done");
  });
});

// ─── request lifecycle ──────────────────────────────────────────────────────

function collector() {
  const posted: WorkerOutMessage[] = [];
  return { posted, post: (m: WorkerOutMessage) => posted.push(m) };
}

const hydrate = (scored: SemanticSearchResponse["hits"]) =>
  scored.map((s) => hit(s.id, { semantic: true, semanticScore: s.score, matchReason: "" }));

function stubSemantic(body: SemanticSearchResponse | { status: number }, calls: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      calls.push(String(url));
      if ("status" in body) return Promise.resolve(new Response("nope", { status: body.status }));
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
  return calls;
}

describe("runSemanticLeg", () => {
  it("waits out the debounce before spending an embed, then posts the fused set", async () => {
    vi.useFakeTimers();
    const calls = stubSemantic({ hits: [{ id: "z", score: 0.7 }], skipped: null, available: true });
    const { posted, post } = collector();
    runSemanticLeg({
      id: 4, query: "who approves rewards", lane: "lexical",
      lexical: [hit("a")], startedAt: 0, hydrate, post,
    });

    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(0); // typing must not buy a round-trip per keystroke
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`/api/search/semantic?q=who%20approves%20rewards&k=${SEMANTIC_K}`);

    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const msg = posted[0] as Extract<WorkerOutMessage, { type: "results" }>;
    expect(msg.id).toBe(4);
    expect(msg.semantic).toBe("done");
    expect(msg.hits.map((h) => h.id)).toEqual(["a", "z"]);
  });

  it("on the semantic lane posts only the scored hits, not the lexical ones", async () => {
    vi.useFakeTimers();
    stubSemantic({ hits: [{ id: "z", score: 0.7 }], skipped: null, available: true });
    const { posted, post } = collector();
    runSemanticLeg({
      id: 1, query: "meaning", lane: "semantic",
      lexical: [], startedAt: 0, hydrate, post,
    });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 1);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const msg = posted[0] as Extract<WorkerOutMessage, { type: "results" }>;
    expect(msg.hits.map((h) => h.id)).toEqual(["z"]);
  });

  it("keeps the lexical results and reports the reason when the request fails", async () => {
    vi.useFakeTimers();
    stubSemantic({ status: 500 });
    const { posted, post } = collector();
    runSemanticLeg({
      id: 2, query: "rewards policy", lane: "lexical",
      lexical: [hit("a")], startedAt: 0, hydrate, post,
    });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 1);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const msg = posted[0] as Extract<WorkerOutMessage, { type: "results" }>;
    // Replacing on-screen results with an error state would be a regression for
    // a leg that is pure enrichment.
    expect(msg.hits.map((h) => h.id)).toEqual(["a"]);
    expect(msg.semantic).toBe("skipped");
    expect(msg.semanticNote).toContain("500");
  });

  it("reports a degraded leg the server owned up to", async () => {
    vi.useFakeTimers();
    stubSemantic({ hits: [], skipped: "embed timed out after 10000ms", available: true });
    const { posted, post } = collector();
    runSemanticLeg({ id: 3, query: "rewards", lane: "lexical", lexical: [], startedAt: 0, hydrate, post });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 1);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const msg = posted[0] as Extract<WorkerOutMessage, { type: "results" }>;
    expect(msg.semantic).toBe("skipped");
    expect(msg.semanticNote).toBe("embed timed out after 10000ms");
  });

  it("a new leg cancels the one still waiting — one request per settled query", async () => {
    vi.useFakeTimers();
    const calls = stubSemantic({ hits: [], skipped: null, available: true });
    const { post } = collector();
    const base = { lane: "lexical" as const, lexical: [], startedAt: 0, hydrate, post };
    runSemanticLeg({ id: 1, query: "gov", ...base });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS - 50);
    runSemanticLeg({ id: 2, query: "gover", ...base });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 1);
    expect(calls).toEqual([`/api/search/semantic?q=gover&k=${SEMANTIC_K}`]);
  });

  it("cancelSemanticLeg stops a scheduled request outright", async () => {
    vi.useFakeTimers();
    const calls = stubSemantic({ hits: [], skipped: null, available: true });
    const { posted, post } = collector();
    runSemanticLeg({ id: 1, query: "gov", lane: "lexical", lexical: [], startedAt: 0, hydrate, post });
    cancelSemanticLeg();
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 50);
    expect(calls).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });
});
