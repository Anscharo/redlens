import type { TraceRow } from "./chatTypes";

// docs/chat-system.md §8 stage copy, in running and finished tenses. An unknown
// stage falls back to its capitalized raw label.
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

// A trailing ellipsis would read as still running under a finished step.
export function stripTrailingEllipsis(detail: string): string {
  return detail.replace(/\s*(?:\.{3}|…)$/, "");
}

// Fixed phrases, never counts: a count invites the reader to look for items
// that are context, not deliverables.
export function traceHeadline(trace: TraceRow[]): string {
  const facts = trace.some((t) => t.kind === "fact");
  const tools = trace.some((t) => t.kind !== "fact");
  if (facts && tools) return "recall, atlas lookups and reasoning";
  if (facts) return "recall and reasoning";
  if (tools) return "atlas lookups and reasoning";
  return "reasoning";
}
