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

// --- pass 3: frontier-model escalation on UNCERTAIN residual cases -----------------
// The cheap passes above resolve the confident, corroborated cases; the residual is the
// hard tail (the #117 seam + bulk-rename hops). A frontier model is spent ONLY on the
// uncertain ones, and — keeping the two-independent-signals invariant — its verdict only
// LOCKS a case when it agrees with an existing independent signal; otherwise it's a HINT.

// A confident pick (≥0.9) but a near-tie runner-up means two docs are both plausible.
export const FRONTIER_HI_CONF = 0.95;
export const FRONTIER_RIVAL_MARGIN = 0.05;

// margin between the top two candidate scores (candidates are pre-sorted desc).
function topMargin(kase) {
  const cs = kase.candidates || [];
  return cs.length < 2 ? Infinity : cs[0].score - cs[1].score;
}

// Which uncertainty triggers fire for a residual case (empty set = not frontier-eligible).
// All inputs come from signals the orchestrator already has: matcher score (autoConfidence),
// the forward link, the containment best, and the cheap-LLM pick from pass 2.
export function frontierTriggers(kase, { fwdKey, containKey, cheapKey, hiConf = FRONTIER_HI_CONF, rivalMargin = FRONTIER_RIVAL_MARGIN } = {}) {
  const fired = new Set();
  const conf = autoConfidence(kase);
  // T1 low confidence (also catches flagged-ambiguous: autoKey null → conf 0)
  if (conf < hiConf) fired.add("low-confidence");
  // T2 contested rival: a confident pick shadowed by a near-tie runner-up (catches the
  // >0.95 cases T1 misses — "confident but another doc is also plausible")
  if (kase.autoKey && conf >= 0.9 && topMargin(kase) < rivalMargin) fired.add("contested-rival");
  // T3 the cheap LLM named a DIFFERENT predecessor than the matcher
  if (kase.autoKey && cheapKey && cheapKey !== "none" && cheapKey !== kase.autoKey) fired.add("llm-disagrees");
  // T4 an independent matcher (forward / containment) disagreed with the reverse auto-pick
  if (kase.autoKey && fwdKey && fwdKey !== kase.autoKey) fired.add("forward-disagrees");
  if (kase.autoKey && containKey && containKey !== kase.autoKey) fired.add("containment-disagrees");
  return fired;
}

// Does the frontier's pick line up with an INDEPENDENT existing signal? Only then may the
// case auto-lock (the two-independent-signals invariant). The cheap LLM is deliberately
// NOT a corroborator — two LLMs share failure modes, so that's one signal, not two.
export function frontierCorroborator(chosenKey, { autoKey, fwdKey, containKey } = {}) {
  if (!chosenKey || chosenKey === "none") return null;
  if (autoKey && chosenKey === autoKey) return "matcher";
  if (fwdKey && chosenKey === fwdKey) return "forward";
  if (containKey && chosenKey === containKey) return "containment";
  return null;
}

// Map an auto-resolution mechanism (a decision's `auto`/`via`) to a history-view provenance
// method: the LLM + frontier locks → "ai"; every deterministic pass (matcher, forward∩reverse,
// containment) → "deterministic". A "human" method is decided by the caller (absence of an auto
// mechanism), not here. Used by the freeze to tag HTML-era events with how each link was traced.
export function mechanismToMethod(via) {
  return via === "llm-90" || via === "llm-95" || via === "frontier" ? "ai" : "deterministic";
}
