// Rules-based per-turn model routing. Classifies the user's message into a
// tier from free deterministic signals only — never a model pre-flight call,
// same principle as the harness's escalation gate: nothing runs before the
// first token except code. Tiers resolve to an OpenRouter model chain
// (primary + fallbacks); unset tier slots inherit the default chain, so with
// no env configured routing is a no-op and CHAT_MODEL behaves as before.
import { config } from "../config.ts";

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
  [/\ball\b.{0,60}\b(that|which|who)\b/i, "enumeration"],
];

export function routeTier(question: string, opts: { followUp?: boolean } = {}): Route {
  const q = question.trim();
  for (const [re, reason] of STRONG_SIGNALS) {
    if (re.test(q)) return { tier: "strong", reason };
  }
  if ((q.match(/\?/g) ?? []).length >= 2) return { tier: "strong", reason: "multi-part" };
  if (q.length > 350) return { tier: "strong", reason: "long-form" };

  // Fast only for clearly-scoped short lookups. A terse follow-up without a doc
  // reference stays default — its brevity leans on conversation context, not on
  // the question being simple.
  const docRef = DOC_NO_RE.test(q) || UUID_RE.test(q);
  if (q.length <= 120 && (docRef || (LOOKUP_RE.test(q) && !opts.followUp))) {
    return { tier: "fast", reason: docRef ? "doc-ref" : "lookup" };
  }
  return { tier: "default", reason: "default" };
}

// Tier → model chain: first entry is the primary, the rest are OpenRouter
// fallbacks tried in order on provider failure. Unset tier slots inherit the
// default chain so partial configuration can't strand a tier.
export function resolveTierModels(tier: ModelTier): string[] {
  if (tier === "fast" && config.chatModelFast.length) return config.chatModelFast;
  if (tier === "strong" && config.chatModelStrong.length) return config.chatModelStrong;
  return [config.chatModel, ...config.chatModelFallbacks];
}
