// Span-validation is the whole point of the sliced design: it is the code
// backstop that stops a model asserting support into existence.
import { test, expect } from "bun:test";
import { validateSpans, parseSlice, parseJsonish, closeTruncatedJson, repairStatus, buildSlicePrompt, SLICE_NEEDS_EVIDENCE, spanOverlap, type SliceClaim } from "./verifier-slices.ts";

const EVIDENCE = [
  '{"content":"The documents herein contain all data and specifications for Spark\'s Instances of the Pioneer Chain Primitive."}',
  '{"doc":"A.6.1.1.1.2.5.3.1.1","content":"`Inactive`"}',
];
const claim = (over: Partial<SliceClaim>): SliceClaim => ({ claim: "c", status: "supported", span: "", ...over });

test("a fabricated span cannot buy support — the pioneers failure", () => {
  // haiku passed the real defect by asserting this claim supported off
  // scaffold boilerplate. With spans required, no exact quote establishes it.
  const out = validateSpans([claim({ claim: "Spark is a Pioneer", span: "Spark has an active Pioneer Chain instance" })], EVIDENCE);
  expect(out[0].status).toBe("unsupported");
  expect(out[0].spanValid).toBe(false);
});

test("fuzzy spans: imperfect copying is forgiven, fabrication is not", () => {
  // The 2026-07-15 grid showed exact-containment graded TRANSCRIPTION, not
  // judgment: gemma/haiku spanKill 22-56 → FPR 50-75%. A slightly-off copy of
  // real evidence must survive.
  const sloppy = validateSpans([claim({ claim: "container", span: "contains all data and specification for Spark Instances of the Pioneer Chain Primitive" })], EVIDENCE);
  expect(sloppy[0].status).toBe("supported");
  expect(sloppy[0].spanScore).toBeGreaterThanOrEqual(0.8);

  // ...but the fabricated span that started all this must STILL be rejected:
  // its words are topical, yet they never occur together in the evidence.
  const fake = validateSpans([claim({ claim: "Spark is a Pioneer", span: "Spark has an active Pioneer Chain instance" })], EVIDENCE);
  expect(fake[0].status).toBe("unsupported");
  expect(fake[0].spanScore).toBeLessThan(0.8);
});

test("spanOverlap requires LOCALITY, not just vocabulary", () => {
  // A bag-of-words check over the whole evidence would pass any span built
  // from words that appear somewhere. The sliding window is what stops that.
  const hay = "the alpha document is here. many unrelated words fill the gap. the beta document is there.";
  expect(spanOverlap("the alpha document is here", hay)).toBe(1);
  expect(spanOverlap("the alpha document is there", hay)).toBeLessThan(1);
  // every word exists in the haystack, but never together:
  expect(spanOverlap("alpha beta document", hay)).toBeLessThan(0.8);
  expect(spanOverlap("", hay)).toBe(0);
});

test("a genuine verbatim span is honoured, across casing and markdown noise", () => {
  const out = validateSpans([claim({ claim: "container exists", span: "all data and specifications for Spark's Instances" })], EVIDENCE);
  expect(out[0].status).toBe("supported");
  expect(out[0].spanValid).toBe(true);
});

test("an empty or trivial span never counts as support", () => {
  for (const span of ["", "  ", "yes", "Active"]) {
    expect(validateSpans([claim({ span })], EVIDENCE)[0].status).toBe("unsupported");
  }
});

test("unsupported/contradicted verdicts pass through untouched", () => {
  const out = validateSpans([claim({ status: "contradicted", span: "" }), claim({ status: "unsupported", span: "" })], EVIDENCE);
  expect(out.map((c) => c.status)).toEqual(["contradicted", "unsupported"]);
});

test("an absence claim is supported WITHOUT a span — honesty must not be punished", () => {
  // Found in the first live slice run: span validation forced down the true,
  // honest claim "The Atlas does not specify which chains" — you cannot quote
  // absence. Same trap the quote checker fell into eleven times.
  const out = validateSpans([claim({ claim: "The Atlas does not specify which chains", span: "", absence: true })], EVIDENCE);
  expect(out[0].status).toBe("supported");
  expect(out[0].spanValid).toBe(true);
  // But `absence` must not become a universal escape hatch for real assertions.
  const abuse = validateSpans([claim({ claim: "Spark is a Pioneer", span: "invented text", absence: false })], EVIDENCE);
  expect(abuse[0].status).toBe("unsupported");
});

test("figures may show arithmetic instead of a quotation", () => {
  const out = validateSpans([claim({ claim: "0.5% total", span: "0.2% + 0.3% = 0.5%" })], EVIDENCE);
  expect(out[0].status).toBe("supported");
});

test("parseSlice tolerates fences and salvages the object", () => {
  const p = parseSlice('```json\n{"claims":[{"claim":"x","status":"supported","span":"y"}],"ruling_issued":true,"notes":"n"}\n```');
  expect(p?.claims).toHaveLength(1);
  expect(p?.rulingIssued).toBe(true);
  expect(parseSlice("not json at all")).toBeNull();
});

