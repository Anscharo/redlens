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
        citationMarks: null,
      },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.trace).toEqual([{ name: "atlas_search", args: { q: "foo" }, ok: true, bytes: 128, round: 0 }]);
    expect(msg.sources).toEqual([{ name: "atlas_search", args: { q: "foo" }, ok: true, bytes: 128 }]);
  });

  it("maps a null toolCalls to an empty trace and sources", () => {
    const rows: StoredMessage[] = [
      { role: "user", content: "hi", createdAt: "2026-01-01T00:00:00.000Z", toolCalls: null, citationMarks: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.trace).toEqual([]);
    expect(msg.sources).toEqual([]);
  });

  it("marks every restored message done, with rounds 0 and no verify badge", () => {
    const rows: StoredMessage[] = [
      { role: "user", content: "hi", createdAt: "t", toolCalls: null, citationMarks: null },
      { role: "assistant", content: "hello", createdAt: "t", toolCalls: null, citationMarks: null },
    ];
    const msgs = toChatMsgs(rows);
    for (const m of msgs) {
      expect(m.done).toBe(true);
      expect(m.rounds).toBe(0);
      expect(m.verify).toBeUndefined();
      // Live-only post-answer checks, like the badge — citationMarks is
      // asserted separately below since (unlike these) it DOES persist.
      expect(m.answerCoverage).toBeUndefined();
    }
  });

  it("restores as the reveal state: empty draft, generated true", () => {
    const rows: StoredMessage[] = [
      { role: "assistant", content: "hello", createdAt: "t", toolCalls: null, citationMarks: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.draft).toBe("");
    expect(msg.generated).toBe(true);
  });

  it("preserves role/content and produces one ChatMsg per row, in order", () => {
    const rows: StoredMessage[] = [
      { role: "user", content: "first", createdAt: "t1", toolCalls: null, citationMarks: null },
      { role: "assistant", content: "second", createdAt: "t2", toolCalls: null, citationMarks: null },
    ];
    const msgs = toChatMsgs(rows);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "first"],
      ["assistant", "second"],
    ]);
  });

  it("restores citationMarks from a persisted row", () => {
    const rows: StoredMessage[] = [
      {
        role: "assistant",
        content: "The threshold is 7 signers.",
        createdAt: "t",
        toolCalls: null,
        citationMarks: {
          "11111111-1111-1111-1111-111111111111": {
            status: "backed",
            claims: [{ claim: "The threshold is 7 signers.", verdict: "supports" }],
          },
        },
      },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.citationMarks).toEqual({
      "11111111-1111-1111-1111-111111111111": {
        status: "backed",
        claims: [{ claim: "The threshold is 7 signers.", verdict: "supports" }],
      },
    });
  });

  it("maps a null citationMarks (no row, or nothing survived aggregation) to undefined", () => {
    const rows: StoredMessage[] = [
      { role: "assistant", content: "hello", createdAt: "t", toolCalls: null, citationMarks: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.citationMarks).toBeUndefined();
  });
});
