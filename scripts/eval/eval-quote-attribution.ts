// Offline bakeoff for the quote-attribution seat (CHAT_QUOTE_ATTRIBUTION_MODEL).
//
// ============================ NEVER RUN =====================================
// As of 2026-10-01 this script has NEVER BEEN EXECUTED. It was written with the
// lane, but the container it was written in could not run it: the OpenRouter
// account returns `402 Insufficient credits`, and the real-traffic false-fire
// check below additionally needs a DATABASE_URL that was not available.
//
// Therefore `config.chatQuoteAttributionMargin` is NOT a measured value. It is
// 0.5 — the neutral point of a Noul, chosen precisely because it encodes no
// claim about the data — and `config.chatQuoteAttribution` ships as "shadow",
// where the lane records judgements and changes no verdict. Do not flip it to
// "gate" on the strength of a number this script has not produced.
// ============================================================================
//
// Runs the SHIPPED path — judgeQuoteAttribution's Noul over the production
// /systemone client — so it measures the function the server runs, never a
// reimplementation.
//
// The error directions are asymmetric (see eval-quote-attribution-cases.ts), so
// the operating point is fitted from the DANGEROUS side: the lowest margin at
// which no self-authored callout is promoted. Promotion is `p >= margin`, so
// that margin is just above the highest `p` any `expected: false` case scores.
// Recall is then whatever share of real attributions clears it.
//
// Fit on half, report on the other half. A margin fitted and reported on the
// same cases is in-sample — refute-screen.ts's threshold carries exactly that
// caveat, and this one must not repeat it.
//
// Usage:  bun scripts/eval/eval-quote-attribution.ts
//         JUDGE_MODELS="typesafe/jev-1.13,typesafe/jev-latest" bun …
//         DATABASE_URL=… bun …   # adds the real-traffic false-fire check
import fs from "node:fs";
import path from "node:path";
import { judgeQuoteAttribution } from "../../src/server/chat/verify/quote-attribution.ts";
import { config } from "../../src/server/config.ts";
import { CASES, splitCases, type QuoteCase } from "./eval-quote-attribution-cases.ts";

const MODELS = (process.env.JUDGE_MODELS ?? config.chatQuoteAttributionModel)
  .split(",").map((s) => s.trim()).filter(Boolean);
const PASSES = Number(process.env.JUDGE_PASSES ?? 2);
const OUT = path.join(".cache", "eval-quote-attribution.json");

interface Scored extends QuoteCase {
  p: number | null;
}

async function scoreAll(cases: QuoteCase[], model: string): Promise<Scored[]> {
  // judgeQuoteAttribution already runs its spans in parallel under one deadline
  // and caps how many it will judge, so the cases are fed through it in chunks
  // of that cap rather than one call per case.
  const out: Scored[] = [];
  const CHUNK = 6;
  for (let i = 0; i < cases.length; i += CHUNK) {
    const batch = cases.slice(i, i + CHUNK);
    const run = await judgeQuoteAttribution({
      spans: batch.map((c) => ({ text: c.passage, leadIn: c.leadIn })),
      model,
      // Generous next to the 3s production deadline: a bakeoff is not latency-
      // bound, and a timeout here would silently read as a null judgement.
      timeoutMs: 20_000,
    });
    for (const [k, c] of batch.entries()) out.push({ ...c, p: run.judgements[k]?.p ?? null });
  }
  return out;
}

/** Lowest margin that promotes no negative. null when some negative scored 1. */
function fitMargin(scored: Scored[]): number | null {
  const negatives = scored.filter((c) => !c.expected && c.p !== null).map((c) => c.p as number);
  if (negatives.length === 0) return null;
  const worst = Math.max(...negatives);
  if (worst >= 1) return null; // no margin can exclude it
  // Just above the worst negative. Rounded up to 2dp so the shipped value is a
  // number a human can read and reason about.
  return Math.min(1, Math.ceil((worst + 0.005) * 100) / 100);
}

