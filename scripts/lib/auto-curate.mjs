// Pure decision logic for the offline auto-curation passes (plan §10.4) — the rules
// that decide whether a curation case can be resolved WITHOUT a human, and how. Kept
// pure (no IO/LLM/git) so it is unit-testable; the orchestrator
// scripts/aux/auto-curate-html-history.mjs supplies the forward links + LLM votes.
//
// The whole point is to shrink the hand-review queue SAFELY, so every auto-rule needs
// TWO INDEPENDENT signals to agree before it locks a case — never a single method's
// guess:
//   1. forward∩reverse — the independent forward tracer (mutual-best, knows nothing
//      of the seed/backward stitching) named the SAME predecessor as the reverse
//      matcher's auto-pick. Deterministic, no LLM. This is the strongest signal: two
//      structurally different matchers converged.
//   2. LLM∩matcher — for a case the forward pass did NOT corroborate but whose matcher
//      pick is ≥90% confident, an LLM second opinion names the SAME predecessor.
//
// A case the matcher abstained on (autoKey === null — a flagged-ambiguous row) is
// NEVER auto-resolved here: there is no matcher pick for a second signal to agree
// with, so it always goes to a human.

// Matcher confidence ≥ this makes a case eligible for the LLM cross-check (mechanism
// 2). Below the forward∩reverse bar of mechanism 1, which needs no score (agreement
// between two independent matchers is itself the confidence).
export const LLM_CONFIRM_THRESHOLD = 0.9;

// The matcher's own confidence in its auto-pick = that candidate's similarity score
// (0 when the matcher abstained or its pick isn't among the scored candidates).
export function autoConfidence(kase) {
  if (!kase.autoKey) return 0;
  const c = kase.candidates.find((cand) => cand.key === kase.autoKey);
  return c ? c.score : 0;
}

// Mechanism 1: the forward pass independently chose the same older doc the reverse
// matcher did. `fwdOlderKey` is the forward pass's predecessor key for this case's
// subject (from forwardLinks), or null/undefined for a forward-birth.
export function forwardAgrees(kase, fwdOlderKey) {
  return !!kase.autoKey && !!fwdOlderKey && fwdOlderKey === kase.autoKey;
}

// Mechanism 2 eligibility: the matcher made a pick AND was ≥ threshold confident, so
// it's worth spending an LLM call to look for a corroborating second opinion.
export function llmEligible(kase, threshold = LLM_CONFIRM_THRESHOLD) {
  return !!kase.autoKey && autoConfidence(kase) >= threshold;
}

// Mechanism 2 decision: the LLM agreed with the matcher's confident pick.
export function llmConfirms(kase, llmChosenKey) {
  return !!kase.autoKey && !!llmChosenKey && llmChosenKey === kase.autoKey;
}

// Resolve a case against the available signals. Returns the chosen older-doc key + the
// mechanism that resolved it, or null when the case still needs a human. `llmChosenKey`
// is undefined when the LLM wasn't consulted (forward already agreed, case ineligible,
// or --no-llm).
export function resolveCase(kase, fwdOlderKey, llmChosenKey) {
  if (forwardAgrees(kase, fwdOlderKey)) return { chosenKey: kase.autoKey, via: "forward-reverse" };
  if (llmChosenKey !== undefined && llmConfirms(kase, llmChosenKey)) return { chosenKey: kase.autoKey, via: "llm-90" };
  return null;
}
