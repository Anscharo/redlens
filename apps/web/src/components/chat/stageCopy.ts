import type { TraceRow } from "./chatTypes";

// docs/chat-system.md §8 user-facing stage copy. Unknown stages
// (forward-compat with a server that adds one before the client updates)
// fall back to a capitalized raw label instead of disappearing. Every turn
// runs the same stage vocabulary (see api.ts's `Stage` type). Two tenses per
// stage: `active` while it's the running row, `done` once a later stage (or
// the turn ending) supersedes it — a finished step reads as something that
// happened, not something still happening.
const STAGE_LABEL: Record<string, { active: string; done: string }> = {
  recalling: { active: "Recalling context", done: "Recalled context" },
  querying: { active: "Looking for evidence", done: "Looked for evidence" },
  comparing: { active: "Comparing results", done: "Compared results" },
  synthesizing: { active: "Synthesizing", done: "Synthesized" },
  checking: { active: "Verifying content", done: "Verified content" },
};

export function stageLabel(stage: string, active: boolean): string {
  const known = STAGE_LABEL[stage];
  if (known) return active ? known.active : known.done;
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

// A done row reads in the simple past, so a trailing "still working"
// ellipsis on its detail line would read as running under a finished step.
// Display-only — the logged string itself is untouched.
export function stripTrailingEllipsis(detail: string): string {
  return detail.replace(/\s*(?:\.{3}|…)$/, "");
}

// The collapsed checklist's one-line summary (shown only for a turn that
// mounts already finished). Fixed phrases, never counts: "looked up 2
// things" and "recalled 1 thing" invited the reader to go looking for the
// items, and what was recalled or looked up is context the model reasons
// over, not a deliverable. Recalled (facts) and looked-up (tool calls) are
// still different claims, so the phrase names whichever happened.
export function traceHeadline(trace: TraceRow[]): string {
  const facts = trace.some((t) => t.kind === "fact");
  const tools = trace.some((t) => t.kind !== "fact");
  if (facts && tools) return "recall, atlas lookups and reasoning";
  if (facts) return "recall and reasoning";
  if (tools) return "atlas lookups and reasoning";
  return "reasoning";
}
