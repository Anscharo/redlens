// The promised-tool lane. Two things matter here and they pull against each
// other: catch a round that announced a lookup it never made, and never touch
// an answer that legitimately needed no lookup at all.
import { test, expect } from "bun:test";
import { announcesUnmadeToolCall, looksLikeAnnouncement, scorableSentences, ANNOUNCEMENT_RE } from "./announcement.ts";
import { config } from "../config.ts";

// The observed 2026-08-20 failure, verbatim. Deliberately not a prototype —
// the lane must catch it on shape, not on having memorised it.
const INCIDENT = [
  "Hello! I'd be happy to help you with that. Since I only answer based on the Sky Atlas,",
  'let me look up the definition and usage of "rate limit ID" for you.',
  "",
  "One moment while I search the atlas.",
].join("\n");

test("catches the answer that shipped a promise instead of a lookup", () => {
  expect(announcesUnmadeToolCall(INCIDENT)).toBe(true);
});

test("catches announcements the regexes never anticipated, via similarity", () => {
  // Phrased around every pattern in ANNOUNCEMENT_RE, so only the embedding can
  // reach them — the same generalization bar complexity.ts's lane is held to.
  // The bakeoff measures the class; these are three of the 12 it labels `hard`.
  const paraphrases = [
    "Sure thing — pulling the relevant governance documents together for you right now.",
    "Happy to help with that. Gathering the details before I answer.",
    "Absolutely — checking the relevant documents now and coming back with what they say.",
  ];
  for (const p of paraphrases) {
    expect(ANNOUNCEMENT_RE.some((re) => re.test(p))).toBe(false); // regex genuinely misses it
    expect(announcesUnmadeToolCall(p)).toBe(true);
  }
});

// Recall is 75% at zero false fires (`pnpm eval:announce`), not 100%, and the
// misses share a shape: a terse announcement whose only content word is a
// generic verb. Pinned so a future prototype/margin change that quietly trades
// false fires for these shows up as a test change rather than a silent drift.
test("terse regex-invisible announcements are a KNOWN miss, not a claim of full recall", () => {
  for (const p of ["On it. Digging through the relevant scope for you.", "Right away — collecting what the atlas records about this."]) {
    expect(announcesUnmadeToolCall(p)).toBe(false);
  }
});

// ── The half that matters more: answers that correctly made no tool call ────
// Every one of these is a real reason a turn ends with zero tool calls. If the
// lane fires on them it burns a round and delays a correct answer.

test("an answer built from injected prefetch material is never even embedded", () => {
  // The features fact's NOTE requires app areas to be linked, so a product
  // answer carries markdown links — isUncheckableAnswer sees one and the gate
  // short-circuits before the lane runs. This is the structural suppressor.
  const productAnswer =
    "You can browse entities on [Radar](/radar), read documents in the [Reader](/atlas), " +
    "and connect an AI assistant from [Connect](/connect).";
  expect(announcesUnmadeToolCall(productAnswer)).toBe(false);
});

test("a link-free product answer still survives, on the similarity lane", () => {
  // Not every product answer links something. This one has nothing checkable
  // in it at all, so it DOES reach the embedding — and must come back false.
  expect(
    announcesUnmadeToolCall("You can search the atlas, browse entities by role, and export any report as a file."),
  ).toBe(false);
});

test("glossary and factual answers are answers, not announcements", () => {
  for (const a of [
    "A Rate Limit ID is a bytes32 key that uniquely identifies a rate limit.",
    "That responsibility sits with the Facilitator, who reviews each submission before it proceeds.",
  ]) {
    expect(announcesUnmadeToolCall(a)).toBe(false);
  }
});

test("clarifying questions, refusals, gap admissions and greetings are left alone", () => {
  for (const a of [
    "Which primitive did you mean — the one in the Stability Scope, or the Accessibility one?",
    "I only answer from the Sky Atlas, so that falls outside what I can cover.",
    "The atlas does not appear to cover that, and I could not find a document naming it.",
    "Hello! I'm the Sky Atlas assistant. How can I help you with the ecosystem's governance today?",
    "Good morning! How can I help you with the Sky Atlas today?",
    "Not much — just here in the Sky Atlas, ready to help you navigate the ecosystem's governance.",
  ]) {
    expect(announcesUnmadeToolCall(a)).toBe(false);
  }
});

test("a clarification wearing an announcement idiom is left alone", () => {
  // The turn ends by asking the user something, so waiting IS the right ending
  // — and this is the one edge the regexes leave open, since /hold on/ does not
  // care what follows it.
  expect(announcesUnmadeToolCall("Hold on — did you mean the Stability Scope, or the Accessibility one?")).toBe(false);
  expect(announcesUnmadeToolCall("One moment: before I look, should I include the history as well?")).toBe(false);
});

