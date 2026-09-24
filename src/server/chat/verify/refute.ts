// The refute auditor — ONE of the two concurrent slices that make up the
// verifier (verify/sliced-verifier.ts). It lists ONLY statements the
// retrieved evidence CONTRADICTS, each carrying a verbatim evidence span that
// code re-validates (validateContradictions below): a span that isn't really
// there is discarded, never demoted-and-kept. This is a deliberate inversion
// of the old "prove every claim supported" design — a statement the evidence
// merely doesn't mention is NOT flagged; the judge's job is narrower and its
// false-positive surface is smaller by construction.
//
// "Show your work" survives the redesign for the same reason it existed
// before: it now guards against a FABRICATED contradiction rather than a
// fabricated support claim.
import type OpenAI from "openai";
import type { EvidenceEntry } from "./verifier.ts";
import type { Contradiction } from "./verifier.ts";
import { normalizeForMatch } from "./verify-checks.ts";
import { locateSpan, spanOverlap, stripLinkMarkup, tokenize, SPAN_MATCH_THRESHOLD } from "./span-match.ts";
import { parseJsonish } from "./slice-json.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const REFUTE_PROMPT = [
  "You audit ONE thing: statements in the answer that the retrieved evidence CONTRADICTS — a different value, holder, date, status, count, or modality (must vs may).",
  "For each, copy the answer sentence verbatim into `answer_span`, copy the contradicting evidence VERBATIM into `evidence_span` (it is re-checked by code; an inexact span is discarded), and give ≤20 words `why`.",
  "A statement the evidence merely does not mention is NOT a contradiction — leave it out entirely.",
  "Do not report omissions or missing list members.",
  "Entries marked [REFERENCE] are context SAbR injected (product guide, glossary, entity rows) — not atlas text; a faithful restatement of one is never a contradiction.",
  "Entries marked [USER NOTE, not Atlas] are this user's private /teach notes — never treat them as atlas text or as a quotation of the atlas.",
  "Entries marked [NOT ATLAS] did not come from the atlas — never treat them as atlas text or as a quotation of the atlas.",
  "[E-prev] holds the assistant's earlier answers.",
  "Respond with STRICT JSON only.",
  '{"contradictions":[{"answer_span":"…","evidence_span":"…","why":"…"}],"notes":"≤30 words"}',
].join("\n");

export function buildRefutePrompt(params: { question: string; answer: string; evidence: EvidenceEntry[] }): Msg[] {
  const { question, answer, evidence } = params;
  const evidenceBlock = evidence.length
    ? evidence
        .map((e) => {
          // "unknown" is anything the source allowlist did not recognise as a
          // registry atlas tool (verifier.ts's classifyToolSource). It must be
          // marked, not left bare: an unmarked entry reads as retrieved atlas
          // text, which is exactly the promotion the allowlist exists to stop.
          const tag =
            e.sourceClass === "reference"
              ? " [REFERENCE]"
              : e.sourceClass === "user"
                ? " [USER NOTE, not Atlas]"
                : e.sourceClass === "unknown"
                  ? " [NOT ATLAS]"
                  : "";
          return `${e.label}${tag} ${e.tool}(${e.args}) →\n${e.content}`;
        })
        .join("\n\n")
    : "(no tools were called this turn — nothing to compare against)";
  return [
    { role: "system", content: REFUTE_PROMPT },
    {
      role: "user",
      content: [`## Question\n${question}`, `## Answer to audit\n${answer}`, `## Evidence retrieved this turn\n${evidenceBlock}`].join("\n\n"),
    },
  ];
}

export interface RawContradiction {
  answer_span: string;
  evidence_span: string;
  why: string;
}

export interface RefuteParse {
  contradictions: RawContradiction[];
  notes: string;
}

