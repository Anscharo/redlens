// Deterministic end-of-turn answer checks for the chat reliability harness —
// pure code, free, and authoritative: the verifier MODEL can never upgrade a
// failure found here (overall is computed in code, see verifier.ts).
// Kept dependency-light (patterns.ts only, plus the Indexes type) so the
// golden-eval grader can share the citation pattern without dragging in Bun.
import { UUID_RE, EVM_ADDRESS_SRC, SOL_ADDRESS_SRC } from "../lib/patterns.ts";
import type { Indexes } from "./indexes.ts";

// The system prompt's citation link format: [Title](/atlas/<uuid>). ONE source
// of truth shared with scripts/aux/eval-golden-grade.ts so grader and runtime
// can't drift. Exported as a source string (not a RegExp) because the runtime
// needs a fresh /g instance per scan — shared global regexes carry lastIndex.
export const CITATION_SRC = `\\[([^\\]]+)\\]\\(/atlas/(${UUID_RE.source.slice(1, -1)})\\)`;

export interface Citation {
  title: string;
  uuid: string;
}

export function extractCitations(answer: string): Citation[] {
  const re = new RegExp(CITATION_SRC, "gi");
  const out: Citation[] = [];
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    out.push({ title: m[1], uuid: m[2].toLowerCase() });
  }
  return out;
}

// Links into the reader that are NOT well-formed uuid citations — e.g. a
// doc_no or a truncated uuid in the href. Signals the model inventing hrefs.
export function findBareAtlasLinks(answer: string): string[] {
  const re = /\]\((\/atlas\/[^)\s]*)\)/g;
  const wellFormed = new RegExp(`^/atlas/${UUID_RE.source.slice(1, -1)}$`, "i");
  const out: string[] = [];
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    if (!wellFormed.test(m[1])) out.push(m[1]);
  }
  return out;
}

export function findInvalidCitationUuids(citations: Citation[], ix: Indexes): string[] {
  return [...new Set(citations.filter((c) => !ix.docMap.has(c.uuid)).map((c) => c.uuid))];
}

// Doc-number mentions anywhere in the answer (prose or link text): editorial
// doc_nos (A.1.6) plus the spec-invariant structural forms (.varX, NR-X). The
// letter prefix must lead straight into dotted digits, so prose like "Q1 2026"
// or "v1.2" never matches. Source string, not RegExp — fresh /g per scan.
const DOC_NO_CORE = String.raw`(?:[A-Z]{1,3}(?:\.\d+)+(?:\.var\d+)?|NR-\d+)`;

export function extractDocNoMentions(answer: string): string[] {
  return [...new Set(answer.match(new RegExp(String.raw`\b${DOC_NO_CORE}\b`, "g")) ?? [])];
}

// Every mentioned doc number must exist in the atlas — models keep inventing
// plausible-looking numbers, and a fabricated number is a hard failure even
// when the surrounding claim is right.
export function findInvalidDocNos(answer: string, ix: Indexes): string[] {
  return extractDocNoMentions(answer).filter((d) => !ix.byDocNo.has(d));
}

// Citations whose link text leads with a doc number that is not the linked
// doc's actual number — deterministic proof of misattribution even when the
// number and the uuid both exist individually.
export function findDocNoMismatches(citations: Citation[], ix: Indexes): string[] {
  const out: string[] = [];
  for (const c of citations) {
    const claimed = c.title.match(new RegExp(String.raw`^${DOC_NO_CORE}\b`))?.[0];
    const doc = ix.docMap.get(c.uuid);
    if (claimed && doc && doc.doc_no !== claimed) out.push(`${claimed} links to ${doc.doc_no} (${doc.title})`);
  }
  return [...new Set(out)];
}

// Substantive paragraphs with no citation link. A soft signal (the answer's
// lead sentence or a summary bullet legitimately goes uncited) — reported to
// the verifier prompt, never a hard failure on its own.
export function countUncitedParagraphs(answer: string): number {
  const citation = new RegExp(CITATION_SRC, "i");
  return answer
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 120 && !/^#{1,6}\s/.test(p) && !p.startsWith("|"))
    .filter((p) => !citation.test(p)).length;
}

