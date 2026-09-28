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
import { SLASH_COMMANDS } from "../lib/shortcuts";
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

describe("search hints — the cheat sheet is not silently empty", () => {
  it("lists a non-trivial number of examples across several groups", () => {
    expect(HINT_GROUPS.length).toBeGreaterThanOrEqual(4);
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(12);
  });

  it("gives every group a unique title and every example a unique query", () => {
    const titles = HINT_GROUPS.map((g) => g.title);
    expect(new Set(titles).size).toBe(titles.length);
    const queries = EXAMPLES.map((e) => e.query);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("does not collide with the slash-command namespace", () => {
    const cmds = new Set(SLASH_COMMANDS.map((s) => s.cmd));
    for (const e of EXAMPLES) expect(cmds.has(e.query)).toBe(false);
  });
});
