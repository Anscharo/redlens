// Deterministic answer-check tests. Uses the real disk indexes (like
// chat-loop.test.ts) so citation-UUID validity runs against actual docs.
import { test, expect } from "bun:test";
import { loadIndexes, buildIndexes } from "../../retrieval/indexes.ts";
import type { AtlasNode } from "../../../types.ts";
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
  findUngroundedCitationValues,
  findUntracedNumbers,
  findUngroundedQuotes,
  findLowOverlapCitations,
  findMscCitedAsAtlas,
  runDeterministicChecks,
} from "./verify-checks.ts";
import { findParamMismatches, formatParamMismatch } from "./param-checks.ts";

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

test("a fully-bolded blockquote callout is the model's own words, not a quotation", () => {
  // The live false positive: an entirely honest answer rendered its bottom line
  // as a bolded blockquote. A self-authored callout can never appear in the
  // evidence, so it hard-failed the turn.
  const evidence = ['{"content":"The Stability Scope governs the protocol rates for all instances."}'];
  const answer = [
    "**Short answer:** the atlas defines this in one place.",
    "",
    "> The Stability Scope governs the protocol rates",
    "",
    `— [Stability Scope](/atlas/${realUuid})`,
    "",
    "> **Bottom line: this is my own one-sentence synthesis of the material above, written as a callout rather than a quotation.**",
  ].join("\n");
  expect(findUngroundedQuotes(answer, evidence, ix)).toEqual([]);
});

test("bold does NOT excuse a blockquote that presents itself as source text", () => {
  // The exemption is a conjunction: fully bold AND no quote marks AND no
  // citation link. Either marker means the model is presenting source text, so
  // a genuine invented quote is still caught however it is styled.
  const evidence = ['{"content":"The Stability Scope governs the protocol rates for all instances."}'];
  // Quote marks inside the bold → still a quotation claim.
  expect(findUngroundedQuotes('> **"Facilitators may unilaterally seize treasury funds whenever convenient."**', evidence, ix)).toHaveLength(1);
  // A citation link on the line → still a quotation claim (attribution path).
  expect(findUngroundedQuotes(`> **Facilitators may unilaterally seize treasury funds whenever convenient.** — [X](/atlas/${realUuid})`, evidence, ix)).toHaveLength(1);
  // Only partially bolded → a quotation with emphasis, not a callout.
  expect(findUngroundedQuotes("> **Note:** facilitators may unilaterally seize treasury funds whenever convenient.", evidence, ix)).toHaveLength(1);
  // Unbolded prose is untouched by the exemption.
  expect(findUngroundedQuotes("> Facilitators may unilaterally seize treasury funds whenever convenient.", evidence, ix)).toHaveLength(1);
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

test("low-overlap citations: soft wrong-doc assist, quiet on prose drawn from the cited doc", () => {
  const doc = [...ix.docMap.values()].find((d) => (d.content ?? "").replace(/\s+/g, " ").trim().length > 400)!;
  // One segment: links stripped, sentence terminators removed so the claim and
  // its citation stay in the same claim unit.
  const fromDoc = doc.content
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ").replace(/[.!?|#>]/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").slice(0, 25).join(" ");
  const cite = `[${doc.title}](/atlas/${doc.id})`;
  expect(findLowOverlapCitations(`${fromDoc}, per ${cite}.`, ix)).toEqual([]);

  // Same shape, same citation — vocabulary that occurs nowhere in the cited doc.
  const offTopic = "The quarterly submarine inspection roster obliges every harbour warden to photograph each trombone before the meteorite auction closes";
  const flagged = findLowOverlapCitations(`${offTopic}, per ${cite}.`, ix);
  expect(flagged).toHaveLength(1);
  expect(flagged[0]).toContain(doc.title);

  // Too few distinctive words to judge → skipped, not guessed at.
  expect(findLowOverlapCitations(`See ${cite}.`, ix)).toEqual([]);
  // A nonexistent uuid belongs to the hard citation check, not this one.
  expect(findLowOverlapCitations(`${offTopic}, per [X](/atlas/${FAKE_UUID}).`, ix)).toEqual([]);
  // Blockquotes are quotations, not claims — the quote check owns them.
  expect(findLowOverlapCitations(`> ${offTopic}, per ${cite}.`, ix)).toEqual([]);
});

test("low-overlap citations: a citation trailing its sentence is still scored", () => {
  const doc = [...ix.docMap.values()].find((d) => (d.content ?? "").replace(/\s+/g, " ").trim().length > 400)!;
  const cite = `[${doc.title}](/atlas/${doc.id})`;
  const offTopic = "The quarterly submarine inspection roster obliges every harbour warden to photograph each trombone before the meteorite auction closes";

  // The shape the system prompt actually asks for — link AFTER the period.
  // Splitting at sentence ends leaves the prose citation-less and the citation
  // prose-less, so before the fold-back both halves escaped the check.
  expect(findLowOverlapCitations(`${offTopic}. ${cite}`, ix)).toHaveLength(1);
  // Attribution on its own line, the convention models use under a quote.
  expect(findLowOverlapCitations(`${offTopic}.\n— ${cite}`, ix)).toHaveLength(1);
  // Inline, mid-sentence, prose continuing after it.
  expect(findLowOverlapCitations(`${offTopic} ${cite} and it applies broadly.`, ix)).toHaveLength(1);

  // Prose drawn from the cited doc stays quiet in the trailing shape too —
  // the fold-back must not manufacture false positives.
  const fromDoc = doc.content
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ").replace(/[.!?|#>]/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").slice(0, 25).join(" ");
  expect(findLowOverlapCitations(`${fromDoc}. ${cite}`, ix)).toEqual([]);

  // A trailing SOURCES LIST is a bibliography, not a claim about the sentence
  // above it: folding those bullets in would flag every entry. Plain `-` bullets
  // are therefore never folded (unlike an em/en-dash attribution).
  expect(findLowOverlapCitations(`${offTopic}.\n\n- ${cite}`, ix)).toEqual([]);
});