// A markdown link, bounded on BOTH parts. The bounds are load-bearing, not
// cosmetic: evidence is JSON full of stray "[" (e.g. "sources":["lexical"]),
// and an unbounded `[^\]]+` will happily run across newlines and quotes until
// some later "](" — swallowing hundreds of characters of real evidence and
// silently turning faithful quotes into "fabrications". Link text is
// single-line and short; an href never contains whitespace.
const MD_LINK_SRC = String.raw`\[([^\]\n]{1,120})\]\([^)\s]*\)`;

// Whitespace/case/punctuation-tolerant containment form. Quote marks and
// markdown emphasis are authoring noise, not evidence differences: a model
// that writes `the 'Reward Instance' refers to…` around a term the atlas
// writes bare is quoting faithfully, and dropping quote characters on BOTH
// sides also collapses `"span"` and `span` to one key so a single quotation
// can't be counted twice.
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    // Tool results arrive as JSON, so a source line break is the literal two
    // characters \n — nothing quoting it verbatim could ever match.
    .replace(/\\[nrt]/g, " ")
    .replace(/\\(.)/g, "$1")
    // Evidence carries raw markdown; an answer quotes the RENDERED text. Both
    // sides collapse to link text so `see [A.2.2.9.1 - Foo](uuid)` matches a
    // faithful quote of `see A.2.2.9.1 - Foo`.
    .replace(new RegExp(MD_LINK_SRC, "g"), "$1")
    .replace(/[“”"‘’']/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Quoted spans the answer presents as verbatim atlas text: markdown blockquote
// lines and inline double-quoted runs. Short quotes (<25 normalized chars) are
// skipped — too likely to be incidental phrasing, not a verbatim claim.
// Attribution is authoring, not quotation: models routinely close a blockquote
// with "— [Title](/atlas/…)", so a trailing dash-led citation is cut and any
// remaining markdown link collapses to its text before matching.
function stripQuoteDecoration(span: string): string {
  return span
    // Trailing attribution, optionally followed by a doc_no: `— [Title](/atlas/x) (A.1.2.3)`
    .replace(new RegExp(String.raw`\s*[—–-]{1,2}\s*` + MD_LINK_SRC + String.raw`\s*(?:\([^)]*\))?\s*$`), "")
    .replace(new RegExp(MD_LINK_SRC, "g"), "$1");
}

// A blockquote line that is ONLY an attribution — `— [Title](/atlas/uuid) (A.1.2.3)`
// or `— Distribution Reward Rate (A.2.2.9.1.2.1.2)` — is the author crediting a
// source, not quoting it. Left unhandled it flags as invented atlas text, which
// punishes the models that attribute most rigorously. Requires BOTH a leading
// attribution dash and a citation marker (link or doc_no), so a quoted list item
// like `> - item one` is still treated as quoted content.
const ATTRIBUTION_DASH = /^\s*[—–-]{1,2}\s*\S/;
const CITATION_MARKER = /\[[^\]]*\]\([^)]*\)|\b(?:[A-Z]{1,3}(?:\.\d+)+(?:\.var\d+)?|NR-\d+)\b/;
const isAttributionLine = (line: string) => ATTRIBUTION_DASH.test(line) && CITATION_MARKER.test(line);

// A quoted TERM the answer denies is a mention, not a quotation: `the atlas
// does not contain an organization called "X"`. Such a term can never appear
// in the evidence — its absence IS the claim — so demanding grounding fires
// exactly when the model does the most honest thing available. Kept narrow: a
// denial must sit within 40 chars of the quote with no clause break, and only
// term-length spans qualify, so a long passage is always checked even under a
// negation.
// Absence markers: the answer asserting the quoted thing does NOT exist. The
// verbs are deliberately specific — a bare "not" would excuse a real invented
// quote in any ordinary negated sentence ("this is not a hypothetical: the doc
// states \"…\""). The denial may sit before the quote or after it, but must be
// in the same clause (no sentence/clause break between).
const ABSENCE_VERB = "contain|mention|define|include|specify|list|name|exist|appear|say|state|address|cover|prescribe|prohibit|document|record|refer";
const ABSENCE = String.raw`(?:(?:does|do|did|is|are|was|were)\s+not\s+\w*\s*(?:${ABSENCE_VERB})|(?:does|do|did|is|are|was|were)n't\s+\w*\s*(?:${ABSENCE_VERB})|there\s+(?:is|are)\s+no\b|no such\b|nowhere\b|(?:is|are)\s+silent|not\s+(?:available|specified|stated|covered|addressed|found|mentioned|defined|documented)|lacks?\b|lacking\b|absent\b|never\s+\w*\s*(?:${ABSENCE_VERB})s?)`;
const DENIAL_BEFORE = new RegExp(ABSENCE + String.raw`[^.!?;:]{0,40}$`, "i");
const DENIAL_AFTER = new RegExp(String.raw`^[^.!?;:]{0,80}?` + ABSENCE, "i");
const MAX_DENIED_TERM = 60;

