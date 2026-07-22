// Exercises the real search.worker.ts module by stubbing `self` + `fetch`,
// feeding it a small hand-built MiniSearch index via a real MiniSearch
// instance (matching production's loadJSON contract), and driving its
// message handler directly. Complements search.test.ts, which tests the
// MiniSearch query semantics in isolation against the real atlas artifacts —
// this file drives the worker module itself for coverage + wiring.
import { describe, it, expect, afterEach, vi } from "vitest";
import MiniSearch from "minisearch";
import { MINISEARCH_OPTIONS } from "../lib/searchOptions";
import type { AtlasNode, AddressInfo, SearchHit } from "../types";

function doc(overrides: Partial<AtlasNode> & { id: string; doc_no: string; title: string; content: string }): AtlasNode {
  return { type: "Core", depth: 3, parentId: null, order: 1, addressRefs: [], ...overrides };
}

const DEAD_ADDR = "0x0000000000000000000000000000000000dead";

const D1 = doc({
  id: "11111111-1111-1111-1111-111111111111",
  doc_no: "A.1.1",
  title: "Delegate Facilitator Rules",
  content:
    "This document covers delegatedSigners and general delegate rules for facilitators. " +
    "It references MCD_VAT in some contexts. Address 0x0000000000000000000000000000000000dead is used.",
  addressRefs: [DEAD_ADDR],
});
const D2 = doc({
  id: "22222222-2222-2222-2222-222222222222",
  doc_no: "A.1.1.1",
  title: "Facilitator Scope",
  type: "Section",
  depth: 4,
  parentId: D1.id,
  content: "This slippery scope covers delegate exclusions and edge cases for facilitators.",
});
const D3 = doc({
  id: "33333333-3333-3333-3333-333333333333",
  doc_no: "A.1.2",
  title: "Quorum Core",
  content: "Quorum rules mention USDC ticker among other stablecoins and quorum thresholds.",
});
const D4 = doc({
  id: "44444444-4444-4444-4444-444444444444",
  doc_no: "NR-1",
  title: "Needed Research Example",
  type: "Needed Research",
  depth: 1,
  content: "Open research question about facilitator quorum alignment.",
});
// Same address as D1 but no literal "MCD_VAT" text — chainlog-only tier.
const D5 = doc({
  id: "55555555-5555-5555-5555-555555555555",
  doc_no: "A.1.3",
  title: "Chainlog Only Doc",
  content: "This document references the vat address without the literal ticker text.",
  addressRefs: [DEAD_ADDR],
});
// Literal "MCD_VAT" text but no matching addressRefs — search-only tier.
const D6 = doc({
  id: "66666666-6666-6666-6666-666666666666",
  doc_no: "A.1.4",
  title: "Search Only Doc",
  content: "Unrelated MCD_VAT text appears here but no matching address reference.",
});

const ALL_DOCS = [D1, D2, D3, D4, D5, D6];
const DOCS: Record<string, AtlasNode> = Object.fromEntries(ALL_DOCS.map((d) => [d.id, d]));
const ADDRESSES: Record<string, AddressInfo> = {
  [DEAD_ADDR]: {
    chain: "ethereum",
    explorerUrl: `https://etherscan.io/address/${DEAD_ADDR}`,
    label: "MCD_VAT",
    chainlogId: "MCD_VAT",
    isContract: true,
    isProxy: false,
    roles: [],
    aliases: [],
    expectedTokens: [],
  },
};

function buildIndexText(): string {
  const ms = new MiniSearch(MINISEARCH_OPTIONS);
  ms.addAll(ALL_DOCS.map((d) => ({ id: d.id, title: d.title, doc_no: d.doc_no, type: d.type, content: d.content })));
  return JSON.stringify(ms);
}

function textResponse(text: string, ok = true, status = 200) {
  return { ok, status, text: async () => text, json: async () => JSON.parse(text) };
}

