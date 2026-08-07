// Deterministic end-of-turn answer checks for the chat reliability harness —
// pure code, free, and authoritative: the verifier MODEL can never upgrade a
// failure found here (overall is computed in code, see verifier.ts).
// Kept dependency-light (patterns.ts only, plus the Indexes type) so the
// golden-eval grader can share the citation pattern without dragging in Bun.
import { UUID_RE, EVM_ADDRESS_SRC, SOL_ADDRESS_SRC } from "../../../lib/patterns.ts";
import type { ParamRow } from "../../../lib/paramIndex.ts";
import type { Indexes } from "../../retrieval/indexes.ts";

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

// A blockquote line the model wrote ABOUT the material rather than FROM it —
// `> **Bottom line: …**`. Models routinely render their own summary as a bolded
// blockquote callout, and a self-authored callout can never appear in the
// evidence, so scoring it as a quotation hard-fails otherwise honest answers.
// The discriminator is a CONJUNCTION, deliberately: essentially the whole line
// is bold AND it carries no quotation marks AND no citation link. Either of
// those two markers means the model is presenting the line as source text
// (`> **"…"**`, or a bolded quote closed by its attribution), so a genuine
// invented quote is still caught. The system prompt reserves blockquotes for
// verbatim quotation, which is the other half of this fix.
const BOLD_RUN = /\*\*([^*]+)\*\*/g;
const MD_LINK_ANY = /\[[^\]]*\]\([^)]*\)/;
const BOLD_LINE_MIN = 0.9;