export function parseRefute(text: string): RefuteParse | null {
  const j = parseJsonish(text);
  if (!j) return null;
  const rawContradictions = Array.isArray(j.contradictions) ? j.contradictions : [];
  const contradictions: RawContradiction[] = rawContradictions.flatMap((c) => {
    const o = c as Record<string, unknown>;
    // Rows missing either span are unreadable judgements, not evidence
    // against the answer — drop, never coerce into a claim we can't check.
    if (typeof o?.answer_span !== "string" || typeof o?.evidence_span !== "string") return [];
    if (!o.answer_span.trim() || !o.evidence_span.trim()) return [];
    return [{ answer_span: o.answer_span, evidence_span: o.evidence_span, why: typeof o.why === "string" ? o.why : "" }];
  });
  return { contradictions, notes: typeof j.notes === "string" ? j.notes : "" };
}

// Nearest `"id":"<uuid>"` / `"uuid":"<uuid>"` preceding the matched span
// inside its evidence entry, read off the SAME normalized text the span was
// located in (normalizeForMatch strips the JSON quotes, so the pattern reads
// `id:<uuid>` / `uuid:<uuid>`, not the quoted form). Best-effort and
// informational only — never affects the verdict, so an approximate match
// position (first shared token, when the span isn't an exact quote) is a fine
// trade against the alternative of always resolving null on a fuzzy match.
const ID_FIELD_RE = /\b(?:id|uuid):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

function resolveUuid(entry: EvidenceEntry, span: string): string | null {
  const normContent = normalizeForMatch(entry.content);
  const normSpan = normalizeForMatch(span);
  if (!normSpan) return null;
  let pos = normContent.indexOf(normSpan);
  if (pos === -1) {
    for (const t of tokenize(normSpan)) {
      const i = normContent.indexOf(t);
      if (i !== -1) { pos = i; break; }
    }
  }
  if (pos === -1) return null;
  const re = new RegExp(ID_FIELD_RE.source, "gi");
  let last: string | null = null;
  for (let m = re.exec(normContent); m; m = re.exec(normContent)) {
    if (m.index >= pos) break;
    last = m[1];
  }
  return last;
}

// THE BACKSTOP. A model-asserted contradiction is only honoured when both
// halves check out in code: `answer_span` really is (close to) a sentence in
// the answer, and `evidence_span` really is (close to) text in the evidence.
// Neither check is ever relaxed — unlike the old support-side exemptions,
// there is no "descriptive prose" carve-out here: a fabricated contradiction
// is a hard-failure-adjacent claim (it can flip `overall` to fail), so both
// spans stay on the strict bar.
export function validateContradictions(
  raw: RawContradiction[],
  answer: string,
  evidence: EvidenceEntry[],
): { kept: Contradiction[]; discarded: number } {
  const normAnswer = normalizeForMatch(stripLinkMarkup(answer));
  const kept: Contradiction[] = [];
  let discarded = 0;
  for (const c of raw) {
    const normAnswerSpan = normalizeForMatch(stripLinkMarkup(c.answer_span));
    if (!normAnswerSpan || spanOverlap(normAnswerSpan, normAnswer) < SPAN_MATCH_THRESHOLD) {
      discarded++;
      continue;
    }
    const { best, entryIndex } = locateSpan(c.evidence_span, evidence);
    if (entryIndex === -1 || best < SPAN_MATCH_THRESHOLD) {
      discarded++;
      continue;
    }
    const entry = evidence[entryIndex];
    kept.push({
      answer_span: c.answer_span,
      evidence_span: c.evidence_span,
      why: c.why,
      evidence_label: entry.label,
      uuid: resolveUuid(entry, c.evidence_span),
      source: "model",
      agreed: false,
    });
  }
  return { kept, discarded };
}

// The judge used to also return `not_found` — its own assertion that it could
// not locate a statement in the evidence — which the reader saw as "N
// statements the retrieved sources don't cover". It was the last surviving
// channel of the pre-2026-09-10 "prove every claim supported" design that the
// refutation-only redesign otherwise replaced, it never fed the verdict, and
// it never produced signal: it needed a validation pass the day after it
// shipped (a defined term listed as uncovered) and was still reporting the
// answer's own headings, the user's question echoed back and colon lead-ins a
// fortnight later. Removed entirely on 2026-09-23. Absence is now simply not
// reported — which is what refutation-only meant in the first place.
