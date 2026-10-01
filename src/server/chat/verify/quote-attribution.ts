// Does the answer PRESENT this quoted span as wording taken from a source, or as
// its own words? One Jev Noul per ungrounded span.
//
// This is the half of the quote check that is a language judgement rather than a
// lookup, and verify-checks.ts used to answer it with a regex: a blockquote was
// the model's own callout if ~90% of the line was bold (`isSelfAuthoredCallout`).
// That missed the common shape — a plain-prose lead-in ("The practical lesson
// is:") over an unbolded synthesis — and hard-failed three such callouts in one
// live answer on 2026-10-01. `findUngroundedQuoteSpans` now settles only the
// unambiguous half in code (tier A: the lead-in both names a source AND asserts
// it says this) and leaves the rest to this lane.
//
// Why its own request per span, and not somewhere cheaper:
//   - NOT a second question on the citation_check request. cite-support.ts:62-73
//     measured that exact move degrading the answer it was checking (false flags
//     on real citations 4 → 7 for no gain in catch rate), and judgeCitation only
//     sees CITED spans anyway — an uncited blockquote produces no pair at all,
//     which is precisely the over-firing case.
//   - NOT a runConfirm candidate. confirm.ts:40-45 shows the auditor three
//     strings per candidate, one of which is the EVIDENCE span. An ungrounded
//     quote has no evidence span; absence of grounding is not a contradiction.
//     absence.ts gets away with that shape only because it has a real
//     parameter-table value to put there.
//   - One span per request, not N questions over one state: cite-support.ts
//     records both that multi-question requests cost accuracy (:62-73) and that
//     Jev degrades as irrelevant state grows (:131-134). The state here is two
//     short strings, which is less context than any other verification call.
//
// Fail-open, like every other Jev verification lane in this repo
// (cite-support.ts:165-168, citation-marks.ts:384-392,
// answer-coverage.ts:140-143; only the small-talk judge is fail-closed, and
// deliberately). A timeout must never hard-fail an answer — that is the bug this
// lane exists to fix.
import { askJev, noulOf, withDeadline } from "../../jev.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";

/** Caller-owned wall clock: askJev's own timeoutMs is per ATTEMPT and it retries. */
export const QUOTE_ATTRIBUTION_DEADLINE_MS = 3000;
/**
 * Spans judged per answer. An answer with more ungrounded quoted spans than this
 * has a bigger problem than attribution, and the cap bounds the request count to
 * something that fits one deadline in parallel.
 */
export const QUOTE_ATTRIBUTION_MAX_SPANS = 6;

/**
 * Jev reads LITERALLY, so the criteria name the two classes by what the LEAD-IN
 * does, not by how the span is formatted — formatting is exactly what the old
 * regex got wrong. The dangerous direction is `true` on a self-authored callout
 * (a red badge on an honest answer), so the ambiguous case is pushed to `false`
 * explicitly, the same way SMALLTALK_QUESTION pushes its ambiguous case to the
 * fail-closed side.
 */
export const QUOTE_ATTRIBUTION_QUESTION = {
  type: "noul" as const,
  instructions:
    "In an answer written by a research assistant for the Sky ecosystem governance atlas, the text in `passage` was set apart as a quotation (a block quote, or inside quotation marks). `lead_in` is the text immediately before it. The assistant is presenting `passage` as wording taken from a source document.",
  criteria: {
    true:
      "The lead-in attributes the passage to a document, to the atlas, or to a named source — it says or implies that the source's own wording follows (\"A.2.4.1 states:\", \"the atlas says:\", \"quoting the Scope:\", \"the text reads:\"). Also true when the lead-in introduces the passage as an excerpt, definition, or requirement copied from somewhere.",
    false:
      "The lead-in presents the passage as the assistant's OWN words: a conclusion, summary, takeaway, bottom line, practical lesson, consequence, recommendation, caveat, paraphrase, worked example, or an illustration the assistant wrote. Also false when the lead-in merely mentions or describes a document without claiming the passage is its wording (\"A.1.7.1 covers Operational Facilitators\"), when the passage is an example question a reader might ask, or when the lead-in says the source does NOT contain something. When it could go either way, false.",
  },
};

export interface QuoteAttributionJudgement {
  /** The normalized span, as findUngroundedQuoteSpans produced it. */
  span: string;
  /** P(presented as a quotation). null when the call failed — never coerced to 0 or 1. */
  p: number | null;
}

