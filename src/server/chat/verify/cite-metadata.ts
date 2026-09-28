// Sibling of A1 (cite-support.ts) — "is this claim backed up by the RECORD
// it was drawn from?" Not yet in docs/plans/jev-typesafe.md.
//
// `cite-support.ts` asks whether a cited DOCUMENT states a claim, which is
// the right question only when the model actually read the document. Some
// turns never do that: they surface a document by its IDENTITY only — one
// row of `atlas_recent_changes`, say, carrying `{doc_id, committed_at,
// change_type, pr_number, pr_title, summary}` — and a claim built from that
// row was never sourced from the document's content at all. Asking
// cite-support's question about a row like that forces `says_nothing`
// (nothing there states the claim, because the row isn't the document) on a
// citation that may be perfectly correct about what the row says. This check
// asks the question the record can actually answer: does the RECORD support
// the claim, not does the DOCUMENT.
//
// A claim sourced from a record can still be wrong — it can misread the
// record's date, PR number, or change type. That is what `contradicts` is
// for.
//
// Same design lesson as cite-support.ts: every false-flag cause found there
// was a MISSING OUTCOME that forced the model into a wrong answer
// (supports_in_part, about_document). `says_nothing` and `states_content`
// below exist for the same reason — without them, a record that is silent,
// or a claim about the document's current content, has no honest answer.
import { askJev, choiceOf, withDeadline, type JevChoiceAnswer } from "../../jev.ts";

export type MetadataVerdict = "supports" | "says_nothing" | "contradicts" | "states_content";
// Exported as a value, not just the type, because a stored check payload has
// to be validated against the same list when it is read back — the union
// alone can't do that at runtime, and a second literal copy is how a new
// verdict comes to be silently dropped on reload only. Same reasoning as
// cite-support.ts's `VERDICTS`.
export const METADATA_VERDICTS: string[] = ["supports", "says_nothing", "contradicts", "states_content"];

// One narrow judgment over one (claim, record) pair.
export const METADATA_QUESTION = {
  type: "choice" as const,
  instructions:
    "Read the object in `record` — one history/listing row that surfaced a document, not the document's content. Decide how it relates to the single statement in `claim`, which was written using that row as its source. Judge ONLY against `record`.",
  // Order is the gradient the reader cares about: backed, silent, contradicted,
  // then the different-axis case last. JSON key order reaches Jev as written,
  // so this is deliberate, matching cite-support.ts's own note on this.
  criteria: {
    supports: "The record states what the claim says about it — the same date, PR number, change type, author, or document that the claim asserts.",
    says_nothing: "The record does not cover what the claim asserts about it. Use this when the claim may well be true but this record does not establish it.",
    contradicts:
      "The record says otherwise: a different date, pull request number, change type, author, or a different document than the claim asserts.",
    // The load-bearing option. A record like `atlas_recent_changes` reports
    // that a document CHANGED — it never carries what the document now says.
    // Real example: "On September 17, 2026 (PR #336), the Rate Limits was
    // updated to set the USDS burn and USDC-to-USDS swap rate limits to
    // unlimited." The date and the PR number are checkable against the
    // record — those clauses can be `supports` or `contradicts`. "to set the
    // rate limits to unlimited" asserts what the document's content now
    // says, and no change record can support or contradict that, because a
    // record of a change is not a copy of the changed text. Use this option
    // for exactly that clause: a claim asserting what the document SAYS,
    // when only its having changed is on record.
    states_content:
      "The claim asserts what the DOCUMENT ITSELF SAYS or now contains — its substance, wording, or a rule it states — rather than a fact about the change event the record describes (when it changed, who changed it, what kind of change, which document). A record of a change cannot establish what a document says, only that it changed, so no record can support or contradict this kind of claim.",
  },
};

/**
 * Builds the request for one (claim, record) pair. Pure — no network — so
 * the state and question can be asserted in a test without spending
 * anything.
 *
 * `record` is the ONE JSON object that surfaced this document in the turn's
 * tool results — one history event, one listing row — never the whole tool
 * result and never the transcript. Jev's accuracy degrades as irrelevant
 * state grows (cite-support.ts's reasoning for sending a cited doc without
 * its children applies here too), and a record is small by construction: a
 * single row's worth of scalar fields, not a document body. Sent as-is, with
 * no size cap, for that reason.
 */
export function buildMetadataRequest(
  claim: string,
  record: unknown,
): { state: unknown; questions: Record<string, typeof METADATA_QUESTION> } {
  return { state: { claim, record }, questions: { metadata: METADATA_QUESTION } };
}

export interface MetadataJudgement {
  verdict: MetadataVerdict | null;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  generationId: string | null;
}

const FAILED: MetadataJudgement = { verdict: null, probabilities: null, confidence: null, latencyMs: null, costUsd: null, generationId: null };

/**
 * Judges one (claim, record) pair. Fail-open (verdict null, never a
 * fabricated `contradicts`): this check can only ever ADD a finding, so a
 * failure must mean "no finding", exactly like cite-support.ts's
 * `judgeCitation`.
 */
export async function judgeMetadata(params: {
  claim: string;
  record: unknown;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<MetadataJudgement> {
  const req = buildMetadataRequest(params.claim, params.record);
  const deadlineMs = params.timeoutMs ?? 8000;
  const signal = withDeadline(deadlineMs, params.signal);
  try {
    const run = await askJev({ state: req.state, questions: req.questions, model: params.model, signal, timeoutMs: deadlineMs });
    const c: JevChoiceAnswer | null = choiceOf(run, "metadata");
    if (!c || !METADATA_VERDICTS.includes(c.choice)) return FAILED;
    return {
      verdict: c.choice as MetadataVerdict,
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