function isSelfAuthoredCallout(line: string): boolean {
  if (/["“”]/.test(line) || MD_LINK_ANY.test(line)) return false;
  const plain = line.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (plain.length === 0) return false;
  let bold = 0;
  for (const m of line.matchAll(BOLD_RUN)) bold += m[1].replace(/\s+/g, " ").trim().length;
  return bold / plain.length >= BOLD_LINE_MIN;
}

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
    if (bq && !isAttributionLine(bq[1]) && !isSelfAuthoredCallout(bq[1])) spans.push(stripQuoteDecoration(bq[1]));
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

// A citation whose LINK TEXT is a value — a number, percentage, date, or
// on-chain address — is the sharpest wrong-doc signal available in pure code.
// A value cannot be paraphrased, so if the answer writes `[5%][spark-rate]` the
// figure 5% must literally occur in the spark-rate doc; citing a doc that does
// not contain it is misattribution, a HARD failure on the same reasoning as
// `findUngroundedAddresses`. The escape hatch for "plainly computed" values
// (a total the answer derives from cited parts, which lives in no single doc):
// a value that appears in NO tool evidence at all is left to
// `findUntracedNumbers` (soft) and never hard-failed here — only a value that
// IS in this turn's evidence but NOT in the cited doc is flagged, which is
// exactly a real figure attributed to the wrong document. Percentages and
// decimals are examined even when small — unlike `findUntracedNumbers`'s ≤20
// integer skip — because a bare `5%` is precisely the gap this closes.
// Complements `findLowOverlapCitations`: overlap scores prose sentences, this
// scores citations whose text IS the claim.
const PERCENT_RE = /\d[\d,]*(?:\.\d+)?\s*%/g;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const SLASH_DATE_RE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

// Comma/percent-form-insensitive numeric key: thousands separators drop on both
// sides (`10,782` ↔ `10782`) and `5 %` collapses to `5%`, so a normalized value
// matches the same figure however the doc spells its separators.
const numKey = (s: string) => s.replace(/,(?=\d{3}\b)/g, "").replace(/\s+%/g, "%").toLowerCase();

// Whether a normalized numeric key occurs in `hayNum` as a whole figure rather
// than a digit-substring of a larger one. A plain `includes` treats `[5%]` cited
// to a doc that only says `15%` as grounded — suppressing the wrong-doc HARD
// failure this check exists to raise — because "15%" contains "5%". Guard both
// ends against an adjacent digit or decimal point so `5%`≠`15%`, `48.73`≠`148.73`
// or `48.731`, and a date's components don't collide with a longer run.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const numTokenInHay = (hayNum: string, key: string): boolean =>
  key.length > 0 && new RegExp(String.raw`(?<![\d.])${escapeRe(key)}(?![\d.])`).test(hayNum);

interface LinkValue {
  literal: string;
  address: "evm" | "sol" | null;
}

// Values carried by a citation's link text, most-distinctive-first (addresses,
// then percentages, then dates, then remaining figures), each span blanked out
// before the next scan so a percentage's or address's own digits are never
// re-mined as a bare number.
// Exported so the model bakeoff can measure the prompt-compliance rate for
// "make the value the link text" — the behaviour findUngroundedCitationValues
// depends on, and which one measured tier ignored entirely (see
// docs/plans/reference-citations.md).
export function citationValues(text: string): LinkValue[] {
  const out: LinkValue[] = [];
  const seen = new Set<string>();
  const push = (literal: string, address: LinkValue["address"]) => {
    const key = address ? literal : numKey(literal);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({ literal, address });
    }
  };
  // A leading real/structural doc_no in the link text ("A.2.2.9 - Rate") is an
  // identifier, not a value — drop it before mining.
  let rest = text.replace(new RegExp(String.raw`^\s*${DOC_NO_CORE}\b`), "");
  // So is a UUID. The default-tier model writes a doc's own uuid as link text
  // (`[7ac692f1-9829-41d8-…](/atlas/7ac692f1-…)`, measured in the 2026-08-03
  // bakeoff), and mining that yields digit runs — 692, 9829, 41 — which are
  // short enough to occur incidentally in some other retrieved doc and are then
  // reported as figures misattributed to the doc they link. That accounted for
  // 36 of the 42 hard value failures in that run, every one of them spurious.
  rest = rest.replace(new RegExp(UUID_RE.source.slice(1, -1), "gi"), " ");
  for (const m of rest.match(new RegExp(EVM_ADDRESS_SRC, "g")) ?? []) push(m, "evm");
  for (const m of rest.match(new RegExp(SOL_ADDRESS_SRC, "g")) ?? []) push(m, "sol");
  rest = rest.replace(new RegExp(EVM_ADDRESS_SRC, "g"), " ").replace(new RegExp(SOL_ADDRESS_SRC, "g"), " ");
  for (const m of rest.match(PERCENT_RE) ?? []) push(m, null);
  for (const m of rest.match(ISO_DATE_RE) ?? []) push(m, null);
  for (const m of rest.match(SLASH_DATE_RE) ?? []) push(m, null);
  rest = rest.replace(PERCENT_RE, " ").replace(ISO_DATE_RE, " ").replace(SLASH_DATE_RE, " ");
  for (const m of rest.match(NUMBER_RE) ?? []) {
    const n = Number(m.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (Number.isInteger(n) && Math.abs(n) <= SMALL_COUNT_MAX) continue;
    push(m, null);
  }
  return out;
}

interface Hay {
  raw: string;
  lower: string;
  num: string;
}
const mkHay = (s: string): Hay => ({ raw: s, lower: s.toLowerCase(), num: numKey(s) });

// EVM matching is case-insensitive (checksum casing is cosmetic); base58 Solana
// is case-sensitive; numeric values compare on the comma/percent-normalized key.
function valueInHay(v: LinkValue, hay: Hay): boolean {
  if (v.address === "evm") return hay.lower.includes(v.literal.toLowerCase());
  if (v.address === "sol") return hay.raw.includes(v.literal);
  return numTokenInHay(hay.num, numKey(v.literal));
}

export function findUngroundedCitationValues(answer: string, evidenceTexts: string[], ix: Indexes): string[] {
  const cites = extractCitations(answer);
  if (cites.length === 0) return [];
  const evidence = mkHay(evidenceTexts.join("\n"));
  const out: string[] = [];
  for (const c of cites) {
    const doc = ix.docMap.get(c.uuid);
    if (!doc) continue; // an unknown uuid is already a hard failure
    const docHay = mkHay(`${doc.title}\n${doc.content}`);
    for (const v of citationValues(c.title)) {
      if (valueInHay(v, docHay)) continue; // grounded in the cited doc — fine
      if (!valueInHay(v, evidence)) continue; // in no evidence at all → computed/soft, skip
      out.push(`${v.literal} cited to ${doc.doc_no} (${doc.title}) but absent from it`);
    }
  }
  return [...new Set(out)];
}

// A citation whose UUID is real but points at the WRONG document passes every
// other deterministic check (`findInvalidCitationUuids` only asks whether the
// uuid exists; `findDocNoMismatches` only fires when the link TEXT leads with a
// doc_no). It is the worst-caught failure class across models, so this is a free
// lexical assist: how much of the claim sentence's distinctive vocabulary
// actually occurs in the cited doc. Deliberately a SOFT signal — paraphrase,
// synthesis, and pronoun-carrying prose all legitimately depress overlap, so the
// verifier adjudicates rather than the answer failing outright.
const OVERLAP_STOPWORDS = new Set(
  ("the and are was were for from with without into over under about that this these those which who whom whose " +
    "what when where why how all any both each few more most other some such only own same too very per also " +
    "within across between during after before above below out off again further once its their his her they " +
    "them you your our not nor but then than there here can could may might must shall should will would has " +
    "have had having does did done being been").split(" "),
);
// Plural/possessive folding so `facilitators` matches `Facilitator`. Crude on
// purpose: the check is a ratio over many words, not a parser.
const foldWord = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

function contentWords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  return [...new Set(words.filter((w) => !OVERLAP_STOPWORDS.has(w)).map(foldWord))];
}

// A segment carrying citations but no prose of its own — `[Title](/atlas/…)`
// sitting after a sentence's period, or an attribution line. It is an
// attachment to the sentence before it, not a claim in its own right.
const isCitationOnly = (seg: string): boolean =>
  extractCitations(seg).length > 0 && contentWords(seg.replace(new RegExp(MD_LINK_SRC, "g"), " ")).length === 0;

// Claim units: one line of markdown, split further at sentence ends. A citation
// belongs to the sentence it closes, not to the whole paragraph.
//
// Splitting at sentence ends alone loses every trailing citation: `Foo is bar.
// [Doc](/atlas/x)` becomes a prose segment with no citation (nothing to check)
// plus a citation segment with no prose (dropped by MIN_CLAIM_WORDS), so the
// claim escapes from both sides. Since the system prompt asks for exactly that
// shape ("Quote at most 1–2 sentences … always followed by its link"), a
// citation-only segment is folded back onto the sentence it follows.
function claimSegments(answer: string): string[] {
  const out: string[] = [];
  for (const line of answer.split("\n")) {
    // Headings carry no claim; blockquotes (content AND their attribution line)
    // are skipped because findUngroundedQuotes already checks quoted text against
    // the cited doc's content — checking them here too would double-report the
    // same misattribution.
    if (/^\s*(?:#{1,6}\s|>)/.test(line)) continue;
    const segs = line.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      // Same-line trailing citation, or an em/en-dash attribution on its own
      // line. A plain `-` lead is deliberately NOT folded: that is a markdown
      // bullet, and a trailing source LIST would otherwise be scored against
      // the last sentence of the prose above it — every entry a false flag.
      const attaches = i > 0 || /^\s*[—–]/.test(seg);
      if (isCitationOnly(seg) && attaches && out.length > 0) {
        out[out.length - 1] += ` ${seg}`;
        continue;
      }
      out.push(seg);
    }
  }
  return out;
}

// Below this many distinctive words the ratio is noise (a bare "See [Doc](…)"
// would flag every time), so short segments are skipped outright — that is where
// the false positives would come from. Tuned against the real index over 400
// sampled docs: correctly-cited sentences 0% flagged (verbatim AND with half
// their words dropped to simulate paraphrase), wrong-doc citations 86.5%
// flagged, bare "See [Doc](…)." never flagged. A sentence citing its own doc's
// PARENT flags ~60% of the time — intended, not noise: since atomization a
// parent's content does not contain its children's text, so that IS a
// misattribution worth the verifier's attention.
const MIN_CLAIM_WORDS = 6;
const MIN_CITATION_OVERLAP = 0.25;

export function findLowOverlapCitations(answer: string, ix: Indexes): string[] {
  const out: string[] = [];
  for (const seg of claimSegments(answer)) {
    const cites = extractCitations(seg);
    if (cites.length === 0) continue;
    // Strip the links first: the link TEXT is normally the cited doc's own
    // title, which would guarantee overlap and make the check inert.
    const prose = seg.replace(new RegExp(MD_LINK_SRC, "g"), " ");
    const words = contentWords(prose);
    if (words.length < MIN_CLAIM_WORDS) continue;
    for (const c of cites) {
      const doc = ix.docMap.get(c.uuid);
      if (!doc) continue; // an unknown uuid is already a hard failure
      const hay = new Set(contentWords(`${doc.title}\n${doc.content}`));
      const hits = words.filter((w) => hay.has(w)).length;
      if (hits / words.length < MIN_CITATION_OVERLAP) {
        out.push(`${doc.doc_no} ${doc.title} ← "${prose.replace(/\s+/g, " ").trim().slice(0, 100)}"`);
      }
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Parameter-mismatch hard check (docs/research/synlang-wiki.md §3.1). A HARD
// failure: the answer states a WRONG number for a KNOWN atlas parameter, with
// the parameter's name and (if disambiguating) its owner both present in the
// same sentence. Precision over recall throughout — this is a hard-fail path.
// ---------------------------------------------------------------------------

// Aggressive word tokenization matching paramIndex.ts's own (private)
// normalizeForMatch convention — lowercase, ALL non-alphanumeric collapsed to
// whitespace. Deliberately NOT this file's own `normalizeForMatch` (which
// keeps apostrophes/periods intact for quote-substring matching): that would
// leave "Keel's" as one token and never match a bare "keel" owner/title token.
function paramWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
}

function ownerTokensOf(owner: string | null): string[] {
  return owner ? paramWords(owner) : [];
}

// A bare single-token name of length <=4 ("max", "cut", "tail", "step") is too
// likely to be an ordinary English word to trust alone — paramIndex.ts's own
// module notes measure exactly these tokens matching 9-22 unrelated rows.
function isGenericRowName(name: string): boolean {
  return !name.includes(" ") && name.length <= 4;
}

export interface ParamMention {
  row: ParamRow;
  byTitle: boolean; // matched via the containing doc's title, not the row's own `name`
}

// Rows whose extracted `name` — OR whose containing doc's TITLE — is fully
// present, as whole normalized words, in `text`, AND (when the row has an
// owner) at least one owner token is present too.
//
// REAL-CORPUS FINDING that motivates the title fallback: `ix.params.matchText`
// alone returns ZERO rows for "Keel's USDS mint maximum is 50,000 USDS" or for
// an absence claim phrased the same way, even though Keel's exact-matching row
// exists (uuid 568f6fae-4680-4090-8eee-fe0b8e920155). The extracted `name` is
// the terse kv key "maxamount" (from a `maxAmount:` line) — it never occurs as
// a literal word in natural paraphrase. The doc's TITLE, "USDS Mint Maximum",
// is what a model actually writes, and IS what appears in the prose.
//
// Both matching paths (literal `name` citation via matchText, and the title
// fallback) are gated against three real-corpus ambiguity sources found by a
// precision sweep (~1000 rows, correct values stated; false positives at each
// stage noted below — see the sweep script referenced in the task report):
//
//   1. NAME collisions: a terse kv key like "maxamount" is reused verbatim
//      across every per-token variant of a templated doc — Keel alone has 30
//      distinct "maxamount" docs. `matchText` on a bare "Keel's `maxAmount`
//      is X" would return ALL 30, and everything but the coincidentally-right
//      one would be flagged wrong (measured: 9 spurious mismatches for one
//      sentence). Gated by `safeNameOwnerUuids`: (name, owner) must resolve
//      to exactly one doc.
//   2. TITLE collisions, two forms: (a) 40/217 (title, owner) keys span
//      MULTIPLE docs (one "Inflow/Deposit/Swap/Outflow Rate Limits" doc PER
//      TOKEN, same title+owner, different maxAmounts); (b) of the remainder,
//      104/177 single-doc keys still bundle several DIFFERENT-valued
//      parameters in one doc (ilk risk docs like "ETH-A" carry chip/cusp/buf/
//      tail/tip/liquidation-ratio together). Gated by `safeTitleOwnerUuids`,
//      keyed on a SORTED (order-independent) word set — two docs whose titles
//      are word-for-word PERMUTATIONS of each other ("...From Ethereum To
//      Avalanche..." vs "...From Avalanche To Ethereum...", a real bridge-
//      direction pair) match the same bag-of-words text either way, so the
//      fan-out check must use the same order-independent key the containment
//      check does, or each direction looks spuriously "unique".
//   3. SUBSET/SUPERSET name collisions: matchText's per-name token-subset
//      semantics mean a SHORTER name's tokens can be fully contained in text
//      that actually names a LONGER, more specific parameter ("smart contract
//      risk rating" ⊂ "...risk rating cap" — both real, different docs).
//      Handled post-hoc below: when two matched names are in a subset
//      relationship, only the longer (more specific) one survives.
//
// All three are fixed at the SOURCE (never added to `out`) or by a final
// subsumption pass — there is no separate opt-in suppression step.
export function findParamsMentioned(text: string, ix: Indexes): ParamMention[] {
  const words = new Set(paramWords(text));
  if (words.size === 0) return [];
  const passOwner = (owner: string | null) => owner === null || ownerTokensOf(owner).some((t) => words.has(t));
  const out: ParamMention[] = [];
  const seen = new Set<string>();

  const safeName = safeNameOwnerUuids(ix);
  const nameMatched = ix.params.matchText(text).filter(
    (row) => !isGenericRowName(row.name) && passOwner(row.owner) && safeName.get(nameOwnerKey(row.name, row.owner)) === row.uuid,
  );
  // Gate 3 (subsumption): among THIS text's name-matched candidates, drop any
  // whose name-token set is a proper subset of another candidate's — the
  // longer, more specific name wins.
  const nameTokenSets = new Map(nameMatched.map((r) => [r, new Set(paramWords(r.name))]));
  for (const a of nameMatched) {
    const ta = nameTokenSets.get(a)!;
    const subsumedByAnother = nameMatched.some((b) => {
      if (b === a) return false;
      const tb = nameTokenSets.get(b)!;
      return ta.size < tb.size && [...ta].every((t) => tb.has(t));
    });
    if (subsumedByAnother) continue;
    seen.add(a.uuid + "|" + a.name);
    out.push({ row: a, byTitle: false });
  }

  const safeTitle = safeTitleOwnerUuids(ix);
  for (const row of ix.params.rows) {
    const key = row.uuid + "|" + row.name;
    // isGenericRowName applies here too, not just to the name-matchText loop —
    // it is a property of the ROW, and title matching is the broader signal.
    if (seen.has(key) || isGenericRowName(row.name) || !passOwner(row.owner)) continue;
    const title = ix.docMap.get(row.uuid)?.title;
    if (!title) continue;
    const titleWords = paramWords(title);
    if (titleWords.join(" ") === row.name) continue; // no new signal over the name check above
    // A single-word title carries the same generic risk isGenericRowName guards
    // against on names — require at least two words for the title signal.
    if (titleWords.length < 2 || !titleWords.every((t) => words.has(t))) continue;
    if (safeTitle.get(titleOwnerKey(titleWords, row.owner)) !== row.uuid) continue; // ambiguous — gate 2
    out.push({ row, byTitle: true });
  }
  return out;
}

function nameOwnerKey(name: string, owner: string | null): string {
  return name + "|" + (owner ?? "");
}

// (name, owner) -> the single doc uuid it's safe to trust a literal name
// citation against — gate 1 above. Every extraction pattern's `name` is
// reused verbatim across per-token/per-vault doc variants far more often than
// it identifies one doc, so this is a strict "exactly one" bar, not a
// num-agreement one (unlike the title gate, a name+owner pins a SPECIFIC
// parameter identity, not a whole doc's worth of siblings).
const nameOwnerSafetyCache = new WeakMap<Indexes, Map<string, string>>();
function safeNameOwnerUuids(ix: Indexes): Map<string, string> {
  const cached = nameOwnerSafetyCache.get(ix);
  if (cached) return cached;
  const uuidsByKey = new Map<string, Set<string>>();
  for (const row of ix.params.rows) {
    const key = nameOwnerKey(row.name, row.owner);
    const s = uuidsByKey.get(key) ?? new Set<string>();
    s.add(row.uuid);
    uuidsByKey.set(key, s);
  }
  const safe = new Map<string, string>();
  for (const [key, uuids] of uuidsByKey) if (uuids.size === 1) safe.set(key, [...uuids][0]);
  nameOwnerSafetyCache.set(ix, safe);
  return safe;
}

// Order-independent (sorted) word-set key — two titles that are word-for-word
// PERMUTATIONS of each other (a real bridge-direction pair, "...From A To
// B..." vs "...From B To A...") must collide here even though their ORIGINAL
// word order differs, because the containment check above is itself
// order-independent (`titleWords.every(t => words.has(t))`): if the fan-out
// key were order-preserving, each direction would look spuriously "unique".
function titleOwnerKey(titleWords: string[], owner: string | null): string {
  return [...titleWords].sort().join(" ") + "|" + (owner ?? "");
}

// (title, owner) -> the single doc uuid it's safe to title-match against —
// gate 2 above. Built from `ix.params.byUuid` — ALL of a doc's rows,
// INCLUDING otherwise-generic ones ("chip", "tip", "step", …): an invisible
// sibling row with a different `num` is still real evidence the title
// doesn't pin down a single value, even though that sibling would never
// itself be reported (isGenericRowName). Cached per Indexes instance since it
// doesn't depend on the text being matched and findParamsMentioned may run
// once per sentence.
const titleOwnerSafetyCache = new WeakMap<Indexes, Map<string, string>>();
function safeTitleOwnerUuids(ix: Indexes): Map<string, string> {
  const cached = titleOwnerSafetyCache.get(ix);
  if (cached) return cached;
  const uuidsByKey = new Map<string, Set<string>>();
  for (const row of ix.params.rows) {
    const title = ix.docMap.get(row.uuid)?.title;
    if (!title) continue;
    const titleWords = paramWords(title);
    if (titleWords.length < 2) continue;
    const key = titleOwnerKey(titleWords, row.owner);
    const s = uuidsByKey.get(key) ?? new Set<string>();
    s.add(row.uuid);
    uuidsByKey.set(key, s);
  }
  const safe = new Map<string, string>();
  for (const [key, uuids] of uuidsByKey) {
    if (uuids.size !== 1) continue; // gate 2a: title+owner must span exactly one doc
    const [uuid] = uuids;
    const nums = new Set((ix.params.byUuid.get(uuid) ?? []).map((r) => r.num));
    if (nums.size === 1) safe.set(key, uuid); // gate 2b: that doc's rows must all agree on num
  }
  titleOwnerSafetyCache.set(ix, safe);
  return safe;
}

interface Mention {
  raw: string; // as written, e.g. "50,000" or "145%"
  num: number; // magnitude-expanded
  pct: boolean; // a "%" sits directly against this number
}

// Local magnitude expansion, parallel to (not importing) paramValue.ts's
// private MULTIPLIERS table: this scans MODEL-WRITTEN prose, not atlas source
// text, so the hex-fragment collision risk that makes paramValue's attached
// letters uppercase-only doesn't apply here — lowercase k/m/b/t is safe.
const MAGNITUDE: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
const MENTION_RE = /\d[\d,]*(?:\.\d+)?(?:\s*(thousand|million|billion|trillion)s?\b|([KMBTkmbt])\b)?(\s*%)?/g;

function extractMentions(sentence: string): Mention[] {
  const out: Mention[] = [];
  for (const m of sentence.matchAll(MENTION_RE)) {
    const numStr = /^\d[\d,]*(?:\.\d+)?/.exec(m[0])![0];
    const base = parseFloat(numStr.replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const magWord = (m[1] || m[2] || "").toLowerCase();
    out.push({ raw: m[0].trim(), num: base * (magWord ? (MAGNITUDE[magWord] ?? 1) : 1), pct: Boolean(m[3]) });
  }
  return out;
}

// True when the sentence already states the row's real value: exact string,
// comma-stripped string, or numeric equality of ANY mention (magnitude-
// expanded) against `row.num` — covers "raised from 5,000 to 10,000" style
// sentences that also mention an old/wrong figure alongside the real one.
function sentenceHasTrueValue(sentence: string, row: ParamRow, mentions: Mention[]): boolean {
  const lower = sentence.toLowerCase();
  if (lower.includes(row.value.toLowerCase())) return true;
  if (lower.replace(/,/g, "").includes(row.value.toLowerCase().replace(/,/g, ""))) return true;
  return row.num !== null && mentions.some((m) => m.num === row.num);
}

function splitAnswerSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

// The brief describes a two-phase design (a coarse whole-answer candidate
// filter, then a per-sentence refinement). This runs the token+owner
// containment check directly per sentence via findParamsMentioned instead —
// outcome-equivalent (a row is only ever flagged when some sentence satisfies
// both conditions) and avoids maintaining two separate candidate-selection
// code paths for one property.
export function findParamMismatches(answer: string, ix: Indexes): string[] {
  // Strip link hrefs (uuid digits) and doc-no mentions before scanning for
  // numbers — same digit-noise reasoning as findUntracedNumbers above.
  // Backticks are NOT stripped: a model faithfully echoing the atlas's own
  // `` `maxAmount` `` kv-key syntax must stay visible to the name-token check.
  const prose = answer.replace(/\]\([^)]*\)/g, "]").replace(new RegExp(String.raw`\b${DOC_NO_CORE}\b`, "g"), "");
  const out: string[] = [];
  for (const sentence of splitAnswerSentences(prose)) {
    const mentions = extractMentions(sentence);
    if (mentions.length === 0) continue; // no number stated — nothing to check
    for (const { row } of findParamsMentioned(sentence, ix)) {
      if (sentenceHasTrueValue(sentence, row, mentions)) continue;
      let relevant = mentions;
      if (row.unit === "%") {
        // Unit-mismatch gate: a % parameter's sentence must carry a %-adjacent
        // number, or its numbers are probably a different quantity entirely.
        relevant = mentions.filter((m) => m.pct);
        if (relevant.length === 0) continue;
      } else if (row.unit && !sentence.toLowerCase().includes(row.unit.toLowerCase())) {
        continue; // non-% unit's text absent from the sentence — likely unrelated
      }
      for (const m of relevant.filter((m) => !(row.num !== null && m.num === row.num))) {
        out.push(
          `answer states ${m.raw} for ${row.name}${row.owner ? ` (${row.owner})` : ""} but the atlas value is ${formatParamValue(row)} — ${row.doc_no}`,
        );
      }
    }
  }
  return [...new Set(out)];
}

// `value` usually embeds its unit already ("10,000 USDS" with unit "USDS");
// append `unit` only when it doesn't, so messages never read "10,000 USDS USDS".
// Shared by the mismatch strings above and absence.ts's refutation detail.
export function formatParamValue(p: { value: string; unit: string | null }): string {
  if (!p.unit || p.value.toLowerCase().endsWith(p.unit.toLowerCase())) return p.value;
  return p.unit === "%" ? `${p.value}%` : `${p.value} ${p.unit}`;
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
  // Values used as citation link text (a number, percentage, date, or address)
  // that occur in this turn's evidence but NOT in the specific doc they cite —
  // a real figure attributed to the wrong document. A HARD failure.
  ungroundedCitationValues: string[];
  untracedNumbers: string[];
  // Wrong stated value for a KNOWN atlas parameter (the derived param table,
  // findParamMismatches above) — a HARD failure like the other invented facts.
  paramMismatches: string[];
  // Soft wrong-doc assist: claim sentences whose vocabulary barely occurs in the
  // doc they cite. Informs the verifier prompt; never fails a turn.
  lowOverlapCitations: string[];
  // True when the answer was cut off by the output-token cap (chat-loop.ts's
  // finish_reason "length") rather than ending on its own. Not derivable from
  // the answer text — set by the caller, defaults false here.
  lengthCapped: boolean;
  // Hard deterministic failure — invented citation targets, invented/misattributed
  // doc numbers, invented quotes, invented addresses, or a length-capped answer.
  // Soft signals (bare links, uncited paragraphs, untraced numbers, low-overlap
  // citations) inform, they don't fail.
  failed: boolean;
}

export function runDeterministicChecks(answer: string, evidenceTexts: string[], ix: Indexes): CheckReport {
  const citations = extractCitations(answer);
  const invalidCitations = findInvalidCitationUuids(citations, ix);
  const invalidDocNos = findInvalidDocNos(answer, ix);
  const docNoMismatches = findDocNoMismatches(citations, ix);
  const ungroundedQuotes = findUngroundedQuotes(answer, evidenceTexts, ix);
  const ungroundedAddresses = findUngroundedAddresses(answer, evidenceTexts);
  const ungroundedCitationValues = findUngroundedCitationValues(answer, evidenceTexts, ix);
  const paramMismatches = findParamMismatches(answer, ix);
  return {
    citations,
    invalidCitations,
    invalidDocNos,
    docNoMismatches,
    bareAtlasLinks: findBareAtlasLinks(answer),
    uncitedParagraphs: countUncitedParagraphs(answer),
    ungroundedQuotes,
    ungroundedAddresses,
    ungroundedCitationValues,
    untracedNumbers: findUntracedNumbers(answer, evidenceTexts),
    lowOverlapCitations: findLowOverlapCitations(answer, ix),
    paramMismatches,
    lengthCapped: false,
    failed:
      invalidCitations.length > 0 ||
      invalidDocNos.length > 0 ||
      docNoMismatches.length > 0 ||
      ungroundedQuotes.length > 0 ||
      ungroundedAddresses.length > 0 ||
      ungroundedCitationValues.length > 0 ||
      paramMismatches.length > 0,
  };
}