function report(label: string, scored: Scored[], margin: number) {
  const promoted = (c: Scored) => c.p !== null && c.p >= margin;
  const pos = scored.filter((c) => c.expected);
  const neg = scored.filter((c) => !c.expected);
  const caught = pos.filter(promoted).length;
  const falseFires = neg.filter(promoted);
  const nulls = scored.filter((c) => c.p === null).length;
  console.log(`\n  ${label} @ margin ${margin}`);
  console.log(`    recall (real attributions caught): ${caught}/${pos.length}`);
  console.log(`    FALSE FIRES (callouts promoted):   ${falseFires.length}/${neg.length}  <- the dangerous direction`);
  if (nulls > 0) console.log(`    unjudged (null, fail-open):        ${nulls}`);
  for (const c of falseFires) {
    console.log(`      ! p=${c.p?.toFixed(3)} ${c.incident ? "[PRODUCTION INCIDENT] " : ""}${c.leadIn.slice(0, 48)} / ${c.passage.slice(0, 48)}`);
  }
  // A regression on a case observed in production is not a tuning decision.
  const incidents = scored.filter((c) => c.incident && promoted(c));
  if (incidents.length > 0) console.log(`    *** ${incidents.length} PRODUCTION INCIDENT(S) would hard-fail again at this margin ***`);
}

async function main() {
  if (!config.openrouterApiKey) {
    console.error("OPENROUTER_API_KEY is not set — this bakeoff needs the live /systemone endpoint.");
    process.exit(1);
  }
  const results: Record<string, unknown> = { ranAt: new Date().toISOString(), passes: PASSES, cases: CASES.length };
  for (const model of MODELS) {
    console.log(`\n=== ${model} (${PASSES} pass${PASSES === 1 ? "" : "es"}, ${CASES.length} cases) ===`);
    // Several passes because a Noul is not perfectly stable; the WORST (highest)
    // p per negative across passes is what the margin must clear, so a margin
    // fitted on one lucky pass is not good enough.
    const perPass: Scored[][] = [];
    for (let i = 0; i < PASSES; i++) perPass.push(await scoreAll(CASES, model));
    const worstCase: Scored[] = CASES.map((c, k) => {
      const ps = perPass.map((p) => p[k].p).filter((p): p is number => p !== null);
      return { ...c, p: ps.length === 0 ? null : c.expected ? Math.min(...ps) : Math.max(...ps) };
    });

    const { fit, held } = splitCases(worstCase as QuoteCase[]) as { fit: Scored[]; held: Scored[] };
    const margin = fitMargin(fit);
    if (margin === null) {
      console.log("  NO MARGIN EXCLUDES EVERY CALLOUT — the classes are not separable on this corpus.");
      console.log("  Do NOT enable gate mode. Either the question wording needs work or the lane does not fly.");
      results[model] = { separable: false, scored: worstCase };
      continue;
    }
    report("fit half", fit, margin);
    report("HELD-OUT half", held, margin);
    report("all cases", worstCase, margin);
    console.log(`\n  Suggested CHAT_QUOTE_ATTRIBUTION_MARGIN=${margin}`);
    console.log("  NOT sufficient on its own: run the real-traffic false-fire check below");
    console.log("  before enabling CHAT_QUOTE_ATTRIBUTION=gate.");
    results[model] = { margin, fit, held, all: worstCase };
  }

  // The check that actually matters, and the one the labeled corpus cannot
  // stand in for. CLAUDE.md records a census lane whose labeled-corpus-only
  // margin fired on 12 of 67 real messages the synthetic negatives never
  // produced. The equivalent here: real assistant answers carry callout shapes
  // nobody thought to write down.
  if (!process.env.DATABASE_URL) {
    console.log("\nNo DATABASE_URL — the real-traffic false-fire check was SKIPPED.");
    console.log("A margin that has only seen this corpus is not ready to gate anything.");
  } else {
    console.log("\nReal-traffic check: not yet implemented.");
    console.log("Read assistant `content` from `messages`, extract tier-B spans with");
    console.log("findUngroundedQuoteSpans, judge them, and count how many of YOUR OWN");
    console.log("shipped answers the margin would newly hard-fail. That count must be 0.");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nWrote ${OUT}`);
}

await main();
