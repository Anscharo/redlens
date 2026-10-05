import { describe, expect, it } from "vitest";
import { MESSAGE_EVENT_HANDLERS, applyEvent } from "./applyEvent";
import type { ChatMsg } from "./chatTypes";

const msg: ChatMsg = { role: "assistant", content: "", draft: "", generated: false, trace: [], rounds: 0, sources: [], done: false };

describe("MESSAGE_EVENT_HANDLERS", () => {
  it("has no handler for the hook-level events, which pass the message through unchanged", () => {
    expect(MESSAGE_EVENT_HANDLERS.meta).toBeUndefined();
    expect(MESSAGE_EVENT_HANDLERS.error).toBeUndefined();
    expect(applyEvent(msg, { type: "meta", conversationId: "c" })).toBe(msg);
    expect(applyEvent(msg, { type: "error", message: "x" })).toBe(msg);
  });
  it("covers every message-level event type", () => {
    expect(Object.keys(MESSAGE_EVENT_HANDLERS).sort()).toEqual(
      [
        "answer_coverage", "answer_final", "citation_marks", "clear", "done", "export", "facts", "paragraph_check",
        "paragraph_refute", "reasoning", "status", "token", "tool_call", "tool_result", "verify_result",
      ].sort(),
    );
  });
});
