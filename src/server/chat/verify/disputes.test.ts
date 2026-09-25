// Tests for the two-lane dispute reconciliation module (see disputes.ts's
// header for the full design). Both exports are pure/synchronous — no
// network, no DB — so literal fixtures are enough.
import { test, expect } from "bun:test";
import { agreedContradictionsFrom, withoutDisputedMarks, type AgreedContradiction } from "./disputes.ts";
import type { CitationMark } from "./citation-marks.ts";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const backedMark: CitationMark = { status: "backed", claims: [{ claim: "x", verdict: "supports" }], confidence: 0.9 };
const disputedMark: CitationMark = { status: "disputed", claims: [{ claim: "x", verdict: "contradicts" }], confidence: 0.7 };
const unbackedMark: CitationMark = { status: "uncovered", claims: [{ claim: "x", verdict: "says_nothing" }], confidence: null };

// ── agreedContradictionsFrom ────────────────────────────────────────────────

test("agreedContradictionsFrom: keeps an agreed:true candidate, in the wire shape", () => {
  const verdict = {
    contradictions: [{ answer_span: "a", evidence_span: "ea", why: "wa", uuid: UUID_A, agreed: true }],
  };
  expect(agreedContradictionsFrom(verdict)).toEqual([{ answer: "a", evidence: "ea", why: "wa", uuid: UUID_A }]);
});

// This is the hard rule verifier.ts's computeOverall documents: an unagreed
// candidate must never reach a reader. It stays only in the persisted Verdict
// (message_checks.verdict) as the confirm gate's calibration record.
test("agreedContradictionsFrom: an agreed:false candidate never survives, even alone", () => {
  const verdict = { contradictions: [{ answer_span: "a", evidence_span: "ea", why: "wa", uuid: UUID_A, agreed: false }] };
  expect(agreedContradictionsFrom(verdict)).toEqual([]);
});

test("agreedContradictionsFrom: a mixed list keeps only the agreed candidate", () => {
  const verdict = {
    contradictions: [
      { answer_span: "a", evidence_span: "ea", why: "wa", uuid: UUID_A, agreed: true },
      { answer_span: "b", evidence_span: "eb", why: "wb", uuid: UUID_B, agreed: false },
    ],
  };
  expect(agreedContradictionsFrom(verdict)).toEqual([{ answer: "a", evidence: "ea", why: "wa", uuid: UUID_A }]);
});

test("agreedContradictionsFrom: degrades to [] on malformed/missing payloads without throwing", () => {
  const bad: unknown[] = [
    null,
    undefined,
    "a string",
    42,
    true,
    {}, // no contradictions key at all
    { contradictions: null },
    { contradictions: undefined },
    { contradictions: "not an array" },
    { contradictions: 5 },
    { contradictions: [null, "nope", 5, true] }, // non-object entries
    { contradictions: [{ agreed: true }] }, // missing both spans
    { contradictions: [{ answer_span: 5, evidence_span: "x", agreed: true }] }, // wrong-typed span
    { contradictions: [{ answer_span: "x", evidence_span: 5, agreed: true }] }, // wrong-typed span
  ];
  for (const v of bad) {
    expect(() => agreedContradictionsFrom(v)).not.toThrow();
    expect(agreedContradictionsFrom(v)).toEqual([]);
  }
});

test("agreedContradictionsFrom: a null uuid survives into the parse — it just disputes nothing downstream", () => {
  const verdict = { contradictions: [{ answer_span: "a", evidence_span: "ea", why: "wa", uuid: null, agreed: true }] };
  expect(agreedContradictionsFrom(verdict)).toEqual([{ answer: "a", evidence: "ea", why: "wa", uuid: null }]);
});

test("agreedContradictionsFrom: a missing/non-string uuid also degrades to null, not a throw", () => {
  const verdict = { contradictions: [{ answer_span: "a", evidence_span: "ea", why: "wa", agreed: true }] };
  expect(agreedContradictionsFrom(verdict)[0].uuid).toBeNull();
});

test("agreedContradictionsFrom: `why` defaults to empty string when missing or non-string", () => {
  const missing = { contradictions: [{ answer_span: "a", evidence_span: "ea", uuid: UUID_A, agreed: true }] };
  expect(agreedContradictionsFrom(missing)[0].why).toBe("");
  const wrongType = { contradictions: [{ answer_span: "a", evidence_span: "ea", why: 7, uuid: UUID_A, agreed: true }] };
  expect(agreedContradictionsFrom(wrongType)[0].why).toBe("");
});

// ── withoutDisputedMarks ─────────────────────────────────────────────────────

test("withoutDisputedMarks: drops a `backed` mark whose uuid has an agreed contradiction, leaves other docs alone", () => {
  const marks = { [UUID_A]: backedMark, [UUID_B]: backedMark };
  const contradictions: AgreedContradiction[] = [{ answer: "a", evidence: "e", why: "w", uuid: UUID_A }];
  const out = withoutDisputedMarks(marks, contradictions);
  expect(out[UUID_A]).toBeUndefined();
  expect(out[UUID_B]).toEqual(backedMark);
});

// Only `backed` is withheld — `disputed` means the two lanes already agree,
// and `unbacked` asserts no support (not in conflict with a dispute).
test("withoutDisputedMarks: leaves a `disputed` mark on the same uuid alone", () => {
  const marks = { [UUID_A]: disputedMark };
  const contradictions: AgreedContradiction[] = [{ answer: "a", evidence: "e", why: "w", uuid: UUID_A }];
  expect(withoutDisputedMarks(marks, contradictions)).toEqual(marks);
});

test("withoutDisputedMarks: leaves an `unbacked` mark on the same uuid alone", () => {
  const marks = { [UUID_A]: unbackedMark };
  const contradictions: AgreedContradiction[] = [{ answer: "a", evidence: "e", why: "w", uuid: UUID_A }];
  expect(withoutDisputedMarks(marks, contradictions)).toEqual(marks);
});

test("withoutDisputedMarks: a null-uuid contradiction disputes nothing", () => {
  const marks = { [UUID_A]: backedMark };
  const contradictions: AgreedContradiction[] = [{ answer: "a", evidence: "e", why: "w", uuid: null }];
  expect(withoutDisputedMarks(marks, contradictions)).toBe(marks);
});

test("withoutDisputedMarks: returns the SAME object reference when there are no contradictions", () => {
  const marks = { [UUID_A]: backedMark };
  expect(withoutDisputedMarks(marks, [])).toBe(marks);
});

test("withoutDisputedMarks: returns the SAME object reference when contradictions exist but none collide with a backed mark", () => {
  const marks = { [UUID_A]: disputedMark, [UUID_B]: unbackedMark };
  const contradictions: AgreedContradiction[] = [{ answer: "a", evidence: "e", why: "w", uuid: UUID_A }];
  expect(withoutDisputedMarks(marks, contradictions)).toBe(marks);
});

test("withoutDisputedMarks: an empty marks object returns the same reference regardless of contradictions", () => {
  const marks: Record<string, CitationMark> = {};
  const contradictions: AgreedContradiction[] = [{ answer: "a", evidence: "e", why: "w", uuid: UUID_A }];
  expect(withoutDisputedMarks(marks, contradictions)).toBe(marks);
});