test("low-overlap citations never fail a turn — paraphrase legitimately depresses overlap", () => {
  const doc = [...ix.docMap.values()].find((d) => (d.content ?? "").replace(/\s+/g, " ").trim().length > 400)!;
  const report = runDeterministicChecks(
    `The quarterly submarine inspection roster obliges every harbour warden to photograph each trombone, per [${doc.title}](/atlas/${doc.id}).`,
    [],
    ix,
  );
  expect(report.lowOverlapCitations).toHaveLength(1);
  expect(report.failed).toBe(false);
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

// ── per-doc value grounding: findUngroundedCitationValues ──────────────────
// A real doc whose content carries a distinctive standalone percentage — the
// "value used as link text, cited to the doc that actually contains it" case.
// Found dynamically so the test survives atlas renumbering.
function docWithPercent(): { doc: typeof realDoc; value: string } {
  for (const d of ix.docMap.values()) {
    const m = d.content.match(/(?<![\w.])(\d{2,3}%)/);
    if (m) return { doc: d, value: m[1] };
  }
  throw new Error("no doc with a standalone percentage in the atlas");
}

// A distinctive figure no single doc is expected to contain, so each test
// controls grounding purely via the evidence it passes.
const EXOTIC = "48.73%";

test("value grounding: a value used as link text that IS in the cited doc passes", () => {
  const { doc, value } = docWithPercent();
  expect(findUngroundedCitationValues(`The threshold is [${value}](/atlas/${doc.id}).`, [], ix)).toEqual([]);
});

test("value grounding: a value in this turn's evidence but NOT the cited doc is a hard failure", () => {
  expect(realDoc.content).not.toContain(EXOTIC);
  const answer = `The rate is [${EXOTIC}](/atlas/${realUuid}).`;
  const evidence = [`A different retrieved doc states ${EXOTIC} explicitly.`];
  expect(findUngroundedCitationValues(answer, evidence, ix)).toHaveLength(1);
  const report = runDeterministicChecks(answer, evidence, ix);
  expect(report.ungroundedCitationValues).toHaveLength(1);
  expect(report.failed).toBe(true);
});

test("value grounding: a value in NO evidence at all is left to the soft check, not hard-failed", () => {
  // The plainly-computed / paraphrased escape hatch — a figure that appears in
  // no tool result lives in findUntracedNumbers (soft), never here. This is
  // what protects a correct answer whose cited doc spells the figure out
  // ("five percent") while the digit form appears nowhere in the evidence.
  expect(realDoc.content).not.toContain(EXOTIC);
  expect(findUngroundedCitationValues(`A derived total of [${EXOTIC}](/atlas/${realUuid}).`, [], ix)).toEqual([]);
});

test("value grounding: a cited value matches on token boundaries, not as a digit-substring", () => {
  // `[8.73%]` cited to a doc that lacks it, with evidence that only ever says
  // `48.73%`. A bare substring check reads "8.73%" inside "48.73%" and (a) treats
  // the figure as present in evidence and (b) would treat it as present in any
  // doc that says 48.73% — both mask the real wrong-doc signal. With boundary
  // matching "8.73%" is grounded in neither "48.73%" text, so it drops to the
  // soft check (present in no evidence at all) and is not hard-failed here.
  const sub = "8.73%"; // a proper digit-substring of EXOTIC ("48.73%")
  expect(realDoc.content).not.toContain(sub);
  const answer = `The rate is [${sub}](/atlas/${realUuid}).`;
  expect(findUngroundedCitationValues(answer, [`Another doc states ${EXOTIC} and nothing else.`], ix)).toEqual([]);
  // And a genuine standalone `8.73%` in the evidence is still caught as wrong-doc.
  expect(findUngroundedCitationValues(answer, [`the pool takes ${sub} of rewards`], ix)).toHaveLength(1);
});

test("value grounding: a mistyped EVM address cited to the wrong doc is caught, case-insensitively", () => {
  const addr = "0x" + "aB".repeat(20); // 40 hex chars, EIP-55-ish mixed case
  expect(realDoc.content.toLowerCase()).not.toContain(addr.toLowerCase());
  const answer = `Held at [${addr}](/atlas/${realUuid}).`;
  const evidence = [`{"address":"${addr.toLowerCase()}"}`]; // present, lowercased
  expect(findUngroundedCitationValues(answer, evidence, ix)).toHaveLength(1);
});

test("value grounding: non-value link text, small counts, and leading doc_nos carry no value", () => {
  const evidence = ["unrelated evidence mentioning 3 signers under A.2.2.9"];
  for (const text of ["Keel Accord", "3 signers", "A.2.2.9 - Reward Rate"]) {
    expect(findUngroundedCitationValues(`Cited [${text}](/atlas/${realUuid}).`, evidence, ix)).toEqual([]);
  }
});

// The default-tier model links a doc by its own uuid. Its digit runs (692, 9829,
// 41 …) are short enough to occur in some other retrieved doc, so mining them
// manufactured 36 spurious hard failures in one bakeoff run.
test("value grounding: a uuid used as link text is an identifier, not a figure", () => {
  const uuidText = "7ac692f1-9829-41d8-83d4-4cb1bd053302";
  const evidence = [`unrelated doc mentioning 692 and 9829 and 053302 elsewhere`];
  expect(findUngroundedCitationValues(`See [${uuidText}](/atlas/${realUuid}).`, evidence, ix)).toEqual([]);
  // …but a real figure sitting beside the uuid is still mined.
  const answer = `See [${uuidText} — ${EXOTIC}](/atlas/${realUuid}).`;
  expect(findUngroundedCitationValues(answer, [`the rate is ${EXOTIC}`], ix)).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// findParamMismatches — synthetic fixture. Built via buildIndexes rather than
// the real corpus so every case is deterministic and doesn't drift with atlas
// content. Mirrors the real shape that motivated the title-fallback matching
// (see param-checks.ts's findParamsMentioned doc comment): a Keel doc titled
// "USDS Mint Maximum" whose kv rows are named "maxamount"/"slope" — names a
// model paraphrasing in prose never repeats verbatim.
// ---------------------------------------------------------------------------
function node(p: Partial<AtlasNode> & { id: string; doc_no: string; title: string; content: string }): AtlasNode {
  return { type: "Core", depth: 3, parentId: null, order: 0, addressRefs: [], ...p };
}

const keelOwner = node({ id: "keel-owner", doc_no: "T.1", title: "Keel", type: "Instance", depth: 2, content: "" });
const keelParam = node({
  id: "keel-param",
  doc_no: "T.1.1",
  title: "USDS Mint Maximum",
  parentId: "keel-owner",
  content: [
    "The maximum amount of USDS that can be minted is specified in the document herein.",
    "",
    "- `maxAmount`: 10,000 USDS",
    "- `slope`: 10,000 USDS per day",
  ].join("\n"),
});
const sparkOwner = node({ id: "spark-owner", doc_no: "T.2", title: "Spark", type: "Instance", depth: 2, content: "" });
const sparkParam = node({
  id: "spark-param",
  doc_no: "T.2.1",
  title: "Collateralization Requirement",
  parentId: "spark-owner",
  content: ["The collateralization requirement is specified in the document herein.", "", "- `Liquidation Ratio`: 145%"].join("\n"),
});
const groveOwner = node({ id: "grove-owner", doc_no: "T.3", title: "Grove", type: "Instance", depth: 2, content: "" });
const groveGeneric = node({
  id: "grove-generic",
  doc_no: "T.3.1",
  title: "Fee Cut",
  parentId: "grove-owner",
  content: ["The applicable fee is specified in the document herein.", "", "- `cut`: 50 USDS"].join("\n"),
});
// Ambiguity-gate regressions (found by a real-corpus precision sweep — see the
// task report — after the first title-fallback pass alone still produced
// 7/25 false positives; the corrected two-gate + name-uniqueness +
// subsumption design brought a full 1019-row sweep to zero):
// within-doc: one title, two DIFFERENT-valued rows (mirrors "ETH-A" bundling
// chip/cusp/buf/liquidation-ratio at different values).
const keelBundle = node({
  id: "keel-bundle",
  doc_no: "T.1.2",
  title: "Test Ilk Bundle",
  parentId: "keel-owner",
  content: ["The bundle parameters are specified in the document herein.", "", "- `chip`: 13%", "- `Liquidation Buffer`: 20%"].join("\n"),
});
// cross-doc: two DIFFERENT docs share one title+owner (mirrors the many
// per-token "Inflow Rate Limits" docs sharing one title+owner).
const keelDup1 = node({
  id: "keel-dup-1",
  doc_no: "T.1.3",
  title: "Duplicate Title Doc",
  parentId: "keel-owner",
  content: ["Per-instance parameters are specified in the document herein.", "", "- `Alpha Level`: 7 USDS"].join("\n"),
});
const keelDup2 = node({
  id: "keel-dup-2",
  doc_no: "T.1.4",
  title: "Duplicate Title Doc",
  parentId: "keel-owner",
  content: ["Per-instance parameters are specified in the document herein.", "", "- `Beta Level`: 15 USDS"].join("\n"),
});
// name collision: the SAME kv key reused verbatim across different docs
// (mirrors "maxamount" appearing in 30 different Keel docs).
const keelShared1 = node({
  id: "keel-shared-1",
  doc_no: "T.1.5",
  title: "Shared Key Doc One",
  parentId: "keel-owner",
  content: ["Content is specified in the document herein.", "", "- `sharedKey`: 7 USDS"].join("\n"),
});
const keelShared2 = node({
  id: "keel-shared-2",
  doc_no: "T.1.6",
  title: "Shared Key Doc Two",
  parentId: "keel-owner",
  content: ["Content is specified in the document herein.", "", "- `sharedKey`: 15 USDS"].join("\n"),
});
// subset/superset name collision: "ceiling" tokens are a proper subset of
// "debt ceiling" tokens (mirrors "smart contract risk rating" being a subset
// of the real "...risk rating cap" name).
const keelCeiling = node({
  id: "keel-ceiling",
  doc_no: "T.1.7",
  title: "Ceiling Parameters",
  parentId: "keel-owner",
  content: ["Ceiling parameters are specified in the document herein.", "", "- `Debt Ceiling`: 100 USDS", "- `Ceiling`: 50 USDS"].join("\n"),
});
const sIx = buildIndexes(
  [keelOwner, keelParam, sparkOwner, sparkParam, groveOwner, groveGeneric, keelBundle, keelDup1, keelDup2, keelShared1, keelShared2, keelCeiling],
  [],
  [],
  {},
);

test("findParamMismatches: wrong value flagged via the doc-title fallback (name 'maxamount' never appears in prose)", () => {
  const out = findParamMismatches("Keel's USDS mint maximum is 50,000 USDS.", sIx);
  expect(out).toEqual([
    { stated: "50,000", actual: "10,000 USDS", name: "maxamount", title: "USDS Mint Maximum", owner: "keel", uuid: "keel-param", doc_no: "T.1.1" },
  ]);
});

// The advisor steer consumes the sentence, not the parts — pin its wording so
// splitting the structured shape out of it can't silently reword the recovery
// prompt (chat-orchestrator.ts's describeCheckFailures).
test("formatParamMismatch: renders the advisor-facing sentence from the structured shape", () => {
  const [m] = findParamMismatches("Keel's USDS mint maximum is 50,000 USDS.", sIx);
  expect(formatParamMismatch(m)).toBe("answer states 50,000 for maxamount (keel) but the atlas value is 10,000 USDS — T.1.1");
});

test("findParamMismatches: carries the doc title and uuid so the badge can link the parameter's document", () => {
  const [m] = findParamMismatches("Keel's USDS mint maximum is 50,000 USDS.", sIx);
  // `name` is the terse kv key a reader would not recognise; `title` is what
  // the UI shows instead. They must differ here or the fixture stops covering
  // the case that motivated the split.
  expect(m.name).toBe("maxamount");
  expect(m.title).toBe("USDS Mint Maximum");
  expect(m.uuid).toBe("keel-param");
});

test("findParamMismatches: wrong value flagged via the literal kv-key citation style too", () => {
  const out = findParamMismatches("Keel's `maxAmount` is 50,000 USDS.", sIx);
  expect(out).toEqual([
    { stated: "50,000", actual: "10,000 USDS", name: "maxamount", title: "USDS Mint Maximum", owner: "keel", uuid: "keel-param", doc_no: "T.1.1" },
  ]);
});

test("findParamMismatches: correct value → clean", () => {
  expect(findParamMismatches("Keel's USDS mint maximum is 10,000 USDS.", sIx)).toEqual([]);
});

test("findParamMismatches: correct-and-old value in one sentence → clean (num equality, not string containment)", () => {
  const answer = "Keel's USDS mint maximum was raised from 5,000 to 10,000.";
  expect(findParamMismatches(answer, sIx)).toEqual([]);
});

test("findParamMismatches: owner mismatch → clean (Spark named, row is Keel's)", () => {
  expect(findParamMismatches("Spark's `maxAmount` is 50,000 USDS.", sIx)).toEqual([]);
});

test("findParamMismatches: %-unit gating — a stated non-% number near the name is not flagged", () => {
  expect(findParamMismatches("Spark's liquidation ratio requires 3 confirmations.", sIx)).toEqual([]);
});

test("findParamMismatches: %-unit real mismatch is still caught", () => {
  const out = findParamMismatches("Spark's liquidation ratio is 200%.", sIx);
  expect(out).toEqual([
    { stated: "200%", actual: "145%", name: "liquidation ratio", title: "Collateralization Requirement", owner: "spark", uuid: "spark-param", doc_no: "T.2.1" },
  ]);
});

test("findParamMismatches: generic single-token name ('cut', <=4 chars) is skipped even via a matching title", () => {
  expect(findParamMismatches("Grove's fee cut is 999 USDS.", sIx)).toEqual([]);
});

test("findParamMismatches: dedupes identical messages across sentences", () => {
  const answer = "Keel's USDS mint maximum is 50,000 USDS. Again, Keel's USDS mint maximum is 50,000 USDS.";
  expect(findParamMismatches(answer, sIx)).toHaveLength(1);
});

test("findParamMismatches: within-doc ambiguity (one title, two different-valued rows) suppresses the title-only match", () => {
  expect(findParamMismatches("Keel's Test Ilk Bundle is 99%.", sIx)).toEqual([]);
});

test("findParamMismatches: cross-doc ambiguity (two docs share one title+owner) suppresses both", () => {
  expect(findParamMismatches("Keel's Duplicate Title Doc is 999 USDS.", sIx)).toEqual([]);
});

test("findParamMismatches: name collision (same kv key across docs, same owner) suppresses the literal citation", () => {
  expect(findParamMismatches("Keel's `sharedKey` is 999 USDS.", sIx)).toEqual([]);
});

test("findParamMismatches: subset/superset name collision — the longer, more specific name wins", () => {
  const out = findParamMismatches("Keel's Debt Ceiling is 999 USDS.", sIx);
  expect(out).toEqual([
    { stated: "999", actual: "100 USDS", name: "debt ceiling", title: expect.any(String), owner: "keel", uuid: expect.any(String), doc_no: "T.1.7" },
  ]);
});

test("runDeterministicChecks: missing MSC disclaimer is a hard failure when external evidence is present", () => {
  const external = [JSON.stringify({ required_disclaimer: "These figures are not from the Sky Atlas. Soter Labs workbooks.", three_way: { to_sky: 5 } })];
  const miss = runDeterministicChecks("Spark sent $5 to Sky.", ["atlas doc"], ix, undefined, {
    atlasTexts: ["atlas doc"],
    externalTexts: external,
  });
  expect(miss.missingExternalDisclaimer).toBe(true);
  expect(miss.failed).toBe(true);

  const ok = runDeterministicChecks(
    "These figures are not from the Atlas. They come from Soter Labs workbooks. Spark sent $5 to Sky.",
    ["atlas doc", ...external],
    ix,
    undefined,
    { atlasTexts: ["atlas doc"], externalTexts: external },
  );
  expect(ok.missingExternalDisclaimer).toBe(false);
});

test("runDeterministicChecks: MSC dollars cited as /atlas/uuid fail; atlas quotes cannot be grounded by forum text", () => {
  const external = ['{"forum":{"title":"secret phrase xyzzy"},"three_way":{"to_sky":5000000}}'];
  const cited = runDeterministicChecks(
    `These figures are not from the Atlas. They come from Soter Labs. Spark sent [$5,000,000](/atlas/${realUuid}) to Sky.`,
    external,
    ix,
    undefined,
    { atlasTexts: [], externalTexts: external },
  );
  expect(cited.mscCitedAsAtlas.length).toBeGreaterThan(0);
  expect(cited.failed).toBe(true);

  const quoted = runDeterministicChecks(
    `These figures are not from the Atlas. They come from Soter Labs workbooks.\n> secret phrase xyzzy appears only on the forum post`,
    ["unrelated atlas"],
    ix,
    undefined,
    { atlasTexts: ["unrelated atlas"], externalTexts: external },
  );
  expect(quoted.ungroundedQuotes.length).toBeGreaterThan(0);
});

// First real doc carrying a figure big enough to survive citationValues' small-
// count skip (and not the settlement figure the external brief carries), so the
// "grounded in its own doc" arm asserts on real atlas content.
function numericDoc(): [uuid: string, value: string] {
  for (const [uuid, doc] of ix.docMap) {
    const v = (doc.content.match(/\b\d[\d,]*(?:\.\d+)?\b/g) ?? []).find(
      (m) => Number(m.replace(/,/g, "")) > 20 && Number(m.replace(/,/g, "")) !== 5_000_000,
    );
    if (v) return [uuid, v];
  }
  throw new Error("no atlas doc with a citable figure — index looks wrong");
}

// The regression the shape-only version of this check caused: a turn that mixes
// an MSC figures question with a process question cites BOTH, and the atlas
// citation is written exactly as system-prompt.ts asks — value as link text.
test("findMscCitedAsAtlas: a numeric atlas citation grounded in its own doc is not flagged", () => {
  const external = ['{"three_way":{"to_sky":5000000}}'];
  const [uuid, value] = numericDoc();
  expect(findMscCitedAsAtlas(`[${value}](/atlas/${uuid})`, external, ix)).toEqual([]);

  // …while the settlement figure in the same answer still fails.
  const mixed = runDeterministicChecks(
    `These figures are not from the Atlas — Soter Labs workbooks. The cap is [${value}](/atlas/${uuid}); To Sky was [5,000,000](/atlas/${uuid}).`,
    external,
    ix,
    undefined,
    { atlasTexts: [], externalTexts: external },
  );
  expect(mixed.mscCitedAsAtlas).toHaveLength(1);
  expect(mixed.mscCitedAsAtlas[0]).toContain("5,000,000");
});

test("findMscCitedAsAtlas: a figure in no external brief at all is left to the other checks", () => {
  expect(findMscCitedAsAtlas(`[$8,123,456](/atlas/${realUuid})`, [], ix)).toEqual([]);
  expect(findMscCitedAsAtlas(`[$8,123,456](/atlas/${realUuid})`, ['{"three_way":{"to_sky":42000}}'], ix)).toEqual([]);
});

test("runDeterministicChecks: a param mismatch is a hard failure", () => {
  const clean = runDeterministicChecks("Keel's USDS mint maximum is 10,000 USDS.", [], sIx);
  expect(clean.failed).toBe(false);
  expect(clean.paramMismatches).toEqual([]);

  const wrong = runDeterministicChecks("Keel's USDS mint maximum is 50,000 USDS.", [], sIx);
  expect(wrong.failed).toBe(true);
  expect(wrong.paramMismatches).toHaveLength(1);
});