export interface QuoteAttributionRun {
  judgements: QuoteAttributionJudgement[];
  usage: { input: number; output: number } | null;
  costUsd: number | null;
  latencyMs: number | null;
}

/**
 * Judges each span independently. Never throws and never rejects: a span whose
 * call failed comes back with `p: null`, which no caller may read as either
 * verdict.
 */
export async function judgeQuoteAttribution(params: {
  spans: { text: string; leadIn: string }[];
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  obs?: ErrorContext;
}): Promise<QuoteAttributionRun> {
  const spans = params.spans.slice(0, QUOTE_ATTRIBUTION_MAX_SPANS);
  if (spans.length === 0) return { judgements: [], usage: null, costUsd: null, latencyMs: null };
  const deadlineMs = params.timeoutMs ?? QUOTE_ATTRIBUTION_DEADLINE_MS;
  // ONE deadline shared by every span, so the lane's total wall clock is the
  // deadline rather than the deadline times the span count.
  const signal = withDeadline(deadlineMs, params.signal);
  const started = Date.now();

  const results = await Promise.all(
    spans.map(async (s): Promise<{ j: QuoteAttributionJudgement; usage: QuoteAttributionRun["usage"]; cost: number | null }> => {
      try {
        const run = await askJev({
          lane: "quote-attribution",
          // The lead-in is capped harder than the passage: it is context for
          // reading the passage, and a long one is a paragraph of prose whose
          // tail says nothing about attribution.
          state: { lead_in: s.leadIn.replace(/\s+/g, " ").trim().slice(-400), passage: s.text.slice(0, 1200) },
          questions: { quoted: QUOTE_ATTRIBUTION_QUESTION },
          model: params.model,
          signal,
          timeoutMs: deadlineMs,
        });
        return { j: { span: s.text, p: noulOf(run, "quoted") }, usage: run.usage, cost: run.cost };
      } catch (err) {
        captureError(err, params.obs, { stage: "quote_attribution", model: params.model });
        return { j: { span: s.text, p: null }, usage: null, cost: null };
      }
    }),
  );

  const usage = results.reduce<QuoteAttributionRun["usage"]>((acc, r) => {
    if (!r.usage) return acc;
    return { input: (acc?.input ?? 0) + r.usage.input, output: (acc?.output ?? 0) + r.usage.output };
  }, null);
  const costs = results.map((r) => r.cost).filter((c): c is number => c !== null);
  return {
    judgements: results.map((r) => r.j),
    usage,
    costUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    latencyMs: Date.now() - started,
  };
}

/**
 * Which tier-B spans a `gate`-mode caller should keep as hard failures.
 *
 * A null judgement (call failed, or the span was past the cap and never asked)
 * is NOT a failure: the lane is fail-open, so an unjudged span is dropped rather
 * than assumed guilty. That is the whole severity change `gate` makes, and it is
 * why `off`/`shadow` must not call this.
 */
export function spansPresentedAsQuotation(run: QuoteAttributionRun, margin: number): Set<string> {
  const out = new Set<string>();
  for (const j of run.judgements) if (j.p !== null && j.p >= margin) out.add(j.span);
  return out;
}

/**
 * Which tier-B spans a `gate`-mode caller may CLEAR: the ones the model
 * affirmatively judged to be the assistant's own words.
 *
 * The distinction from "not in `spansPresentedAsQuotation`" is load-bearing and
 * was a live bug on PR #436. That set holds `p >= margin`, so its complement
 * silently folds together two different things: a span judged BELOW the margin
 * (the model read it as self-authored — safe to clear) and a span with NO
 * judgement at all (`p: null` from a timeout or transport error, or never asked
 * because it fell past QUOTE_ATTRIBUTION_MAX_SPANS). Gating on the complement
 * therefore let a Jev outage clear every quote finding the deterministic check
 * had made. Fail-open means a failed call must not hard-fail an answer; it does
 * NOT mean a failed call may erase a failure code already found on its own.
 */
export function spansJudgedNotQuotation(run: QuoteAttributionRun, margin: number): Set<string> {
  const out = new Set<string>();
  for (const j of run.judgements) if (j.p !== null && j.p < margin) out.add(j.span);
  return out;
}