// Quote characters pair in document order: 1st opens, 2nd closes, 3rd opens…
// Extracting with a single regex desyncs that pairing whenever a span is
// skipped (a short term like "Delegate"), so the scan then captures the PROSE
// BETWEEN two quoted terms as if it were quoted text. Pair first, filter after.
function quotedPairs(line: string): { text: string; start: number; end: number }[] {
  const marks: number[] = [];
  for (let i = 0; i < line.length; i++) if (line[i] === '"' || line[i] === "“" || line[i] === "”") marks.push(i);
  const out: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i + 1 < marks.length; i += 2) {
    out.push({ text: line.slice(marks[i] + 1, marks[i + 1]), start: marks[i], end: marks[i + 1] });
  }
  return out;
}

export function extractQuotedSpans(answer: string): string[] {
  const spans: string[] = [];
  for (const line of answer.split("\n")) {
    const bq = line.match(/^\s*>\s?(.+)$/);
    if (bq && !isAttributionLine(bq[1])) spans.push(stripQuoteDecoration(bq[1]));
  }
  // Inline pass: collapse markdown links to their text FIRST — a quote inside
  // one link's title otherwise pairs with the quote in the next link's title,
  // capturing the href and prose between them as a phantom "quote". Scanned
  // per line because a real inline quotation never spans lines.
  const flat = answer.replace(new RegExp(MD_LINK_SRC, "g"), "$1");
  for (const line of flat.split("\n")) {
    for (const q of quotedPairs(line)) {
      if (q.text.length < 10) continue;
      const denied =
        q.text.length <= MAX_DENIED_TERM &&
        (DENIAL_BEFORE.test(line.slice(0, q.start)) || DENIAL_AFTER.test(line.slice(q.end + 1)));
      if (denied) continue;
      spans.push(q.text);
    }
  }
  return [...new Set(spans.map((s) => normalizeForMatch(s)).filter((s) => s.length >= 25))];
}

