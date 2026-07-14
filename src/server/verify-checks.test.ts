// Deterministic answer-check tests. Uses the real disk indexes (like
// chat-loop.test.ts) so citation-UUID validity runs against actual docs.
import { test, expect } from "bun:test";
import { loadIndexes } from "./indexes.ts";
import {
  extractCitations,
  findBareAtlasLinks,
  findInvalidCitationUuids,
  countUncitedParagraphs,
  extractQuotedSpans,
  findUngroundedQuotes,
  runDeterministicChecks,
} from "./verify-checks.ts";

const ix = loadIndexes();
const realUuid = ix.docMap.keys().next().value as string;
const realDoc = ix.docMap.get(realUuid)!;
const FAKE_UUID = "00000000-dead-beef-0000-000000000000";

test("extractCitations pulls title + uuid from the citation link format", () => {
  const answer = `Per [Some Doc](/atlas/${realUuid}) it applies. Unrelated [ext](https://x.com).`;
  expect(extractCitations(answer)).toEqual([{ title: "Some Doc", uuid: realUuid.toLowerCase() }]);
});

test("invalid citation uuids: unknown uuid flagged, real one passes", () => {
  const cites = extractCitations(`[A](/atlas/${realUuid}) and [B](/atlas/${FAKE_UUID})`);
  expect(findInvalidCitationUuids(cites, ix)).toEqual([FAKE_UUID]);
});

test("bare atlas links (doc_no / truncated uuid hrefs) are flagged", () => {
  const answer = `See [X](/atlas/A.1.6) and [Y](/atlas/${realUuid}).`;
  expect(findBareAtlasLinks(answer)).toEqual(["/atlas/A.1.6"]);
});

test("uncited substantive paragraphs are counted; short/cited/heading ones are not", () => {
  const long = "This is a substantive factual paragraph making several claims about governance rules and processes. ".repeat(2);
  const answer = [`# Heading`, long, `${long} [Doc](/atlas/${realUuid})`, "Short line."].join("\n\n");
  expect(countUncitedParagraphs(answer)).toBe(1);
});

test("quoted spans: blockquotes + long inline quotes, normalized, deduped", () => {
  const answer = ['> The Stability Scope *governs* the   protocol rates', 'Also "short quote" and "a sufficiently long inline quotation here".'].join("\n");
  const spans = extractQuotedSpans(answer);
  expect(spans).toContain("the stability scope governs the protocol rates");
  expect(spans).toContain("a sufficiently long inline quotation here");
  expect(spans.some((s) => s === "short quote")).toBe(false);
});

test("blockquote attribution (— [Title](/atlas/…)) is authoring, not quotation", () => {
  // The live false positive from the harness smoke test: a grounded quote
  // failed because the trailing citation rode inside the blockquote line.
  const evidence = ['{"content":"The Accessibility Scope governs accessibility and distribution efforts, and regulates user-facing frontends."}'];
  const answer = `> **The Accessibility Scope governs accessibility and distribution efforts, and regulates user-facing frontends.** — [The Accessibility Scope](/atlas/${realUuid})`;
  expect(findUngroundedQuotes(answer, evidence, ix)).toEqual([]);
  // Inline links inside a quote collapse to their text for matching.
  const inline = `> The [Accessibility Scope](/atlas/${realUuid}) governs accessibility and distribution efforts, and regulates user-facing frontends.`;
  expect(findUngroundedQuotes(inline, evidence, ix)).toEqual([]);
});

test("quote grounding: found in evidence or cited doc content; invented quote flagged", () => {
  const evidence = ['{"content":"The Stability Scope governs the protocol rates for all instances."}'];
  const grounded = '> The Stability Scope governs the protocol rates';
  const invented = '> Facilitators may unilaterally seize treasury funds whenever convenient';
  expect(findUngroundedQuotes(grounded, evidence, ix)).toEqual([]);
  expect(findUngroundedQuotes(invented, evidence, ix)).toHaveLength(1);
  // A quote lifted verbatim from a CITED doc's content is grounded even
  // without tool evidence.
  const docLine = realDoc.content.split("\n").map((l) => l.trim()).find((l) => l.length >= 40);
  if (docLine) {
    const citedQuote = `> ${docLine.slice(0, 80)}\n\n[${realDoc.title}](/atlas/${realUuid})`;
    expect(findUngroundedQuotes(citedQuote, [], ix)).toEqual([]);
  }
});

test("runDeterministicChecks: failed only on invalid citations or ungrounded quotes", () => {
  const clean = runDeterministicChecks(`All good. [Doc](/atlas/${realUuid})`, [], ix);
  expect(clean.failed).toBe(false);

  const badCite = runDeterministicChecks(`Claim. [Doc](/atlas/${FAKE_UUID})`, [], ix);
  expect(badCite.failed).toBe(true);
  expect(badCite.invalidCitations).toEqual([FAKE_UUID]);

  const badQuote = runDeterministicChecks('> Entirely fabricated verbatim quotation about governance rules', [], ix);
  expect(badQuote.failed).toBe(true);
  expect(badQuote.ungroundedQuotes).toHaveLength(1);
});
