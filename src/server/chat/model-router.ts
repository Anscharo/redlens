// Rules-based per-turn model routing. Classifies the user's message into a
// tier from free deterministic signals only — never a model pre-flight call,
// same principle as the harness's escalation gate: nothing runs before the
// first token except code. Tiers resolve to an OpenRouter model chain
// (primary + fallbacks); unset tier slots inherit the default chain, so with
// no env configured routing is a no-op and CHAT_MODEL behaves as before.
import { config } from "../config.ts";
import type { CitationStyle } from "./system-prompt.ts";
import { looksComplex } from "./complexity.ts";

export type ModelTier = "fast" | "default" | "strong";

export interface Route {
  tier: ModelTier;
  reason: string;
}

// A referenced doc: doc_no shape (signal only — never used as a lookup key) or UUID.
const DOC_NO_RE = /\b[A-Z]{1,3}(?:\.\d+)+\b/;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
// Single-entity lookup openers ("what is X", "define X", "show me X").
const LOOKUP_RE = /^(what( i|')s |what is |define |show (me )?|find |where is |who is )/i;

// Signals that the turn needs cross-document synthesis or careful policy
// interpretation — route UP. Kept narrow: a false "strong" spends money on an
// easy turn, while a missed one still has the verifier as a safety net.
const STRONG_SIGNALS: [RegExp, string][] = [
  [/\b(compare|versus|vs|difference between|differ from)\b/i, "comparison"],
  [/\b(interacts?|conflicts?|contradicts?|overlaps?|reconcile|relationship between)\b/i, "interaction"],
  [/\b(implications?|trade-?offs?|consequences)\b/i, "analysis"],
  [/\b(allowed to|permitted to|violat\w*|comply|compliance|eligib\w*|penalt\w*)\b/i, "governance-risk"],
  // Exhaustive-set questions. "all of the X" / "all the X" is the form the
  // real corpus actually uses ("all of the roles and positions designated by
  // the Atlas") — the relative-pronoun shape below never saw it. Requiring a
  // determiner after "all" keeps the idioms out ("is that all?", "all good").
  [/\ball (of |the |these |those )/i, "enumeration"],
  // The original shape, for "all agents that hold a role". Window widened from
  // 60 to 90: in "all of the token transfers documented in the Atlas and give
  // me a ledger of who sent what" the pronoun sits 72 chars out and was missed.
  [/\ball\b.{0,90}\b(that|which|who)\b/i, "enumeration"],
  // Corpus-wide synthesis: produce a NEW artifact out of many documents rather
  // than retrieve one. Measured 2026-08-21 (docs/chat-system.md §6.5) — every
  // question the strong tier won was enumeration or generation, and the default
  // model's failure mode there is completeness (0.70 vs 0.95), not fabrication.
  [/\b(generate|compile|enumerate|inventory|timeline|trends?)\b/i, "synthesis"],
];

export function routeTier(question: string, opts: { followUp?: boolean } = {}): Route {
  const q = question.trim();
  for (const [re, reason] of STRONG_SIGNALS) {
    if (re.test(q)) return { tier: "strong", reason };
  }
  if ((q.match(/\?/g) ?? []).length >= 2) return { tier: "strong", reason: "multi-part" };
  if (q.length > 350) return { tier: "strong", reason: "long-form" };

  // Second lane: an on-device embedding (~3ms, no network) catches whole-corpus
  // enumeration and synthesis phrased in words the signals above don't watch
  // for — the regexes caught 0 of 28 natural paraphrases (complexity.ts).
  // Deliberately BEFORE the fast check: these questions are often short and
  // lookup-shaped ("map out the entities the atlas recognizes"), so leaving it
  // below would let `fast` claim the exact turns this lane exists to catch.
  // Its own `reason` so PostHog's chat_route_reason meters the lane's fire rate
  // with no new instrumentation. No-op when CHAT_FACT_SIMILARITY=0.
  if (looksComplex(q)) return { tier: "strong", reason: "similarity" };

  // Fast only for clearly-scoped short lookups. A terse follow-up without a doc
  // reference stays default — its brevity leans on conversation context, not on
  // the question being simple.
  const docRef = DOC_NO_RE.test(q) || UUID_RE.test(q);
  if (q.length <= 120 && (docRef || (LOOKUP_RE.test(q) && !opts.followUp))) {
    return { tier: "fast", reason: docRef ? "doc-ref" : "lookup" };
  }
  return { tier: "default", reason: "default" };
}

// Which citation format to ASK this model for. Keyed on the model, not the tier,
// because format compliance is a property of the model — and because the evals
// must be able to reproduce production's choice for any candidate they run
// (scripts/aux/eval-bakeoff.ts). Everything downstream accepts both formats from
// everyone; see system-prompt.ts and docs/plans/reference-citations.md.
//
// The prompt is fixed once per turn from the chain's PRIMARY model, so an
// OpenRouter failover inherits it — list a tier's fallbacks in the allowlist too
// if that tier is asked for reference style, or a failover hands the reference
// prompt to a model that was never measured on it.
export function citationStyleFor(model: string): CitationStyle {
  return config.chatReferenceCitationModels.includes(model) ? "reference" : "inline";
}

// Tier → model chain: first entry is the primary, the rest are OpenRouter
// fallbacks tried in order on provider failure. Unset tier slots inherit the
// default chain so partial configuration can't strand a tier.
export function resolveTierModels(tier: ModelTier): string[] {
  if (tier === "fast" && config.chatModelFast.length) return config.chatModelFast;
  if (tier === "strong" && config.chatModelStrong.length) return config.chatModelStrong;
  return [config.chatModel, ...config.chatModelFallbacks];
}
