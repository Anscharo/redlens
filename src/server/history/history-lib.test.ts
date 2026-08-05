// The server imports value symbols from src/lib/history.ts (BATCH_MAX in
// history.ts, RECONSTRUCTED_ERAS in first-seen.ts), so `bun test` instruments the
// whole module for coverage — including the pure presentation helpers severedRange
// and movePaths. Those are exercised by the vitest suite, but v8 (vitest) and bun
// attribute function coverage to different lines, so in the MERGED lcov the two
// helper signature lines read as uncovered on the bun side. Exercising them here on
// the bun runner closes that gap without touching the frontend tests.
import { test, expect, afterAll } from "bun:test";
import { severedRange, movePaths, loadHistory, type HistoryEntry } from "../../lib/history.ts";

const origFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = origFetch;
});

const moved = (e: Partial<HistoryEntry>): HistoryEntry => ({
  date: "2024-01-01",
  commitHash: "abc1234",
  changeType: "moved",
  ...e,
});

test("severedRange renders a severed window as a month range, else null", () => {
  expect(severedRange("severed:2024-09-02..2025-05-28")).toBe("2024-09 ~ 2025-05");
  expect(severedRange("4e931df")).toBeNull();
  expect(severedRange("genesis:bafkreih7")).toBeNull();
});

test("movePaths returns recorded paths, the markdown-migration paths, or null", () => {
  expect(movePaths(moved({ movedFrom: "a.md", movedTo: "b.md" }))).toEqual({ from: "a.md", to: "b.md" });
  expect(movePaths(moved({ pr: 117 }))).toEqual({ from: "Sky Atlas.html", to: "Sky Atlas.md" });
  expect(movePaths(moved({ pr: 236 }))).toBeNull();
  expect(movePaths(moved({ changeType: "modified", movedTo: "b.md" }))).toBeNull();
});

// H2 (deep-QA 2026-08-02): a self-move (movedFrom === movedTo) is not a move to render.
test("movePaths is null for a self-move — movedFrom === movedTo", () => {
  expect(movePaths(moved({ movedFrom: "A.1.11", movedTo: "A.1.11" }))).toBeNull();
});

// loadHistory is a frontend fetch helper, but the server value-imports history.ts
// (BATCH_MAX), so bun instruments loadHistory too. With no bun test exercising it,
// its lines — including the H1 fix that treats a 5xx as transient — read as
// uncovered in the MERGED lcov. Drive it here on the bun runner (the vitest suite
// covers the DOM side); each test uses a distinct nodeId so the module-level cache
// doesn't cross-contaminate, and afterAll restores the real fetch for other suites.
test("loadHistory resolves to the parsed array on a 200", async () => {
  const rows = [{ date: "2024-01-01", commitHash: "a", changeType: "added" }] as HistoryEntry[];
  globalThis.fetch = (async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;
  expect(await loadHistory("bun-ok")).toEqual(rows);
});

test("loadHistory caches a stable null on a 404 (no backend, or no such doc)", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
  expect(await loadHistory("bun-404")).toBeNull();
  expect(await loadHistory("bun-404")).toBeNull(); // served from cache, not refetched
  expect(calls).toBe(1);
});

test("loadHistory treats a 5xx as transient — evicts the cache and refetches, never caching null (H1)", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1 ? new Response(null, { status: 503 }) : new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
  expect(await loadHistory("bun-503")).toBeNull(); // the caller never sees the rejection
  expect(await loadHistory("bun-503")).toEqual([]); // cache was evicted → the retry succeeds
  expect(calls).toBe(2);
});
