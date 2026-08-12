// The four constraint-parameter extraction patterns (see docs/research/synlang-wiki.md
// §3.1). Each returns rows without `owner` — paramIndex.ts's buildParamIndex fills
// that in via paramOwner.ts (owner needs the full docMap for ancestor walking;
// these functions only see one node at a time). Precision over recall throughout:
// every regex here was tuned against public/docs.json and each exclusion below
// is evidence-backed, not speculative.
import type { AtlasNode } from "../types";
import type { ParamRow } from "./paramIndex";
import { KV_LINE_RE, NUM_LITERAL_SRC, normalizeName, parseDecoratedValue, parseValue, stripCodeFences, truncateContext } from "./paramValue";

export type ExtractedRow = Omit<ParamRow, "owner">;

// ---------------------------------------------------------------------------
// kv — "key: value" lines (bullet or bare), e.g. "- `maxAmount`: 10,000 USDS",
// "- Liquidation Ratio: 145%,", "- Slope 1: 9%". The dominant pattern by row
// count (rate-limit / risk-parameter docs) — see the real-corpus stats in the
// module's test/report for why: ~103 rate-limit docs each carry a maxAmount +
// slope pair via this exact shape.
// ---------------------------------------------------------------------------

export function extractKv(n: AtlasNode): ExtractedRow[] {
  const rows: ExtractedRow[] = [];
  const content = stripCodeFences(n.content);
  for (const line of content.split("\n")) {
    const m = KV_LINE_RE.exec(line);
    if (!m) continue;
    // parseValue is anchored end-to-end, so it's what actually filters out
    // sentence-shaped false positives like "The only exceptions ... are if: 1)
    // a signer self-reports ..." (value starts with a digit but the full RHS
    // never validates as number[+multiplier][+unit]).
    // paramValue.ts's shared cascade: raw first, then with the atlas's usual
    // decoration (backticks around the value, a trailing parenthetical gloss)
    // stripped. Shared rather than local because liveness.ts's statesAValue
    // must recognise exactly the lines this extractor turns into rows.
    const parsed = parseDecoratedValue(m[2]);
    if (!parsed) continue;
    const name = normalizeName(m[1]);
    if (!name) continue;
    rows.push({ uuid: n.id, doc_no: n.doc_no, name, value: parsed.value, num: parsed.num, unit: parsed.unit, context: truncateContext(line), source: "kv" });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// core-child — a Core doc whose entire content IS the value (title = name).
// Mirrors atlasEntityParams' instance-param convention. The capture regex
// doubles as the "is this doc eligible" gate, so there's one source of truth
// for what counts as bare.
// ---------------------------------------------------------------------------
const BARE_VALUE_CAPTURE_RE = /^`?(\d+(?:,\d{3})*(?:\.\d+)?%?)`?\.?$/;

export function extractCoreChild(n: AtlasNode): ExtractedRow | null {
  if (n.type !== "Core") return null;
  const raw = n.content.trim();
  if (raw.length > 40) return null;
  const m = BARE_VALUE_CAPTURE_RE.exec(raw);
  if (!m) return null;
  const parsed = parseValue(m[1]);
  if (!parsed) return null;
  const name = normalizeName(n.title);
  if (!name) return null;
  return { uuid: n.id, doc_no: n.doc_no, name, value: parsed.value, num: parsed.num, unit: parsed.unit, context: truncateContext(raw), source: "core-child" };
}

// ---------------------------------------------------------------------------
// backtick — an inline backticked numeric whose parameter name is either
// captured directly from an "The <Name> ... is `V`" sentence, or (when no
// such sentence shape exists) falls back to the doc title, but ONLY when the
// doc carries exactly one backtick-numeric total — multi-value docs (Reward
// Code Ranges, Chain IDs, the Delay Factor doc's illustrative example
// reading, Medium/High Risk Protocols' two-bound ranges) are deliberately
// left with zero rows rather than guess which value is "the" one.
// Imperative-verb titles ("Check RateLimits", "Spell Validators Must Check
// Compiler Version") are procedure docs, not parameter docs — excluded even
// when they'd otherwise qualify as single-match.
// ---------------------------------------------------------------------------
const BT_NUM_RE = new RegExp("`(" + NUM_LITERAL_SRC + ")`", "g");
const NAMED_VALUE_RE = /The ([A-Z][A-Za-z0-9 /-]{1,50}?)(?: for [A-Za-z0-9 ]{1,40}?)? is (?:set to |equal to )?`(\d[\d,]*(?:\.\d+)?%?)`/;
const IMPERATIVE_TITLE_RE = /\b(must|should|shall|calculate|validate|verify|ensure|check|navigate|read|compute|build|determine|confirm|review)\b/i;

function splitSentences(content: string): string[] {
  return content.split(/(?<=[.!?])\s+(?=[A-Z$`])/);
}

export function extractBacktick(n: AtlasNode): ExtractedRow[] {
  // Display-math blocks ($$...$$) aren't prose — periods inside them would
  // otherwise fracture sentence splitting; stripping first keeps e.g. "Here
  // $\alpha$ is equal to `0.1`." as one clean sentence instead of glued to
  // the formula before it.
  const content = stripCodeFences(n.content).replace(/\$\$[\s\S]*?\$\$/g, " ");
  const totalMatches = [...content.matchAll(BT_NUM_RE)].length;
  if (totalMatches === 0) return [];
  const rows: ExtractedRow[] = [];
  const seen = new Set<string>();
  for (const sent of splitSentences(content)) {
    const inSentence = [...sent.matchAll(BT_NUM_RE)];
    if (inSentence.length !== 1) continue; // ambiguous — which value is "the" one?
    const value = inSentence[0][1];
    const named = NAMED_VALUE_RE.exec(sent);
    const name =
      named && named[2] === value
        ? normalizeName(named[1])
        : totalMatches === 1 && n.title.length <= 60 && !IMPERATIVE_TITLE_RE.test(n.title)
          ? normalizeName(n.title)
          : null;
    if (!name) continue;
    const parsed = parseValue(value);
    if (!parsed) continue;
    const key = n.id + "|" + name + "|" + parsed.value;
    if (seen.has(key)) continue; // same doc can yield the same row via both branches only in degenerate cases; keep one
    seen.add(key);
    rows.push({ uuid: n.id, doc_no: n.doc_no, name, value: parsed.value, num: parsed.num, unit: parsed.unit, context: truncateContext(sent), source: "backtick" });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// prose — deliberately narrow. Only "quorum [requirement] of at least N[%]"
// occurs cleanly in the corpus (3 hits, all true positives; "at least N of M
// signers" was tried and found zero corpus occurrences, so it's not
// implemented — there's no evidence it's precise). Requiring "quorum ... of"
// immediately before the number is what keeps this from also matching the
// unrelated "at least 2 independent entities" clause that follows in the same
// doc.
// ---------------------------------------------------------------------------
const QUORUM_RE = /\bquorum(?: requirement)? of at least (\d[\d,]*(?:\.\d+)?)\s*(%|[a-zA-Z]+)?/i;

export function extractProse(n: AtlasNode): ExtractedRow | null {
  const content = stripCodeFences(n.content);
  const m = QUORUM_RE.exec(content);
  if (!m) return null;
  const parsed = parseValue(m[1] + (m[2] === "%" ? "%" : ""));
  if (!parsed) return null;
  const unit = m[2] && m[2] !== "%" ? m[2].toLowerCase() : parsed.unit;
  // Use the containing sentence, not just the regex match, for context — a
  // quorum can carry a scope-defining qualifier right after it ("... for
  // Critical Actions") that a bare "quorum of at least 3 signers" would drop.
  const sentence = splitSentences(content).find((s) => s.includes(m[0])) ?? m[0];
  return { uuid: n.id, doc_no: n.doc_no, name: "quorum", value: parsed.value, num: parsed.num, unit, context: truncateContext(sentence), source: "prose" };
}
