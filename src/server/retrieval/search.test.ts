// Pure tool-layer unit tests. Run under `bun test` (NOT vitest) — these modules
// import Bun's `SQL`, which doesn't exist in node-vitest. vitest.config.ts
// excludes src/server for that reason.
//
// Nothing below calls runSemantic, but the semantic leg is pinned off anyway so
// that stays true by construction: runSemantic is only inert while
// `config.openrouterApiKey` is falsy, and that was previously left to ambient
// env — bun auto-loads `.env.local`, so a developer with a real key would turn
// the first runSemantic-touching case added here into a live embedding request
// (embed.ts then retries 4× with 1s/2s/4s/8s of real sleep on any hiccup).
import { test, expect, beforeAll, afterAll } from "bun:test";
import { rrfMerge, matchesPhrases, buildSnippet, buildAgentSnippet, withTimeout, type Hit } from "./search.ts";
import { config } from "../config.ts";

let prevKey: string;
beforeAll(() => {
  prevKey = config.openrouterApiKey;
  config.openrouterApiKey = "";
});
afterAll(() => {
  config.openrouterApiKey = prevKey;
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
