// Quote attribution lane for tier-B spans. "shadow" (default) only records:
// it must not move a verdict (see config.chatQuoteAttribution). "gate" clears
// spans judged not to be quotation.
import { config } from "../../config.ts";
import { findUngroundedQuoteSpans, isFailed, type CheckReport } from "../verify/verify-checks.ts";
import {
  judgeQuoteAttribution,
  spansJudgedNotQuotation,
  spansPresentedAsQuotation,
  type QuoteAttributionRun,
} from "../verify/quote-attribution.ts";
import type { HarnessCtx } from "./context.ts";
import type { CheckRowMeta, DoneEvent } from "./types.ts";

type QuoteSpan = ReturnType<typeof findUngroundedQuoteSpans>[number];

export interface QuoteLane {
  spans: QuoteSpan[];
  promise: Promise<QuoteAttributionRun> | null;
}

export function startQuoteLane(ctx: HarnessCtx, done: DoneEvent, atlasTexts: string[]): QuoteLane {
  const { opts } = ctx;
  const spans =
    config.chatQuoteAttribution === "off" || !config.chatQuoteAttributionModel
      ? []
      : findUngroundedQuoteSpans(done.content, atlasTexts, opts.ix, opts.question).filter((s) => !s.attributed);
  const promise =
    spans.length > 0
      ? judgeQuoteAttribution({ spans, model: config.chatQuoteAttributionModel, signal: opts.signal, obs: opts.obs })
      : null;
  promise?.catch(() => {});
  return { spans, promise };
}

// `gate` mode only. Resolved before the audit row is built, because the verify
// row stores computeOverall(checks, …), so a later filter would persist a
// verdict that disagrees with the badge the reader sees.
export function gateQuotes(checks: CheckReport, spans: QuoteSpan[], qa: QuoteAttributionRun): CheckReport {
  // Only tier-B spans are the lane's to clear; tier A never reached it.
  const tierB = new Set(spans.map((s) => s.text));
  // spansJudgedNotQuotation, NOT the complement of spansPresentedAsQuotation:
  // a span whose judgement failed, or that fell past the lane's span cap, has
  // no verdict and must KEEP its finding. Fail-open means a Jev outage never
  // hard-fails an answer; it must not also mean an outage clears every quote
  // finding the deterministic check made on its own.
  const cleared = spansJudgedNotQuotation(qa, config.chatQuoteAttributionMargin);
  const ungroundedQuotes = checks.ungroundedQuotes.filter((q) => !(tierB.has(q) && cleared.has(q)));
  if (ungroundedQuotes.length === checks.ungroundedQuotes.length) return checks;
  // isFailed, not a local re-OR: dropping a span must be able to clear the
  // turn, and only if nothing else failed it.
  return { ...checks, ungroundedQuotes, failed: isFailed({ ...checks, ungroundedQuotes }) };
}

// Recorded in every mode; ACTED ON only in `gate`. The row is this lane's own
// calibration record — the same role Verdict.contradictions plays for the
// audit — and it is what the bakeoff will be fitted against, so it stores the
// raw probability per span and the mode that was in force, not a decision.
export function quoteAttributionRow(qa: QuoteAttributionRun, spansConsidered: number): CheckRowMeta {
  return {
    kind: "quote_attribution", model: config.chatQuoteAttributionModel,
    verdict: {
      mode: config.chatQuoteAttribution,
      margin: config.chatQuoteAttributionMargin,
      judgements: qa.judgements,
      // What severity WOULD have changed to under `gate`, recorded so the
      // shadow run can be scored without replaying the answer.
      wouldPromote: [...spansPresentedAsQuotation(qa, config.chatQuoteAttributionMargin)],
      spansConsidered,
    },
    overall: null,
    inputTokens: qa.usage?.input ?? null, outputTokens: qa.usage?.output ?? null,
    generationId: null, latencyMs: qa.latencyMs,
  };
}
