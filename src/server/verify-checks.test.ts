// Deterministic answer-check tests. Uses the real disk indexes (like
// chat-loop.test.ts) so citation-UUID validity runs against actual docs.
import { test, expect } from "bun:test";
import { loadIndexes } from "./indexes.ts";
import {
  extractCitations,
  findBareAtlasLinks,
  findInvalidCitationUuids,
  extractDocNoMentions,
  findInvalidDocNos,
  findDocNoMismatches,
  countUncitedParagraphs,
  extractQuotedSpans,
  normalizeForMatch,
  findUngroundedAddresses,
  findUntracedNumbers,
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

test("quotation conventions: ellipsis, editorial brackets, hugging punctuation", () => {
  const evidence = ['{"content":"The standard Distribution Reward rate is set at 0.2%. The rate is annualized on all USDS balances associated with the relevant Reward Code."}'];
  // Elision: both segments are real source text, just non-contiguous.
  const elided = '> "The standard Distribution Reward rate is set at 0.2%... annualized on all USDS balances associated with the relevant Reward Code."';
  expect(findUngroundedQuotes(elided, evidence, ix)).toEqual([]);
  // Editorial insertion + trailing comma inside the quotes.
  const bracketed = 'It pays "Distribution Reward rate is set at [exactly] 0.2%," per the doc.';
  expect(findUngroundedQuotes(bracketed, evidence, ix)).toEqual([]);
  // A genuinely altered segment still fails even alongside a grounded one.
  const misquoted = '> "The standard Distrib. Reward rate is set at 0.2%... annualized on all USDS balances associated with the relevant Reward Code."';
  expect(findUngroundedQuotes(misquoted, evidence, ix)).not.toEqual([]);
});

test("quotes inside adjacent link titles never pair into phantom quotes", () => {
  // The live false positive: quoted PR titles inside consecutive markdown
  // links made the inline regex capture hrefs + prose BETWEEN the links.
  const answer = 'Routine PRs (e.g. [PR #133 "Weekly edits batch one 2025-11-17"](https://github.com/x/pull/133), [PR #121 "Weekly edits batch two 2025-11-03"](https://github.com/x/pull/121)) landed.';
  const spans = extractQuotedSpans(answer);
  expect(spans.some((s) => s.includes("https://") || s.includes("]("))).toBe(false);
  expect(spans).toContain("weekly edits batch one 2025-11-17");
});

test("inner quote marks are typography; one quotation counts once", () => {
  // Live false positive: the atlas writes the term bare, glm quoted it with
  // inner single quotes — faithful quotation, flagged as invented.
  const evidence = ['{"content":"The Chronicle Point Reward Instance refers to the Ethereum mainnet reward mechanism."}'];
  const answer = `> "The 'Chronicle Point Reward Instance' refers to the Ethereum mainnet reward mechanism."`;
  expect(findUngroundedQuotes(answer, evidence, ix)).toEqual([]);
  // The blockquote span and its inner inline span are ONE quotation, not two.
  const bogus = `> "The 'Widget Reward Instance' refers to a completely invented mainnet mechanism."`;
  expect(findUngroundedQuotes(bogus, evidence, ix)).toHaveLength(1);
});

test("a standalone attribution line is authoring, not quotation", () => {
  // The live false positive: glm attributes with BOTH a uuid link and a doc_no
  // on its own blockquote line — and was hard-failed for citing rigorously.
  const evidence = ['{"content":"The standard Distribution Reward rate is set at 0.2%."}'];
  const answer = [
    '> "The standard Distribution Reward rate is set at 0.2%."',
    `> — [Distribution Reward Rate](/atlas/${realUuid}) (A.2.2.9.1.2.1.2)`,
  ].join("\n");
  expect(findUngroundedQuotes(answer, evidence, ix)).toEqual([]);
  // Plain-text attribution (no link) with a doc_no is also authoring.
  const plain = ['> "The standard Distribution Reward rate is set at 0.2%."', "> — Distribution Reward Rate (A.2.2.9.1.2.1.2)"].join("\n");
  expect(findUngroundedQuotes(plain, evidence, ix)).toEqual([]);
  // Same-line attribution with a trailing doc_no.
  const inlineAttr = `> "The standard Distribution Reward rate is set at 0.2%." — [Distribution Reward Rate](/atlas/${realUuid}) (A.2.2.9.1.2.1.2)`;
  expect(findUngroundedQuotes(inlineAttr, evidence, ix)).toEqual([]);
  // A quoted list item starts with a dash but carries no citation — still content.
  const listItem = "> - this is an entirely fabricated quoted list item about governance";
  expect(findUngroundedQuotes(listItem, evidence, ix)).toHaveLength(1);
});

test("evidence markdown links and JSON escapes match a faithful quote", () => {
  // Live false positives: the source carries a markdown link and JSON-escaped
  // newlines; the model quotes the RENDERED text with a real line break.
  const evidence = ['{"content":"The Distribution Reward is paid to Prime Agents. See [A.2.2.9.1 - Distribution Reward Primitive](e632c38f-3e4e-4c7e-acfd-b6ec45a422e6)."}'];
  const quoted = '> "The Distribution Reward is paid to Prime Agents. See A.2.2.9.1 - Distribution Reward Primitive."';
  expect(findUngroundedQuotes(quoted, evidence, ix)).toEqual([]);

  const multiline = ['{"content":"Reserved ranges are:\\n- Skybase: 0, 1, 100\\n- Keel: 2"}'];
  const acrossLines = '> "Reserved ranges are: - Skybase: 0, 1, 100 - Keel: 2"';
  expect(findUngroundedQuotes(acrossLines, multiline, ix)).toEqual([]);

  // A genuine word swap still fails: the source says "set at", not "set to".
  const rate = ['{"content":"The standard Distribution Reward rate is set at 0.2% annually."}'];
  expect(findUngroundedQuotes('> "The standard Distribution Reward rate is set to 0.2% annually."', rate, ix)).toHaveLength(1);
});

test("two quoted terms in one line never pair into the prose between them", () => {
  // Live false positive: "Delegate" is 8 chars, so the {10,} minimum skipped it
  // and desynced pairing — the scan captured the sentence BETWEEN the two terms.
  const evidence = ['{"content":"A Delegate is a recognized actor empowered to exercise governance voting power."}'];
  const answer = 'A "Delegate" is defined as a recognized actor empowered to exercise governance voting power on behalf of SPK holders ("Delegators").';
  const spans = extractQuotedSpans(answer);
  expect(spans.some((s) => s.startsWith("is defined as"))).toBe(false);
  expect(findUngroundedQuotes(answer, evidence, ix)).toEqual([]);
});

test("a denial AFTER the quote also marks it a mention", () => {
  const evidence = ['{"content":"The Distribution Reward doc references USDS and sUSDS."}'];
  // Quoting the question back to say the atlas cannot answer it.
  const q1 = 'Therefore the concrete answer for "sUSDC in every month of 2026" is not available in the Atlas.';
  expect(findUngroundedQuotes(q1, evidence, ix)).toEqual([]);
  // Hypothetical rules offered as examples of what the atlas does NOT contain.
  const q2 = 'If you want a definitive rule (e.g., "Keel receives X% of Distribution Rewards on all bridged USDS" or "Pioneer payments offset Distribution Rewards"), the Atlas is silent about precedence.';
  expect(findUngroundedQuotes(q2, evidence, ix)).toEqual([]);
  // A bare "not" nearby must NOT excuse a real invented quote.
  const real = 'This is not a hypothetical: the doc states "an entirely invented verbatim passage about rates".';
  expect(findUngroundedQuotes(real, evidence, ix)).toHaveLength(1);
});

test("a DENIED quoted term is a mention, not a quotation", () => {
  // The live false positive: the honest "this doesn't exist" answer was hard-
  // failed because the denied term is (necessarily) absent from the evidence.
  const evidence = ['{"content":"Emergency response is coordinated by the Emergency Response Group."}'];
  for (const answer of [
    'The Atlas does not contain an organization called "Ecosystem Research Group".',
    'The Atlas does not mention an "Ecosystem Research Group" anywhere.',
    'There is no "Ecosystem Research Group" defined in the atlas.',
    `The atlas doesn't define an "Ecosystem Research Group".`,
  ]) {
    expect(findUngroundedQuotes(answer, evidence, ix)).toEqual([]);
  }
  // A positive claim still gets checked even with a negation earlier in the
  // sentence (clause break stops the denial window).
  const positive = 'The atlas does not limit the rate; the standard is "a completely invented verbatim passage here".';
  expect(findUngroundedQuotes(positive, evidence, ix)).toHaveLength(1);
  // A long passage under a negation is still checked — only terms qualify.
  const longUnderNegation = 'The atlas does not say "this is an entirely fabricated long verbatim quotation about governance rules and rates".';
  expect(findUngroundedQuotes(longUnderNegation, evidence, ix)).toHaveLength(1);
});

test("a cited doc's TITLE grounds a quote of it", () => {
  const quoted = `The section "${realDoc.title}" is defined in [${realDoc.title}](/atlas/${realUuid}).`;
  if (normalizeForMatch(realDoc.title).length >= 25) {
    expect(findUngroundedQuotes(quoted, [], ix)).toEqual([]);
  }
});

test("addresses must be copied from evidence; checksum casing is cosmetic", () => {
  const real = "0x1234567890AbcdEF1234567890aBcdef12345678";
  const evidence = [`{"address":"${real.toLowerCase()}","role":"pause_proxy"}`];
  // Same address, EIP-55 checksummed in the answer, lowercase in evidence.
  expect(findUngroundedAddresses(`The pause proxy is ${real}.`, evidence)).toEqual([]);
  // One hex digit off — a different contract entirely.
  const wrong = "0x1234567890AbcdEF1234567890aBcdef12345679";
  expect(findUngroundedAddresses(`The pause proxy is ${wrong}.`, evidence)).toEqual([wrong]);
  // A 40-hex run carved out of a longer hash must not match (lookarounds).
  const txHash = "0x" + "a".repeat(64);
  expect(findUngroundedAddresses(`See tx ${txHash}.`, [])).toEqual([]);
  // Solana base58 is case-SENSITIVE — no case folding.
  const sol = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  expect(findUngroundedAddresses(`Vault ${sol}.`, [`{"addr":"${sol}"}`])).toEqual([]);
  expect(findUngroundedAddresses(`Vault ${sol}.`, [`{"addr":"${sol.toLowerCase()}"}`])).toEqual([sol]);
});

test("untraced numbers: soft signal, tolerant of identifiers and small counts", () => {
  const evidence = ['{"content":"The standard rate is set at 0.2%. There are 10,782 documents."}'];
  // Present in evidence (comma normalization applies to both sides).
  expect(findUntracedNumbers("The rate is 0.2% across 10,782 docs.", evidence)).toEqual([]);
  // Small counts are list positions / trivial tallies, never flagged.
  expect(findUntracedNumbers("There are 8 agents and 3 scopes.", evidence)).toEqual([]);
  // Doc numbers and uuid hrefs are identifiers, not claims.
  expect(findUntracedNumbers(`See [X](/atlas/${realUuid}) at A.2.2.9.1.2.1.2.`, evidence)).toEqual([]);
  // A figure that appears nowhere IS surfaced — but softly (see below).
  expect(findUntracedNumbers("The retainer is 250,000 USDS.", evidence)).toEqual(["250000"]);
});

test("untraced numbers never fail a turn; ungrounded addresses always do", () => {
  const evidence = ['{"content":"The standard rate is set at 0.2%."}'];
  const numeric = runDeterministicChecks("A converted rate of 50bps applies.", evidence, ix);
  expect(numeric.untracedNumbers).toEqual(["50"]);
  expect(numeric.failed).toBe(false); // unit conversion is legitimate — verifier adjudicates

  const addr = runDeterministicChecks("Sent to 0xdeadBEEF00000000000000000000000000000001.", evidence, ix);
  expect(addr.ungroundedAddresses).toHaveLength(1);
  expect(addr.failed).toBe(true);
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

test("doc-number mentions: extracted + deduped; version-like strings never match", () => {
  const answer = "See A.1.6 and A.1.6 again, NR-3, and A.2.1.var2 — but v1.2, Q1 2026, 99.9%, and EIP-712 stay out. Ends with A.3.";
  expect(extractDocNoMentions(answer).sort()).toEqual(["A.1.6", "A.2.1.var2", "A.3", "NR-3"]);
});

test("invalid doc numbers: fabricated number flagged, real one passes", () => {
  const FAKE_DOCNO = "Q.99.42.7";
  expect(ix.byDocNo.has(FAKE_DOCNO)).toBe(false);
  const dotted = [...ix.docMap.values()].find((d) => /^[A-Z]{1,3}(\.\d+)+$/.test(d.doc_no))!;
  expect(findInvalidDocNos(`Real ${dotted.doc_no} vs fake ${FAKE_DOCNO}.`, ix)).toEqual([FAKE_DOCNO]);
});

test("doc-number/link mismatch: real-but-wrong number in citation text flagged; matching pair passes", () => {
  const other = [...ix.docMap.values()].find((d) => /^[A-Z]{1,3}(\.\d+)+$/.test(d.doc_no) && d.id !== realUuid)!;
  const mismatched = extractCitations(`[${other.doc_no} - ${realDoc.title}](/atlas/${realUuid})`);
  expect(findDocNoMismatches(mismatched, ix)).toHaveLength(1);
  const matching = extractCitations(`[${other.doc_no} - ${other.title}](/atlas/${other.id})`);
  expect(findDocNoMismatches(matching, ix)).toEqual([]);
  // No leading doc_no in the link text → nothing to compare, no flag.
  const plain = extractCitations(`[${realDoc.title}](/atlas/${realUuid})`);
  expect(findDocNoMismatches(plain, ix)).toEqual([]);
});

test("runDeterministicChecks: fabricated or misattributed doc numbers are hard failures", () => {
  const invented = runDeterministicChecks("The rule lives in Q.99.42.7 of the atlas.", [], ix);
  expect(invented.failed).toBe(true);
  expect(invented.invalidDocNos).toEqual(["Q.99.42.7"]);

  const other = [...ix.docMap.values()].find((d) => /^[A-Z]{1,3}(\.\d+)+$/.test(d.doc_no) && d.id !== realUuid)!;
  const misattributed = runDeterministicChecks(`Per [${other.doc_no} - X](/atlas/${realUuid}).`, [], ix);
  expect(misattributed.failed).toBe(true);
  expect(misattributed.docNoMismatches).toHaveLength(1);
});
