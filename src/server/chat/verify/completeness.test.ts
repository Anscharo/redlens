import { test, expect } from "bun:test";
import {
  auditCompleteness,
  scoreCompletenessToolChoice,
  COMPLETENESS_REQUERY_STEER,
  type CompletenessEvidence,
} from "./completeness.ts";

const Q = "What is the oldest rate limit id in the atlas.";
const ANSWER =
  "Among those queried, the oldest Rate Limit ids are first-seen 2026-07-10: aaa, bbb, and ccc.";
const WINNER = "8414b48b-932e-430e-a236-727807fd73ba";

function ev(tool: string, args: Record<string, unknown>, content: unknown): CompletenessEvidence {
  return { tool, args: JSON.stringify(args), content: JSON.stringify(content) };
}

test("incident-shaped answer + only atlas_search evidence → unverified (requery)", () => {
  const audit = auditCompleteness(Q, ANSWER, [
    ev("atlas_search", { query: "rate limit", k: 10 }, { results: [{ title: "Rate Limit", id: "a" }] }),
  ]);
  expect(audit.outcome).toBe("unverified");
  expect(audit.detail).toBe(COMPLETENESS_REQUERY_STEER);
});

test("hedge among those queried + search evidence still fails", () => {
  const audit = auditCompleteness(Q, "Among those queried the oldest is 2026-07-10.", [
    ev("atlas_search", { query: "rate limit" }, { results: [] }),
  ]);
  expect(audit.outcome).toBe("unverified");
});

test("same answer + untruncated atlas_filter title listing → grounded", () => {
  const audit = auditCompleteness("What are all the Rate Limit ids?", "The rate limits are all 3 listed below.", [
    ev("atlas_filter", { title: "Rate Limit" }, { total: 3, count: 3, offset: 0, has_more: false, results: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
  ]);
  expect(audit.outcome).toBe("grounded");
});

test("extremum + class-mode atlas_first_seen whose oldest includes the UUID → grounded", () => {
  const audit = auditCompleteness(Q, `The oldest Rate Limit is ${WINNER}, first-seen 2025-11-07.`, [
    ev("atlas_first_seen", { title: "Rate Limit" }, {
      class_total: 400,
      class_with_history: 390,
      event: "added",
      oldest: [{ uuid: WINNER, date: "2025-11-07" }],
      undated: [],
    }),
  ]);
  expect(audit.outcome).toBe("grounded");
});

test("extremum + ids-mode atlas_first_seen on a search-sized batch → fail", () => {
  const audit = auditCompleteness(Q, `The oldest is ${WINNER}.`, [
    ev("atlas_search", { query: "rate limit" }, { results: [{ id: "a" }] }),
    ev("atlas_first_seen", { ids: ["a", "b", "c"] }, { results: [{ first_seen: "2026-07-10" }] }),
  ]);
  expect(audit.outcome).toBe("unverified");
});

test("truncated or has_more filter listing does not ground", () => {
  const more = auditCompleteness("List all rate limits.", "These are all 400 Rate Limit ids.", [
    ev("atlas_filter", { title: "Rate Limit" }, { total: 400, count: 50, offset: 0, has_more: true, results: [] }),
  ]);
  expect(more.outcome).toBe("unverified");
  const clip = auditCompleteness("List all rate limits.", "These are all 400 Rate Limit ids.", [
    ev("atlas_filter", { title: "Rate Limit" }, { total: 400, count: 20, offset: 0, has_more: false, truncated: true, results: [] }),
  ]);
  expect(clip.outcome).toBe("unverified");
});

test("refuted when claimed all-N disagrees with listing total", () => {
  const audit = auditCompleteness("How many Rate Limit docs are there?", "There are all 3 Rate Limit docs.", [
    ev("atlas_filter", { title: "Rate Limit" }, { total: 400, count: 400, offset: 0, has_more: false, results: [] }),
  ]);
  expect(audit.outcome).toBe("refuted");
});

test("non-exhaustive Q is a no-op even with a unique-oldest-sounding answer", () => {
  expect(auditCompleteness("What is a Rate Limit?", "The oldest definition is in the glossary.", []).outcome).toBe("noop");
});

test("scoreCompletenessToolChoice fails search-first and ids-mode first_seen", () => {
  expect(
    scoreCompletenessToolChoice(Q, [{ name: "atlas_search", args: { query: "rate limit" } }]).pass,
  ).toBe(false);
  expect(
    scoreCompletenessToolChoice(Q, [
      { name: "atlas_search", args: { query: "rate limit" } },
      { name: "atlas_first_seen", args: { ids: ["a", "b"] } },
    ]).pass,
  ).toBe(false);
  expect(
    scoreCompletenessToolChoice(Q, [{ name: "atlas_first_seen", args: { title: "Rate Limit" } }]).pass,
  ).toBe(true);
  expect(
    scoreCompletenessToolChoice("What are all rate limit ids?", [
      { name: "atlas_filter", args: { title: "Rate Limit" }, result: { total: 10, has_more: false } },
    ]).pass,
  ).toBe(true);
  expect(
    scoreCompletenessToolChoice("What are all rate limit ids?", [
      { name: "atlas_filter", args: { title: "Rate Limit" }, result: { total: 400, has_more: true } },
    ]).pass,
  ).toBe(false);
});
