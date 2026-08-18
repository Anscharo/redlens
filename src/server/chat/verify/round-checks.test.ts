// Pure tests for the harness's per-round retrieval telemetry.
import { test, expect } from "bun:test";
import { createRoundChecker, isEmptyResult, isErrorResult, normalizeCall } from "./round-checks.ts";
import type { RoundInfo } from "../chat-loop.ts";

test("isErrorResult flags the tool error envelope only", () => {
  expect(isErrorResult('{"error":"unknown tool"}')).toBe(true);
  expect(isErrorResult('{"results":[]}')).toBe(false);
});

test("isEmptyResult: all-empty arrays without substance = empty", () => {
  expect(isEmptyResult('{"results":[],"total":0}')).toBe(true);
  expect(isEmptyResult("[]")).toBe(true);
  expect(isEmptyResult('{"results":[{"id":"x"}]}')).toBe(false);
  // Errors are counted separately, never as empty.
  expect(isEmptyResult('{"error":"boom"}')).toBe(false);
  // No array fields at all → can't judge, not empty (bias to false negatives).
  expect(isEmptyResult('{"doc":{"title":"T"}}')).toBe(false);
  // Empty arrays but a substantive sibling object → not empty.
  expect(isEmptyResult('{"hits":[],"node":{"title":"T"}}')).toBe(false);
});

test("isEmptyResult: semantic_skipped is health metadata, not substance — a degraded-but-empty search still counts as empty", () => {
  expect(isEmptyResult('{"count":0,"results":[],"semantic_skipped":"embed timed out after 10000ms"}')).toBe(true);
  // Still substantive when a REAL field carries content alongside the skip note.
  expect(isEmptyResult('{"results":[],"semantic_skipped":"embed timed out after 10000ms","node":{"title":"T"}}')).toBe(false);
});

test("normalizeCall canonicalizes arg order, case, and whitespace", () => {
  expect(normalizeCall("atlas_search", { q: "Star  Facilitator", k: 5 })).toBe(
    normalizeCall("atlas_search", { k: 5, q: "star facilitator" }),
  );
});

test("checker accumulates rounds, duplicates, empties, and errors", () => {
  const c = createRoundChecker();
  const round = (iter: number, calls: RoundInfo["calls"], results: RoundInfo["results"]): RoundInfo => ({ iter, calls, results });

  c.record(
    round(0, [{ name: "atlas_search", args: { q: "star" } }], [{ name: "atlas_search", ok: true, content: '{"hits":[]}', truncated: false }]),
  );
  c.record(
    round(
      1,
      [
        { name: "atlas_search", args: { q: "STAR" } }, // near-dup of round 0
        { name: "atlas_get", args: { id: "x" } },
      ],
      [
        { name: "atlas_search", ok: true, content: '{"hits":[]}', truncated: false },
        { name: "atlas_get", ok: false, content: '{"error":"not found"}', truncated: false },
      ],
    ),
  );

  const t = c.telemetry();
  expect(t.rounds).toBe(2);
  expect(t.toolCalls).toBe(3);
  expect(t.emptyResults).toBe(2);
  expect(t.errorResults).toBe(1);
  expect(t.repeatedQueries).toBe(1);
  expect(t.notes.length).toBeGreaterThanOrEqual(4);
});

test("checker counts a semantic_skipped tool result and notes the degraded reason, without double-counting it as empty", () => {
  const c = createRoundChecker();
  const round = (iter: number, calls: RoundInfo["calls"], results: RoundInfo["results"]): RoundInfo => ({ iter, calls, results });

  c.record(
    round(
      0,
      [{ name: "atlas_search", args: { q: "star", mode: "hybrid" } }],
      [
        {
          name: "atlas_search",
          ok: true,
          content: '{"count":0,"results":[],"semantic_skipped":"embed timed out after 10000ms"}',
          truncated: false,
        },
      ],
    ),
  );

  const t = c.telemetry();
  expect(t.semanticSkips).toBe(1);
  expect(t.emptyResults).toBe(1); // still empty — semantic_skipped isn't substance
  expect(t.notes).toContain("round 1: semantic search degraded to lexical-only (embed timed out after 10000ms)");
});

test("checker counts semantic_skipped even when the same result also carries real hits (not empty)", () => {
  const c = createRoundChecker();
  const round = (iter: number, calls: RoundInfo["calls"], results: RoundInfo["results"]): RoundInfo => ({ iter, calls, results });

  c.record(
    round(
      0,
      [{ name: "atlas_search", args: { q: "star", mode: "hybrid" } }],
      [
        {
          name: "atlas_search",
          ok: true,
          content: '{"count":1,"mode":"hybrid","results":[{"id":"x"}],"semantic_skipped":"embeddings 502: bad gateway"}',
          truncated: false,
        },
      ],
    ),
  );

  const t = c.telemetry();
  expect(t.semanticSkips).toBe(1);
  expect(t.emptyResults).toBe(0);
  expect(t.notes).toContain("round 1: semantic search degraded to lexical-only (embeddings 502: bad gateway)");
});