function makeFetch(indexText: string, ok = true) {
  return vi.fn((url: string) => {
    if (String(url).includes("search-index.json")) {
      return ok ? Promise.resolve(textResponse(indexText)) : Promise.resolve(textResponse("", false, 500));
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
}

let postMessage: ReturnType<typeof vi.fn>;
let messageHandler: ((e: { data: unknown }) => void) | undefined;

async function importWorker(fetchImpl: ReturnType<typeof makeFetch>) {
  vi.resetModules();
  postMessage = vi.fn();
  messageHandler = undefined;
  vi.stubGlobal("self", {
    postMessage,
    name: "",
    addEventListener: vi.fn((type: string, cb: (e: { data: unknown }) => void) => {
      if (type === "message") messageHandler = cb;
    }),
  });
  vi.stubGlobal("fetch", fetchImpl);
  await import("./search.worker.ts");
}

function send(msg: unknown) {
  messageHandler!({ data: msg });
}

function lastPosted(): any {
  return postMessage.mock.calls.at(-1)![0];
}

function postedOfType(type: string) {
  return postMessage.mock.calls.map((c) => c[0]).find((m: any) => m.type === type);
}

/** Boots the worker with the standard fixture docs/addresses and waits for "ready". */
async function bootWorker() {
  await importWorker(makeFetch(buildIndexText()));
  send({ type: "preload", docs: DOCS, addresses: ADDRESSES });
  await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());
  postMessage.mockClear();
}

function query(q: string): SearchHit[] {
  send({ type: "query", id: 1, q });
  const result = lastPosted();
  expect(result.type).toBe("results");
  return result.hits as SearchHit[];
}

describe("search.worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("responds to ping regardless of preload timing", async () => {
    await importWorker(makeFetch(buildIndexText()));
    send({ type: "ping" });
    // ping doesn't wait on init; only asserts the handler is wired.
    expect(lastPosted()).toEqual({ type: "ready" });
  });

  it("posts an error message when the search-index fetch fails", async () => {
    await importWorker(makeFetch(buildIndexText(), false));
    await vi.waitFor(() => expect(postedOfType("error")).toBeDefined());
  });

  it("resolves a direct UUID query, found and not found", async () => {
    await bootWorker();
    const found = query(D1.id);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(D1.id);

    const notFound = query("22222222-9999-9999-9999-222222222222");
    expect(notFound).toHaveLength(0);
  });

  it("resolves a partial UUID prefix, found and falling through when unmatched", async () => {
    await bootWorker();
    const found = query(D1.id.slice(0, 8));
    expect(found.map((h) => h.id)).toEqual([D1.id]);
    expect(found[0].matchReason).toBe("uuid prefix");

    // "deadbeef" matches no doc id prefix; falls through to full-text search
    // (which legitimately returns nothing for this fixture set).
    const fallthrough = query("deadbeef");
    expect(fallthrough).toEqual([]);
  });

  it("resolves an exact doc_no fast path, including NR-, and misses fall through", async () => {
    await bootWorker();
    const byDocNo = query("A.1.2");
    expect(byDocNo.map((h) => h.id)).toEqual([D3.id]);
    expect(byDocNo[0].matchReason).toBe("doc number");

    const nr = query("NR-1");
    expect(nr.map((h) => h.id)).toEqual([D4.id]);

    const miss = query("A.9.9");
    expect(miss).toEqual([]);
  });

  it("scopes results with in: and combines with a free-text term", async () => {
    await bootWorker();
    const hits = query("in:A.1.1 delegate");
    expect(hits.map((h) => h.id).sort()).toEqual([D1.id, D2.id].sort());
  });

  it("filters by type: (bare and quoted-multiword)", async () => {
    await bootWorker();
    const core = query("type:Core quorum");
    expect(core.map((h) => h.id)).toContain(D3.id);
    expect(core.every((h) => h.type === "Core")).toBe(true);

    const nr = query('type:"Needed Research" quorum');
    expect(nr.map((h) => h.id)).toEqual([D4.id]);
  });

  it("requires an exact double-quoted phrase", async () => {
    await bootWorker();
    const hits = query('"delegate rules"');
    expect(hits.map((h) => h.id)).toContain(D1.id);
    for (const h of hits) {
      expect((DOCS[h.id].content + " " + DOCS[h.id].title).toLowerCase()).toContain("delegate rules");
    }
  });

  it("requires an exact case-sensitive single-quoted phrase", async () => {
    await bootWorker();
    const exact = query("'delegatedSigners'");
    expect(exact.map((h) => h.id)).toContain(D1.id);

    const wrongCase = query("'DelegatedSigners'");
    expect(wrongCase.map((h) => h.id)).not.toContain(D1.id);
  });

  it("auto-phrases all-caps tickers so the stemmer/tokenizer can't mangle them", async () => {
    await bootWorker();
    const hits = query("USDC");
    expect(hits.map((h) => h.id)).toEqual([D3.id]);
  });

  it("scopes field-restricted terms (title:, content:) and empties to a filter-only query", async () => {
    await bootWorker();
    const byTitle = query("title:Facilitator");
    expect(byTitle.map((h) => h.id).sort()).toEqual([D1.id, D2.id].sort());

    const byContent = query("content:quorum");
    expect(byContent.map((h) => h.id).sort()).toEqual([D3.id, D4.id].sort());
  });

  it("combines type: + title: + a free word, building a multi-part matchReason", async () => {
    await bootWorker();
    const hits = query("type:Core title:Facilitator core");
    expect(hits.map((h) => h.id)).toEqual([D1.id]);
    expect(hits[0].matchReason).toContain("type");
    expect(hits[0].matchReason).toContain("title");
  });

  it("applies the ~N fuzzy operator", async () => {
    await bootWorker();
    const hits = query("quorem~1");
    expect(hits.map((h) => h.id).sort()).toEqual([D3.id, D4.id].sort());
  });

  it("excludes -word matches from the result set", async () => {
    await bootWorker();
    const hits = query("delegate -slippery");
    expect(hits.map((h) => h.id)).toContain(D1.id);
    expect(hits.map((h) => h.id)).not.toContain(D2.id);
  });

  it("returns every doc for a fully empty query", async () => {
    await bootWorker();
    const hits = query("");
    expect(hits).toHaveLength(ALL_DOCS.length);
  });

  it("merges chainlog reverse-lookup hits into both / chainlog-only / search-only tiers", async () => {
    await bootWorker();
    const hits = query("MCD_VAT");
    const byId = new Map(hits.map((h) => [h.id, h]));

    // D1: found by both chainlog (addressRefs) and text search (literal "MCD_VAT").
    expect(byId.get(D1.id)?.matchReason).toContain("chainlog");
    expect(byId.get(D1.id)?.chainlogId).toBe("MCD_VAT");

    // D5: same address, but no literal "MCD_VAT" text — chainlog-only.
    expect(byId.get(D5.id)?.matchReason).toBe("chainlog");

    // D6: literal "MCD_VAT" text, but its address isn't the chainlog's — search-only.
    expect(byId.get(D6.id)).toBeDefined();
    expect(byId.get(D6.id)?.matchReason).not.toContain("chainlog");
  });

  it("reports timing on the results message", async () => {
    await bootWorker();
    send({ type: "query", id: 42, q: "quorum" });
    const result = lastPosted();
    expect(result.id).toBe(42);
    expect(typeof result.durationMs).toBe("number");
  });
});
