// The persisted row for one screened paragraph call — folded into
// `Verdict.paragraphs.screen` by paragraph-merge.ts, so it lands in
// message_checks.verdict with the rest of the audit and needs no new table or
// orchestrator plumbing. Compact on purpose: per-statement probabilities (so a
// threshold can be re-fitted offline without a re-run) and the top statement's
// text only when flagged (for adjudication), never the evidence.
import type { ParagraphRefute } from "./paragraph-refute.ts";

export interface ScreenRecord {
  index: number;
  mode: "shadow" | "gate";
  /**
   * judged — Jev answered; failed — null (timeout/transport/malformed); unfit — over budget, not sent;
   * empty — no statement to judge; pending — shadow screen still running at settle (never waited for).
   */
  status: "judged" | "failed" | "unfit" | "empty" | "pending";
  /** Max P(contradicted), null unless judged. */
  p: number | null;
  /** P(contradicted) per statement, 2 dp. */
  ps: number[];
  flagged: boolean;
  /** The highest-P statement, ≤200 chars, only when flagged. */
  top: string | null;
  estTokens: number | null;
  /** Billed input tokens — against estTokens, the budget estimate's calibration. */
  inputTokens: number | null;
  ms: number | null;
  costUsd: number | null;
  /** What gemma did on the SAME call: shadow always runs it; gate skips it on a clean screen. */
  gemma: { ran: boolean; parsed: boolean; timedOut: boolean; candidates: number };
}

export function screenRecordOf(r: ParagraphRefute): ScreenRecord | null {
  if (!r.screen) return null;
  const s = r.screen.result;
  const status: ScreenRecord["status"] = r.screen.pending ? "pending" : !s ? "failed" : !s.fits ? "unfit" : s.statements.length === 0 ? "empty" : "judged";
  const judged = status === "judged";
  const top = judged && s!.flagged ? [...s!.statements].sort((a, b) => b.p - a.p)[0].text.slice(0, 200) : null;
  return {
    index: r.index,
    mode: r.screen.mode,
    status,
    p: judged ? Number(s!.maxContradicted.toFixed(3)) : null,
    ps: judged ? s!.statements.map((x) => Number(x.p.toFixed(2))) : [],
    flagged: judged && s!.flagged,
    top,
    estTokens: s?.estTokens ?? null,
    inputTokens: s?.inputTokens ?? null,
    ms: judged ? s!.latencyMs : null,
    costUsd: s?.costUsd ?? null,
    gemma: { ran: !r.screened, parsed: r.parsed, timedOut: r.timedOut, candidates: r.contradictions.length },
  };
}
