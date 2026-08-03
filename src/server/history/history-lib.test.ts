// The server imports value symbols from src/lib/history.ts (BATCH_MAX in
// history.ts, RECONSTRUCTED_ERAS in first-seen.ts), so `bun test` instruments the
// whole module for coverage — including the pure presentation helpers severedRange
// and movePaths. Those are exercised by the vitest suite, but v8 (vitest) and bun
// attribute function coverage to different lines, so in the MERGED lcov the two
// helper signature lines read as uncovered on the bun side. Exercising them here on
// the bun runner closes that gap without touching the frontend tests.
import { test, expect } from "bun:test";
import { severedRange, movePaths, type HistoryEntry } from "../../lib/history.ts";

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
