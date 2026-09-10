// Absence-claim contract (docs/research/synlang-wiki.md §3.1 background: the
// Phase 0 A/B found a "false absence" epidemic — the chatbot answering "the
// atlas does not specify X" when X has a configured value, uncontested).
//
// Under the refutation-only redesign, an absence sentence with a real
// parameter-table value IS a contradiction — the parameter table refutes it —
// so this module now synthesizes `Contradiction` candidates directly,
// consumed the same way as verify/refute.ts's model-found ones (both flow
// into sliced-verifier.ts's confirm gate before they can affect `overall`).
//
// A sentence the answer never wrote as an absence claim, or one that names no
// KNOWN parameter, is left alone — this module has no "grounded" or
// "unverified" outcome any more. Precision over recall: a hit counts only
// when the sentence also names the row's OWNER, because these are raw
// sentences a judge never isolated as claims (verify-checks.ts's ABSENCE
// pattern is loose on purpose), so the owner check is the bar that keeps a
// same-named-but-different-entity row from firing a false contradiction.
import type { Indexes } from "../../retrieval/indexes.ts";
import type { Contradiction } from "./verifier.ts";
import { ABSENCE, contentWords } from "./verify-checks.ts";
import { findParamsMentioned, formatParamValue } from "./param-checks.ts";

// Best refuting row for a sentence: literal name-token matches outrank
// title-only matches (more specific — the sentence named the actual kv key),
// and among ties a longer name is more specific still. findParamsMentioned
// already excludes ambiguous title/owner matches (verify-checks.ts's
// safeTitleOwnerUuids gate) — refuting an absence claim is a hard-failure-
// adjacent action, so it needs that same precision bar, not a laxer one.
function bestRefutingMatch(sentence: string, ix: Indexes) {
  const active = findParamsMentioned(sentence, ix);
  if (active.length === 0) return null;
  return [...active].sort((a, b) => (a.byTitle !== b.byTitle ? (a.byTitle ? 1 : -1) : b.row.name.length - a.row.name.length))[0];
}

// Stateless (non-global) — safe to reuse across iterations without lastIndex
// bookkeeping.
const ABSENCE_TEST = new RegExp(ABSENCE, "i");

// Every content-word token of the owner must appear among the sentence's
// content words — folded/cased the same way findParamsMentioned itself
// thinks about owners, so a multi-word owner ("Spark Foundation") or a
// pluralized mention doesn't miss on a technicality.
function ownerNamedIn(owner: string | null | undefined, sentence: string): boolean {
  if (!owner) return false;
  const ownerTokens = contentWords(owner);
  if (ownerTokens.length === 0) return false;
  const sentenceTokens = new Set(contentWords(sentence));
  return ownerTokens.every((t) => sentenceTokens.has(t));
}

// Naive but adequate sentence split: markdown lines, then sentence ends.
// Mirrors verify-checks.ts's claimSegments/countUncitedParagraphs split
// (that helper isn't exported) — kept local rather than exported since no
// other module needs sentence granularity today.
function splitSentences(answer: string): string[] {
  return answer
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function refuteAbsenceSentences(answer: string, ix: Indexes): Contradiction[] {
  const out: Contradiction[] = [];
  for (const sentence of splitSentences(answer)) {
    if (!ABSENCE_TEST.test(sentence)) continue;
    const match = bestRefutingMatch(sentence, ix);
    if (!match) continue;
    const { row } = match;
    if (!ownerNamedIn(row.owner, sentence)) continue;
    out.push({
      answer_span: sentence,
      evidence_span: `${row.name}${row.owner ? ` (${row.owner})` : ""} = ${formatParamValue(row)} (${row.doc_no})`,
      why: "the parameter table records a value for it",
      evidence_label: "[E-const]",
      uuid: row.uuid,
      source: "param-table",
      agreed: false,
    });
  }
  return out;
}
