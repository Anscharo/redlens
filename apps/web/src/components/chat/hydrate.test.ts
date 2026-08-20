import { describe, it, expect } from "vitest";
import { toChatMsgs } from "./hydrate";
import type { StoredMessage } from "../../lib/conversationsApi";

describe("toChatMsgs", () => {
  it("maps tool_calls into a full trace + sources", () => {
    const rows: StoredMessage[] = [
      {
        role: "assistant",
        content: "The answer is 42.",
        createdAt: "2026-01-01T00:00:00.000Z",
        toolCalls: [{ name: "atlas_search", args: { q: "foo" }, ok: true, bytes: 128 }],
      },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.trace).toEqual([{ name: "atlas_search", args: { q: "foo" }, ok: true, bytes: 128 }]);
    expect(msg.sources).toEqual([{ name: "atlas_search", args: { q: "foo" }, ok: true, bytes: 128 }]);
  });

  it("maps a null toolCalls to an empty trace and sources", () => {
    const rows: StoredMessage[] = [
      { role: "user", content: "hi", createdAt: "2026-01-01T00:00:00.000Z", toolCalls: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.trace).toEqual([]);
    expect(msg.sources).toEqual([]);
  });

  it("marks every restored message done, with rounds 0 and no verify badge", () => {
    const rows: StoredMessage[] = [
      { role: "user", content: "hi", createdAt: "t", toolCalls: null },
      { role: "assistant", content: "hello", createdAt: "t", toolCalls: null },
    ];
    const msgs = toChatMsgs(rows);
    for (const m of msgs) {
      expect(m.done).toBe(true);
      expect(m.rounds).toBe(0);
      expect(m.verify).toBeUndefined();
    }
  });

  it("preserves role/content and produces one ChatMsg per row, in order", () => {
    const rows: StoredMessage[] = [
      { role: "user", content: "first", createdAt: "t1", toolCalls: null },
      { role: "assistant", content: "second", createdAt: "t2", toolCalls: null },
    ];
    const msgs = toChatMsgs(rows);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "first"],
      ["assistant", "second"],
    ]);
  });
});
