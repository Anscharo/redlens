import { describe, expect, it } from "vitest";
import { createToolRoundTracker } from "./toolRounds";
import type { ChatEvent } from "./api";

const call: ChatEvent = { type: "tool_call", name: "t", args: {} };
const result: ChatEvent = { type: "tool_result", name: "t", ok: true, bytes: 1 };

describe("createToolRoundTracker", () => {
  it("opens one round per contiguous batch, closing when every result is in", () => {
    const t = createToolRoundTracker();
    expect([call, call, result, result, call].map((ev) => t.opensRound(ev))).toEqual([true, false, false, false, true]);
  });
  it("keeps a batch open while any result is still pending", () => {
    const t = createToolRoundTracker();
    expect([call, call, result, call].map((ev) => t.opensRound(ev))).toEqual([true, false, false, false]);
  });
  it("an answer token closes the batch outright", () => {
    const t = createToolRoundTracker();
    t.opensRound(call);
    t.opensRound({ type: "token", text: "x" });
    expect(t.opensRound(call)).toBe(true);
  });
});