test("overreach carries no evidence — it judges stance, not facts", () => {
  expect(SLICE_NEEDS_EVIDENCE.overreach).toBe(false);
  const msgs = buildSlicePrompt("overreach", { question: "q", answer: "a", evidence: [{ label: "[E1]", tool: "t", args: "", content: "SECRET" }] });
  expect(JSON.stringify(msgs)).not.toContain("SECRET");
  const withEv = buildSlicePrompt("claims", { question: "q", answer: "a", evidence: [{ label: "[E1]", tool: "t", args: "", content: "SECRET" }] });
  expect(JSON.stringify(withEv)).toContain("SECRET");
});

test("the figures worklist rides in the prompt", () => {
  const msgs = buildSlicePrompt("figures", { question: "q", answer: "a", evidence: [], worklist: ["250000", "0.5"] });
  expect(JSON.stringify(msgs)).toContain("250000");
});

// (1)+(2) Reference evidence — injected context, not retrieved atlas text.
// Summarising it is its intended use, so the verbatim-substring bar would make
// a faithful restatement `unsupported` by construction.
const refEv = (sourceClass: "atlas" | "reference") => [
  { label: "[E1]", tool: "atlas_prefetch", args: "{}", content: "The app has reports and a radar view.", sourceClass },
];

test("marks reference entries so the judge can tell them from retrieved atlas text", () => {
  const [, user] = buildSlicePrompt("claims", { question: "q", answer: "a", evidence: refEv("reference") });
  expect(String(user.content)).toContain("[E1] [REFERENCE]");
});

test("does not mark ordinary atlas retrievals as reference", () => {
  const [, user] = buildSlicePrompt("claims", { question: "q", answer: "a", evidence: refEv("atlas") });
  expect(String(user.content)).not.toContain("[REFERENCE]");
});

test("tells the judge a faithful summary of reference evidence is supported", () => {
  const [system] = buildSlicePrompt("claims", { question: "q", answer: "a", evidence: refEv("reference") });
  expect(String(system.content)).toContain("EXCEPTION — reference evidence");
  expect(String(system.content)).toMatch(/DESCRIPTIVE claim that faithfully restates/);
});

// The exemption must not become a hole: anything checkable still needs a span.
test("keeps figures, quotes, addresses, doc numbers and citations on exact spans", () => {
  const [system] = buildSlicePrompt("claims", { question: "q", answer: "a", evidence: refEv("reference") });
  expect(String(system.content)).toMatch(
    /figures, dates, amounts, on-chain addresses, document numbers, quoted atlas text and citations still require an EXACT verbatim span/,
  );
});

// ── Messy-JSON repair + status repair-or-drop ──────────────────────────────
// A status we could not READ must never become a claim we JUDGED unsupported:
// unsupported claims drive the warn verdict and feed the advisor-escalation
// threshold, so a parse defect would manufacture evidence against the answer.

test("an unreadable status drops the claim instead of assuming unsupported", () => {
  const r = parseSlice(JSON.stringify({ claims: [{ claim: "X is true", span: "X" }] }));
  expect(r?.claims).toEqual([]);
});

test("a status differing only by case or whitespace is normalised, not dropped", () => {
  const r = parseSlice(JSON.stringify({ claims: [{ claim: "X", status: "  Supported ", span: "X" }] }));
  expect(r?.claims.map((c) => c.status)).toEqual(["supported"]);
});

test("a genuine unsupported verdict is untouched", () => {
  const r = parseSlice(JSON.stringify({ claims: [{ claim: "X", status: "unsupported", span: "" }] }));
  expect(r?.claims.map((c) => c.status)).toEqual(["unsupported"]);
});

// The exact production corruption: over-escaped quotes made one claim swallow
// the next one's fields, so the outer object lost its status and the old
// default recorded a SUPPORTED claim as unsupported.
test("recovers a status that leaked into the claim text, and cleans the text", () => {
  const leaked = { claims: [{ claim: 'Immutable Documents are part of the Atlas","status":"supported","span":"It consists of…","absence":false},{' }] };
  const r = parseSlice(JSON.stringify(leaked));
  expect(r?.claims.map((c) => c.status)).toEqual(["supported"]);
  expect(r?.claims[0].claim).toBe("Immutable Documents are part of the Atlas");
});

test("repairStatus returns null only when nothing can be read", () => {
  expect(repairStatus({ status: "contradicted" })).toBe("contradicted");
  expect(repairStatus({ status: "nonsense", claim: "no hints here" })).toBeNull();
});

// Output caps cut JSON mid-structure routinely. The claims already emitted are
// good — discarding the whole slice over the tail loses real judgements.
test("salvages complete claims from a generation truncated mid-object", () => {
  const truncated = '{"claims":[{"claim":"A is true","status":"supported","span":"A"},{"claim":"B is tr';
  const r = parseSlice(truncated);
  expect(r?.claims.map((c) => c.claim)).toEqual(["A is true"]);
});

test("closeTruncatedJson ignores braces inside quoted strings", () => {
  expect(closeTruncatedJson('{"a":"a { brace"')).toBe('{"a":"a { brace"}');
  expect(closeTruncatedJson('{"a":"unterminated')).toBe('{"a":"unterminated"}');
});

test("parseJsonish tolerates trailing commas and prose after the JSON", () => {
  expect(parseJsonish('{"claims":[],}')).toEqual({ claims: [] });
  expect(parseJsonish('```json\n{"ok":true}\n```\nHope this helps!')).toEqual({ ok: true });
});

test("parseJsonish still returns null when there is no object at all", () => {
  expect(parseJsonish("I could not complete this audit.")).toBeNull();
});
