import type { ChatEvent } from "./api";

// Counts a "round" for each contiguous batch of tool calls. A later tool
// round may begin after only tool results + status events (no answer token),
// so a batch closes when every pending tool_call has received its
// tool_result; an answer token, `clear` or `done` closes it outright. One
// tracker per turn.
export function createToolRoundTracker() {
  let pendingToolResults = 0;
  return {
    /** Observe `ev`; true when it is the first tool_call of a new round. */
    opensRound(ev: ChatEvent): boolean {
      if (ev.type === "tool_call") return pendingToolResults++ === 0;
      if (ev.type === "tool_result") pendingToolResults = Math.max(0, pendingToolResults - 1);
      else if (ev.type === "token" || ev.type === "done" || ev.type === "clear") pendingToolResults = 0;
      return false;
    },
  };
}