// Quotation conventions are not evidence differences: "..." elision and
// bracketed editorial insertions ("[of]", "[sic]") split a quote into
// contiguous segments, each verified independently, and punctuation hugging
// the quotation marks is the author's, not the source's. Segments too short
// to verify meaningfully (<12 chars) are skipped.
function quoteSegments(span: string): string[] {
  return span
    .split(/\.{3,}|…|\[[^\]]{0,40}\]/)
    .map((seg) => seg.replace(/^[\s"',.;:!?()—–-]+|[\s"',.;:!?()—–-]+$/g, ""))
    .filter((seg) => seg.length >= 12);
}

// A quote is grounded if every verifiable segment appears in the turn's
// tool-result evidence or in the title/content of any doc the answer cites.
export function findUngroundedQuotes(answer: string, evidenceTexts: string[], ix: Indexes): string[] {
  const spans = extractQuotedSpans(answer);
  if (spans.length === 0) return [];
  const haystacks = [
    ...evidenceTexts.map(normalizeForMatch),
    ...extractCitations(answer).map((c) => {
      const doc = ix.docMap.get(c.uuid);
      return normalizeForMatch(doc ? `${doc.title}\n${doc.content}` : "");
    }),
  ];
  return spans.filter((s) => quoteSegments(s).some((seg) => !haystacks.some((h) => h.includes(seg))));
}

// An on-chain address cannot be paraphrased, computed, or converted — it is
// either copied from a tool result or invented. The reader linkifies addresses
// straight to a block explorer, so a wrong one sends the user to the wrong
// contract: this is a HARD failure. EVM matching is case-insensitive (EIP-55
// checksum casing is cosmetic); base58 is case-SENSITIVE and compared exactly.
export function findUngroundedAddresses(answer: string, evidenceTexts: string[]): string[] {
  const hay = evidenceTexts.join("\n");
  const hayLower = hay.toLowerCase();
  const out: string[] = [];
  for (const m of answer.match(new RegExp(EVM_ADDRESS_SRC, "g")) ?? []) {
    if (!hayLower.includes(m.toLowerCase())) out.push(m);
  }
  for (const m of answer.match(new RegExp(SOL_ADDRESS_SRC, "g")) ?? []) {
    if (!hay.includes(m)) out.push(m);
  }
  return [...new Set(out)];
}

// Figures that appear nowhere in the evidence. Deliberately a SOFT signal, not
// a failure: models legitimately compute (counts, sums), convert units
// (0.5% = 50bps), and cite schema facts that arrive via the system prompt
// rather than a tool result. The verifier — which does see the schema as [E0]
// — adjudicates. Skips ordinals/small counts, doc numbers, and link hrefs.
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const SMALL_COUNT_MAX = 20;

export function findUntracedNumbers(answer: string, evidenceTexts: string[]): string[] {
  const stripCommas = (s: string) => s.replace(/,(?=\d{3}\b)/g, "");
  // Drop link hrefs (uuids), doc numbers, and code spans before scanning: their
  // digits are identifiers, not claims.
  const prose = stripCommas(
    answer
      .replace(/\]\([^)]*\)/g, "]")
      .replace(new RegExp(String.raw`\b${DOC_NO_CORE}\b`, "g"), "")
      .replace(/`[^`]*`/g, ""),
  );
  const hay = stripCommas(evidenceTexts.join("\n"));
  const out: string[] = [];
  for (const m of prose.match(NUMBER_RE) ?? []) {
    const n = Number(m);
    if (!Number.isFinite(n)) continue;
    if (Number.isInteger(n) && Math.abs(n) <= SMALL_COUNT_MAX) continue;
    if (!hay.includes(m)) out.push(m);
  }
  return [...new Set(out)];
}

export interface CheckReport {
  citations: Citation[];
  invalidCitations: string[];
  invalidDocNos: string[];
  docNoMismatches: string[];
  bareAtlasLinks: string[];
  uncitedParagraphs: number;
  ungroundedQuotes: string[];
  ungroundedAddresses: string[];
  untracedNumbers: string[];
  // True when the answer was cut off by the output-token cap (chat-loop.ts's
  // finish_reason "length") rather than ending on its own. Not derivable from
  // the answer text — set by the caller, defaults false here.
  lengthCapped: boolean;
  // Hard deterministic failure — invented citation targets, invented/misattributed
  // doc numbers, invented quotes, invented addresses, or a length-capped answer.
  // Soft signals (bare links, uncited paragraphs, untraced numbers) inform, they don't fail.
  failed: boolean;
}

export function runDeterministicChecks(answer: string, evidenceTexts: string[], ix: Indexes): CheckReport {
  const citations = extractCitations(answer);
  const invalidCitations = findInvalidCitationUuids(citations, ix);
  const invalidDocNos = findInvalidDocNos(answer, ix);
  const docNoMismatches = findDocNoMismatches(citations, ix);
  const ungroundedQuotes = findUngroundedQuotes(answer, evidenceTexts, ix);
  const ungroundedAddresses = findUngroundedAddresses(answer, evidenceTexts);
  return {
    citations,
    invalidCitations,
    invalidDocNos,
    docNoMismatches,
    bareAtlasLinks: findBareAtlasLinks(answer),
    uncitedParagraphs: countUncitedParagraphs(answer),
    ungroundedQuotes,
    ungroundedAddresses,
    untracedNumbers: findUntracedNumbers(answer, evidenceTexts),
    lengthCapped: false,
    failed:
      invalidCitations.length > 0 ||
      invalidDocNos.length > 0 ||
      docNoMismatches.length > 0 ||
      ungroundedQuotes.length > 0 ||
      ungroundedAddresses.length > 0,
  };
}
