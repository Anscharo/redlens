// Every example on the /search-hints cheat sheet must return at least one
// document. The rows are clickable — an example that finds nothing is a dead
// link that teaches the reader the operator is broken.
//
// The examples embed doc numbers (in:A.1.6, A.1.2), a UUID prefix, an address
// prefix and a chainlog id. All of those are EDITORIAL and drift when upstream
// renumbers or restructures — see CLAUDE.md, "Never hardcode doc_nos". The page
// has to show a concrete example, so the doc numbers cannot be avoided; this
// test is what makes the drift fail in CI instead of under a reader's cursor.
//
// Runs the genuine worker over the REAL built artifacts (not the fixtures
// search.worker.test.ts uses), because the point is whether these queries hit
// THIS atlas, not whether the operators parse.
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { installWorkerGlobal, stubFetch, type WorkerHarness } from "../test/workerGlobal";
import { HINT_GROUPS } from "../lib/searchHintsData";
import type { SearchHit } from "@/types";

const ARTIFACTS = ["public/search-index.json", "public/docs.json", "public/addresses.json"];

let indexJson: string;
let docs: Record<string, unknown>;
let addresses: Record<string, unknown>;

beforeAll(() => {
  for (const p of ARTIFACTS) {
    if (!existsSync(resolve(p))) throw new Error(`${p} missing — run pnpm build:index first`);
  }
  indexJson = readFileSync(resolve("public/search-index.json"), "utf8");
  docs = JSON.parse(readFileSync(resolve("public/docs.json"), "utf8")).nodes;
  addresses = JSON.parse(readFileSync(resolve("public/addresses.json"), "utf8"));
});

// ONE worker for the whole file: the index is 3.7MB and reloading it per
// example would dominate the run. This also matches how the app uses it —
// one long-lived worker answering many queries.
let harness: WorkerHarness | null = null;
let queryId = 0;

beforeAll(async () => {
  harness = installWorkerGlobal("");
  stubFetch({ "search-index.json": indexJson });
  vi.resetModules();
  await import("./search.worker.ts");
  harness.dispatch({ type: "preload", docs, addresses });
  await harness.waitFor((m) => m.type === "ready", 60000);
}, 120000);

afterAll(() => {
  harness?.restore();
  harness = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function search(q: string): Promise<SearchHit[]> {
  const h = harness!;
  const id = ++queryId;
  const from = h.posted.length;
  h.dispatch({ type: "query", id, q });
  const msg = await h.waitFor((m) => m.type === "results" && m.id === id, 30000, from);
  return msg.hits as SearchHit[];
}

const EXAMPLES = HINT_GROUPS.flatMap((g) =>
  g.hints.map((h) => ({ group: g.title, label: h.label, query: h.query })),
);

describe("search hints — every example returns documents", () => {
  it.each(EXAMPLES)("$group / $label — $query", async ({ query }) => {
    const hits = await search(query);
    expect(hits.length).toBeGreaterThan(0);
  }, 60000);
});

describe("search hints — a quoted multi-word field filter restricts to that field", () => {
  // The [field]:"Two Words" row promises this. Asserted as a PROPERTY with the
  // expected set derived from docs.json, not as a hardcoded count: a doc-count
  // literal would rot on the next atlas edit, which is the exact failure mode
  // this file exists to catch.
  it('title:"Aligned Delegate" returns every such title and nothing else', async () => {
    const hits = await search('title:"Aligned Delegate"');
    const expected = Object.values(docs).filter((d) =>
      (d as { title: string }).title.toLowerCase().includes("aligned delegate"),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(hits.length).toBe(expected.length);
    for (const h of hits) expect((h.title ?? "").toLowerCase()).toContain("aligned delegate");
  }, 60000);
});