test("ordinary answers wearing half an idiom do not fire (2026-09-02 review holes)", () => {
  // Each of these matched the pre-tightening ANNOUNCEMENT_RE: bare `a` in the
  // wait idiom ("a second signer", "a minute of the meeting"), bare `see` after
  // "let me", bare `looking`. They are marker-free follow-ups — exactly the
  // population this gate sees — so they are pinned here AND as eval negatives.
  for (const a of [
    "A second signer must approve before the transaction can proceed.",
    "This is a second copy of the same document.",
    "A minute of the meeting is reserved for objections.",
    "Let me see. The Facilitator reviews each submission before it proceeds.",
    "I am looking at two possible readings of that rule.",
  ]) {
    expect(ANNOUNCEMENT_RE.some((re) => re.test(a))).toBe(false); // regex lane specifically
    expect(announcesUnmadeToolCall(a)).toBe(false); // and the whole gate
  }
  // The anchored forms the tightening must NOT lose:
  expect(announcesUnmadeToolCall("Give me a second to find the right document.")).toBe(true);
  expect(announcesUnmadeToolCall("Absolutely. Let me see what the atlas says about this before I answer.")).toBe(true);
  expect(announcesUnmadeToolCall("I'm looking up the defining document for that parameter.")).toBe(true);
});

test("interjections leading an answer are not waits (follow-up review)", () => {
  // /hold on/ used to fire anywhere the words appeared. Now the idiom needs to
  // BE the whole text or be followed by a first-person retrieval in the same
  // sentence — an interjection opening an actual answer is left alone.
  for (const a of [
    "Hold on, this doesn't add up — the two documents give different thresholds.",
    "Bear with me — the distinction between those two roles is subtle.",
  ]) {
    expect(ANNOUNCEMENT_RE.some((re) => re.test(a))).toBe(false);
    expect(announcesUnmadeToolCall(a)).toBe(false);
  }
  // The genuine waits the anchoring must keep:
  expect(announcesUnmadeToolCall("Hold on.")).toBe(true);
  expect(announcesUnmadeToolCall("Hang on a sec!")).toBe(true);
  expect(announcesUnmadeToolCall("Hold on, I need to consult the governance records first.")).toBe(true);
});

test("an unanchored search verb in a how-to answer does not fire", () => {
  // Why ANNOUNCEMENT_RE is first-person anchored: this sentence is about the
  // app's search, not a promise to go and use it.
  expect(announcesUnmadeToolCall("Searching the atlas is done from the search bar at the top of the page.")).toBe(false);
});

// ── Envelope ───────────────────────────────────────────────────────────────

test("empty content belongs to the compose guard, not this one", () => {
  expect(announcesUnmadeToolCall("")).toBe(false);
  expect(announcesUnmadeToolCall("   \n ")).toBe(false);
});

test("anything checkable is an answer whatever it says around it", () => {
  // The announcement wording is there, but so is a citation — this round DID
  // produce something groundable, so it is not a bare promise.
  expect(
    announcesUnmadeToolCall("Let me check: the threshold is defined in [Threshold Requirements](/atlas/abc-123)."),
  ).toBe(false);
});

test("scoring is per sentence, and fragments below the floor are not scored alone", () => {
  // "Hello!" and "Sure." would drift upward on their own — the floor drops them
  // and the real clause is what gets scored.
  expect(scorableSentences("Hello! I am gathering the details before I answer.")).toEqual([
    "I am gathering the details before I answer.",
  ]);
  // Nothing clears the floor ⇒ the whole text is scored rather than nothing.
  expect(scorableSentences("Yes. No.")).toEqual(["Yes. No."]);
});

test("text shorter than one clause never reaches the embedding", () => {
  // A bare "Answer." scored 0.26 — above the shipped margin — on noise alone,
  // which two orchestrator tests streaming exactly that caught. The regexes
  // still cover short REAL announcements, where the words are the signal.
  expect(announcesUnmadeToolCall("Answer.")).toBe(false);
  expect(announcesUnmadeToolCall("Yes.")).toBe(false);
  expect(announcesUnmadeToolCall("One moment.")).toBe(true); // regex lane
});

test("the kill switch stands the similarity lane down but not the regexes", () => {
  const prev = config.chatFactSimilarity;
  (config as { chatFactSimilarity: boolean }).chatFactSimilarity = false;
  try {
    expect(looksLikeAnnouncement("Fetching what the atlas has on that, back shortly.")).toBe(false);
    expect(announcesUnmadeToolCall(INCIDENT)).toBe(true); // regex lane is unaffected
  } finally {
    (config as { chatFactSimilarity: boolean }).chatFactSimilarity = prev;
  }
});
