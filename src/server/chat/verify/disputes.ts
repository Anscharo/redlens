// The one place the two independent dispute lanes are reconciled.
//
// Two assessments can name the same document and disagree, because they ask
// different questions of different models:
//   - citation-marks.ts (Jev, per (claim, cited doc) pair) → the Sources chip
//   - refute.ts (the gemma verifier, per paragraph, over POOLED evidence)
//     → the "N statements disputed by the atlas" list
// Neither is redundant (cite-support.ts's header explains why refute cannot
// see a wrong-doc citation), and both pass their own confirm gate before they
// reach a reader — so when they collide, neither is simply "the wrong one".
//
// Observed 2026-09-24: one answer shipped a confirmed dispute sourced to doc
// 76405733 AND a green ✓ on that same doc in the Sources chips. The chips and
// the dispute list contradicted each other in a single render.
//
// This module is shared by the live path (chat-orchestrator.ts) and the reload
// path (conversations.ts) so a restored conversation reconciles exactly the
// way the live turn did.
import type { CitationMark } from "./citation-marks.ts";

/** An agreed contradiction, in the shape both the wire and this module need. */
export interface AgreedContradiction {
  answer: string;
  evidence: string;
  why: string;
  uuid: string | null;
}

/**
 * Defensive parse of a persisted `message_checks.verdict` payload (kind
 * 'verify', JSONB already deserialized by Bun.sql) down to the contradictions
 * a reader is allowed to see.
 *
 * Two rules it must not break, both inherited from the live path:
 *  - `Verdict.contradictions` stores ALL validated candidates, agreed and not,
 *    as the confirm gate's calibration record. computeOverall is explicit that
 *    an unagreed candidate must never reach a reader — so `agreed === true` is
 *    a hard filter here, exactly as chat-orchestrator.ts's verifyEvent applies
 *    it at the wire.
 *  - Never throws. A payload in a shape this doesn't recognise (a future
 *    format change, a corrupted row) degrades to "no contradictions" for that
 *    message rather than failing the whole conversation load — same discipline
 *    as the other persisted-payload parsers in verify/persisted-verdict.ts.
 */
export function agreedContradictionsFrom(verdict: unknown): AgreedContradiction[] {
  if (!verdict || typeof verdict !== "object") return [];
  const list = (verdict as { contradictions?: unknown }).contradictions;
  if (!Array.isArray(list)) return [];
  const out: AgreedContradiction[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const { answer_span, evidence_span, why, uuid, agreed } = c as Record<string, unknown>;
    if (agreed !== true) continue;
    if (typeof answer_span !== "string" || typeof evidence_span !== "string") continue;
    out.push({
      answer: answer_span,
      evidence: evidence_span,
      why: typeof why === "string" ? why : "",
      uuid: typeof uuid === "string" ? uuid : null,
    });
  }
  return out;
}

/**
 * Withholds the Sources ✓ on any document an agreed contradiction is sourced
 * to. Returns the same object when nothing collides, so the common case (no
 * contradictions — most turns) allocates nothing.
 *
 * Only `backed` is dropped. `disputed` means the two lanes AGREE and the chip
 * should keep saying so; `unbacked` asserts no support, so it is not in
 * conflict with a dispute and stays. Narrowing this to the green check is
 * deliberate — it is the only status that actively contradicts the dispute
 * printed directly above it.
 *
 * Dropping rather than promoting to `disputed`: CitationMark.claims carries
 * the citation lane's own per-claim verdicts, which on a collision read
 * "supports". A `disputed` badge over a supports list would relocate the
 * contradiction instead of resolving it. Withholding is also what
 * aggregateMarks already does whenever a doc's evidence is not conclusive.
 *
 * A contradiction's uuid is resolved heuristically (verifier.ts: the nearest
 * id field preceding the matched span inside its evidence entry), so it can be
 * wrong. The failure that buys is a ✓ withheld from a document that deserved
 * one — never a warning shown on a document that did not.
 */
export function withoutDisputedMarks(
  marks: Record<string, CitationMark>,
  contradictions: AgreedContradiction[],
): Record<string, CitationMark> {
  const disputed = new Set(contradictions.map((c) => c.uuid).filter((u): u is string => u !== null));
  if (disputed.size === 0) return marks;
  const collides = Object.entries(marks).filter(([uuid, m]) => m.status === "backed" && disputed.has(uuid));
  if (collides.length === 0) return marks;
  const out = { ...marks };
  for (const [uuid] of collides) delete out[uuid];
  return out;
}
