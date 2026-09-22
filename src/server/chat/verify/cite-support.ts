// A1 — "is this claim backed up by the doc it references?"
//
// A per-citation check, which is what makes it DIFFERENT from the shipped
// `refute` auditor rather than a duplicate of it. Refute pools every tool
// result for the turn and asks what the evidence contradicts; it never asks
// which document a sentence LINKS to. So a statement that is true somewhere
// in the pooled evidence but cites the wrong doc passes refute cleanly — and
// the atlas makes that easy to do, with 142 same-titled "Rate Limits"
// documents, one per agent. This check pairs ONE sentence with the ONE
// document it cites and asks only about that pair.
//
// The lexical ancestor of this check already ships and is DARK:
// findLowOverlapCitations (verify-checks.ts) computes exactly these pairs,
// scores word overlap, writes the result into CheckReport.lowOverlapCitations
// — and nothing reads it. This module is its semantic successor. Pair
// extraction lives in cite-pairs.ts and still segments with the same
// `claimSegments`, so the two can never disagree about what a sentence is.
//
// NOTHING ON A REQUEST PATH CALLS THIS YET. It exists to be measured
// (scripts/eval/eval-citation.ts). See docs/plans/jev-typesafe.md §A1 for the
// wiring design and the bar it has to clear first.
import { askJev, choiceOf, type JevChoiceAnswer } from "../../jev.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { CitationPair } from "./cite-pairs.ts";

export { citationPairs, type CitationPair } from "./cite-pairs.ts";

export type CiteVerdict = "supports" | "contradicts" | "says_nothing" | "about_document";
const VERDICTS: string[] = ["supports", "contradicts", "says_nothing", "about_document"];

// One narrow judgment. `says_nothing` has to be a first-class option, not an
// absence: without it the model is forced to choose between two wrong answers
// on a citation whose doc is merely irrelevant, which is the single most
// common real case.
export const CITE_QUESTION = {
  type: "choice" as const,
  instructions:
    "Read the document in `cited_doc`. Decide how it relates to the single statement in `claim`, which was written with a link to that document as its source. Judge ONLY against `cited_doc`; other documents may also be relevant but are not the question.",
  criteria: {
    supports:
      "The document states the claim, or the claim is a faithful paraphrase or direct consequence of what it states. A claim narrower than the document's wording still counts as supported.",
    contradicts:
      "The document states something incompatible with the claim — a different value, holder, date, status, count, or a different modality (the document says may where the claim says must).",
    says_nothing:
      "The document is simply not about this claim, or covers the topic without stating what the claim asserts. Use this when the claim may well be true but this particular document does not establish it.",
    // The third false-flag cause the first bakeoff found. "Documents regarding
    // Instance Financial CRRs show high modification counts" links the doc it
    // is ABOUT; no document can state its own edit history, so without this
    // option the only honest answer was says_nothing — a false flag on a
    // correct citation. The link is a pointer, not a source.
    about_document:
      "The claim is about the cited document ITSELF rather than drawn from what it says — that it exists, its title, where it sits in the atlas, how often it was edited, or that it is where some topic is covered. The link points the reader at the document; it is not offered as evidence for a fact the document states.",
  },
};

/** The original three-option question, kept so the bakeoff can show what the pointer option buys. */
export const CITE_QUESTION_3 = {
  ...CITE_QUESTION,
  criteria: { supports: CITE_QUESTION.criteria.supports, contradicts: CITE_QUESTION.criteria.contradicts, says_nothing: CITE_QUESTION.criteria.says_nothing },
};
type CiteQuestion = typeof CITE_QUESTION | typeof CITE_QUESTION_3;

/**
 * Builds the request for one pair. Pure — no network — so the state and the
 * question can be asserted in a test without spending anything.
 *
 * `withChildren` exists because of atomization: since the atlas split into one
 * document per node, a parent's own content no longer contains its children's
 * text, so a sentence citing a parent reads `says_nothing` on the parent alone.
 * The eval measures both ways; which one ships is a measured decision, not a
 * guess. Children are title+content, truncated, and capped — Jev's accuracy
 * degrades as irrelevant state grows, so this is a budget, not a dump.
 */
export function buildCiteRequest(
  pair: CitationPair,
  ix: Indexes,
  opts: { withChildren?: boolean; maxChildren?: number; maxChildChars?: number; question?: CiteQuestion } = {},
): { state: unknown; questions: Record<string, CiteQuestion> } | null {
  const doc = ix.docMap.get(pair.uuid);
  if (!doc) return null; // an unknown uuid is already a hard failure elsewhere
  const cited: Record<string, unknown> = { title: doc.title, content: doc.content };
  if (opts.withChildren) {
    const kids = (ix.childrenIndex.get(pair.uuid) ?? []).slice(0, opts.maxChildren ?? 12);
    if (kids.length) {
      cited.children = kids.map((k) => ({ title: k.title, content: k.content.slice(0, opts.maxChildChars ?? 1200) }));
    }
  }
  return { state: { claim: pair.claim, cited_doc: cited }, questions: { support: opts.question ?? CITE_QUESTION } };
}

export interface CiteJudgement {
  verdict: CiteVerdict | null;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  generationId: string | null;
}

const FAILED: CiteJudgement = { verdict: null, probabilities: null, confidence: null, latencyMs: null, costUsd: null, generationId: null };

/**
 * Judges one pair. Fail-open (verdict null, never a fabricated `contradicts`):
 * this check can only ever ADD a finding, so a failure must mean "no finding",
 * exactly like the rest of the harness treats a judge that did not answer.
 */
export async function judgeCitation(params: {
  pair: CitationPair;
  ix: Indexes;
  model?: string;
  withChildren?: boolean;
  question?: CiteQuestion;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<CiteJudgement> {
  const req = buildCiteRequest(params.pair, params.ix, { withChildren: params.withChildren, question: params.question });
  if (!req) return FAILED;
  const deadlineMs = params.timeoutMs ?? 8000;
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline;
  try {
    const run = await askJev({ state: req.state, questions: req.questions, model: params.model, signal, timeoutMs: deadlineMs });
    const c: JevChoiceAnswer | null = choiceOf(run, "support");
    if (!c || !VERDICTS.includes(c.choice)) return FAILED;
    return {
      verdict: c.choice as CiteVerdict,
      probabilities: c.probabilities ?? null,
      confidence: typeof c.confidence === "number" ? c.confidence : null,
      latencyMs: run.latencyMs,
      costUsd: run.cost,
      generationId: run.generationId,
    };
  } catch {
    return FAILED;
  }
}
