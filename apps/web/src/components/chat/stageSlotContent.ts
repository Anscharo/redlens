import { hasFindings } from "./VerifyFindings";
import type { ChatMsg, ParagraphCheck, StageLogEntry, SupersededDraft, TraceRow, VerifyState } from "./chatTypes";

// WHAT a stage row discloses when the reader clicks it open, as data. The
// choice lives here rather than in the component for two reasons: `StageList`
// has to know whether a row has anything to disclose at all (a row with an
// empty slot renders as plain text, not as a disclosure button) without
// rendering it first, and the per-stage rules below — which round's rows,
// which synthesizing pass owns the reasoning, which row the paragraph checks
// belong under — are the part worth testing without React.
export type StageSlotContent =
  | { kind: "trace"; rows: TraceRow[] }
  | { kind: "synthesis"; reasoning?: string; drafts: SupersededDraft[]; draft?: string }
  | { kind: "checks"; checks: ParagraphCheck[]; findings?: VerifyState };

function traceSlot(rows: TraceRow[]): StageSlotContent | null {
  return rows.length ? { kind: "trace", rows } : null;
}

// The synthesizing stage can repeat (a turn may synthesize, search again, and
// synthesize once more) — reasoning belongs to the first occurrence, and the
// live draft only trails the last one, so neither is duplicated across rounds.
function synthesisSlot(msg: ChatMsg, entry: StageLogEntry): StageSlotContent | null {
  const passes = (msg.stageLog ?? []).filter((s) => s.stage === "synthesizing");
  const reasoning = passes[0]?.at === entry.at ? msg.reasoning : undefined;
  const drafts = (msg.superseded ?? []).filter((d) => d.round === entry.round);
  const isLast = passes[passes.length - 1]?.at === entry.at;
  const draft = isLast && !msg.generated ? msg.draft : undefined;
  if (!reasoning && !drafts.length && draft == null) return null;
  return { kind: "synthesis", reasoning, drafts, draft };
}

// Per-paragraph checks are verification, not writing — they belong to the
// Verifying row (model configured) or, on a deterministic-only turn where no
// Verifying row ever appears, to the Comparing row. Never to Synthesizing:
// the checks run WHILE the draft streams, but what they report is about the
// checking of the answer, and the reader looks for it under that step.
function checksSlot(msg: ChatMsg, stage: "comparing" | "checking"): StageSlotContent | null {
  const verifying = (msg.stageLog ?? []).some((s) => s.stage === "checking");
  const checks = stage === "comparing" && verifying ? [] : (msg.paragraphChecks ?? []);
  // Whole-answer findings only once the verdict is in and there is something
  // to disclose — a clean verdict adds nothing beyond the paragraph summary.
  const verdict = stage === "checking" && msg.verify && msg.verify.status !== "checking" ? msg.verify : undefined;
  const findings = verdict && hasFindings(verdict) ? verdict : undefined;
  if (!checks.length && !findings) return null;
  return { kind: "checks", checks, findings };
}

// The content shown under a stage row's label once that row is clicked open —
// what that stage actually did or produced, not just that it ran. `null` for a
// stage with nothing to show, including any stage this client doesn't know.
export function stageSlotContent(msg: ChatMsg, entry: StageLogEntry): StageSlotContent | null {
  switch (entry.stage) {
    // Facts run before round 1 (not per-round like tool calls), so recalling
    // isn't filtered by `entry.round` the way querying is.
    case "recalling":
      return traceSlot(msg.trace.filter((t) => t.kind === "fact"));
    case "querying":
      return traceSlot(msg.trace.filter((t) => t.kind !== "fact" && t.round === entry.round));
    case "synthesizing":
      return synthesisSlot(msg, entry);
    case "comparing":
    case "checking":
      return checksSlot(msg, entry.stage);
    default:
      return null;
  }
}
