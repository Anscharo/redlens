// Refute-slice unit tests: prompt shape, parsing, and the code backstop
// (validateContradictions) that re-checks both spans before a candidate can
// ever reach the confirm gate.
import { describe, test, expect } from "bun:test";
import { buildRefutePrompt, parseRefute, validateContradictions } from "./refute.ts";
import type { EvidenceEntry } from "./verifier.ts";

const ev = (content: string, sourceClass?: "atlas" | "reference" | "external"): EvidenceEntry =>
  ({ label: "[E1]", tool: "atlas_get", args: "{}", content, sourceClass });

test("buildRefutePrompt marks [REFERENCE] entries so the judge can tell them from retrieved atlas text", () => {
  const [, user] = buildRefutePrompt({ question: "q", answer: "a", evidence: [ev("The app has reports.", "reference")] });
  expect(String(user.content)).toContain("[E1] [REFERENCE]");
  const [, plain] = buildRefutePrompt({ question: "q", answer: "a", evidence: [ev("some atlas text", "atlas")] });
  expect(String(plain.content)).not.toContain("[REFERENCE]");
});

test("buildRefutePrompt lists no evidence gracefully", () => {
  const [, user] = buildRefutePrompt({ question: "q", answer: "a", evidence: [] });
  expect(String(user.content)).toContain("no tools were called");
});

test("parseRefute salvages fenced JSON, drops rows missing a span, caps not_found at 5", () => {
  const text = [
    "```json",
    JSON.stringify({
      contradictions: [
        { answer_span: "X is 5", evidence_span: "X is 7", why: "different value" },
        { answer_span: "no evidence span here", why: "missing evidence_span" }, // dropped
        { evidence_span: "no answer span", why: "missing answer_span" }, // dropped
      ],
      not_found: ["a", "b", "c", "d", "e", "f", "g"],
      notes: "n",
    }),
    "```",
  ].join("\n");
  const parsed = parseRefute(text)!;
  expect(parsed.contradictions).toHaveLength(1);
  expect(parsed.contradictions[0].answer_span).toBe("X is 5");
  expect(parsed.notFound).toHaveLength(5);
  expect(parsed.notes).toBe("n");
});

test("parseRefute returns null on unparseable text", () => {
  expect(parseRefute("not json at all")).toBeNull();
});

test("validateContradictions: an answer_span whose link markup the judge dropped still validates", () => {
  const answer = "The [Radar](/atlas/00000000-0000-0000-0000-000000000000) view shows agents live.";
  const raw = [{ answer_span: "The Radar view shows agents live.", evidence_span: "Radar shows agents dead, not live.", why: "status differs" }];
  const evidence = [ev("Radar shows agents dead, not live.")];
  const { kept, discarded } = validateContradictions(raw, answer, evidence);
  expect(discarded).toBe(0);
  expect(kept).toHaveLength(1);
  expect(kept[0].evidence_label).toBe("[E1]");
});

// The exact 0.8 boundary: 5-token span with 4 matched tokens in the SAME
// window scores exactly 0.8 (kept, >=); a 24-token span with 19 matched
// scores 19/24 = 0.7916... (discarded, <). Values locked via spanOverlap
// itself (span-match.test.ts covers the function; this only needs the
// threshold's edge to land where validateContradictions reads it).
test("evidence-span overlap: 0.8 is kept, 0.79 is discarded", () => {
  const answer = "alpha bravo charlie delta echo is what the answer states.";
  const kept5 = validateContradictions(
    [{ answer_span: answer, evidence_span: "alpha bravo charlie delta echo", why: "w" }],
    answer,
    [ev("alpha bravo charlie delta zulu")], // 4/5 tokens match → exactly 0.8
  );
  expect(kept5.kept).toHaveLength(1);
  expect(kept5.discarded).toBe(0);

  const words = Array.from({ length: 24 }, (_, i) => `w${i}`);
  const hay = words.join(" ");
  const spanWords = words.slice();
  for (const i of [2, 7, 12, 17, 22]) spanWords[i] = `x${i}`;
  const span24 = spanWords.join(" ");
  const answer24 = `The answer states: ${span24}.`;
  const below = validateContradictions(
    [{ answer_span: answer24, evidence_span: span24, why: "w" }],
    answer24,
    [ev(hay)], // 19/24 tokens match → 0.7916..., below the 0.8 bar
  );
  expect(below.kept).toHaveLength(0);
  expect(below.discarded).toBe(1);
});

test("uuid resolution: the nearest id/uuid field preceding the matched span inside its entry", () => {
  const content = JSON.stringify([
    { id: "11111111-1111-1111-1111-111111111111", content: "Unrelated row." },
    { id: "22222222-2222-2222-2222-222222222222", content: "The signer threshold is 5 of 9." },
  ]);
  const answer = "The threshold is 7 of 9.";
  const raw = [{ answer_span: answer, evidence_span: "The signer threshold is 5 of 9.", why: "count differs" }];
  const { kept } = validateContradictions(raw, answer, [ev(content)]);
  expect(kept).toHaveLength(1);
  expect(kept[0].uuid).toBe("22222222-2222-2222-2222-222222222222");
});

test("uuid resolution: no id field anywhere in the entry → null, never affects the verdict", () => {
  const answer = "The threshold is 7 of 9.";
  const raw = [{ answer_span: answer, evidence_span: "The threshold is 5 of 9.", why: "count differs" }];
  const { kept } = validateContradictions(raw, answer, [ev("The threshold is 5 of 9.")]);
  expect(kept).toHaveLength(1);
  expect(kept[0].uuid).toBeNull();
});

test("validateContradictions: an unlocatable evidence_span is discarded, never demoted-and-kept", () => {
  const answer = "Spark is a Pioneer.";
  const { kept, discarded } = validateContradictions(
    [{ answer_span: answer, evidence_span: "Spark has an active Pioneer Chain instance", why: "w" }],
    answer,
    [ev("The documents herein contain all data and specifications for Spark's Instances of the Pioneer Chain Primitive.")],
  );
  expect(kept).toHaveLength(0);
  expect(discarded).toBe(1);
});

test("validateContradictions: an unlocatable answer_span is discarded even when the evidence span is real", () => {
  const { kept, discarded } = validateContradictions(
    [{ answer_span: "This sentence never appeared in the answer at all.", evidence_span: "real evidence text", why: "w" }],
    "The actual answer says something completely different.",
    [ev("real evidence text")],
  );
  expect(kept).toHaveLength(0);
  expect(discarded).toBe(1);
});

describe("validateNotFound", () => {
  const evidence = [
    { label: "[E1]", tool: "atlas_get", args: "{}", content: JSON.stringify({ content: "The Sky Savings Rate (\"SSR\") is the rate that USDS holders can earn on their USDS within the Sky Savings Rate smart contracts." }) },
  ];
  test("drops an entry the evidence covers, and a bare topic that is not a statement", async () => {
    const { validateNotFound } = await import("./refute.ts");
    expect(validateNotFound(["the savings rate"], evidence)).toEqual([]); // topic, and covered
    expect(validateNotFound(["USDS holders can earn the rate within the Sky Savings Rate smart contracts"], evidence)).toEqual([]); // covered
  });
  test("keeps a full statement the evidence genuinely does not cover", async () => {
    const { validateNotFound } = await import("./refute.ts");
    const claim = "Aligned Delegates are paid a fixed retainer from the Accessibility Reserve every quarter";
    expect(validateNotFound([claim], evidence)).toEqual([claim]);
  });
});
