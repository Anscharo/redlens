// chat-history.ts: the replayed-conversation window (recent verbatim, old
// truncated to lead paragraph, hard budget drops oldest).
import { describe, it, expect } from "bun:test";
import { windowHistory } from "./chat-history.ts";

const msg = (role: string, content: string) => ({ role, content });

describe("windowHistory", () => {
  it("passes a short conversation through unchanged", () => {
    const h = [msg("user", "hi"), msg("assistant", "hello"), msg("user", "what is X?")];
    expect(windowHistory(h)).toEqual(h);
  });

  it("drops empty messages", () => {
    const h = [msg("user", "q"), msg("assistant", "  "), msg("user", "q2")];
    expect(windowHistory(h)).toEqual([msg("user", "q"), msg("user", "q2")]);
  });

  it("keeps recent messages verbatim and truncates older ones to their lead paragraph", () => {
    const oldAnswer = "Lead conclusion.\n\nLong supporting detail that should not survive windowing.";
    const h = [msg("user", "old q"), msg("assistant", oldAnswer), msg("user", "new q"), msg("assistant", "new a")];
    const out = windowHistory(h, { keepRecent: 2 });
    expect(out[1].content).toBe("Lead conclusion.\n…[earlier message truncated]");
    expect(out[2].content).toBe("new q");
    expect(out[3].content).toBe("new a");
  });

  it("caps an old message with no paragraph break at oldMaxChars", () => {
    const h = [msg("assistant", "x".repeat(500)), msg("user", "new"), msg("assistant", "a")];
    const out = windowHistory(h, { keepRecent: 2, oldMaxChars: 100 });
    expect(out[0].content).toBe("x".repeat(100) + "\n…[earlier message truncated]");
  });

  it("does not append a marker when the old message already fits", () => {
    const h = [msg("assistant", "short"), msg("user", "new"), msg("assistant", "a")];
    expect(windowHistory(h, { keepRecent: 2 })[0].content).toBe("short");
  });

  it("drops the oldest messages once the budget is spent", () => {
    const h = [msg("user", "a".repeat(300)), msg("assistant", "b".repeat(300)), msg("user", "c".repeat(300))];
    const out = windowHistory(h, { keepRecent: 8, budgetChars: 650 });
    expect(out.map((m) => m.content[0])).toEqual(["b", "c"]);
  });

  it("always keeps the newest message even when it alone exceeds the budget", () => {
    const h = [msg("user", "old"), msg("user", "n".repeat(5000))];
    const out = windowHistory(h, { budgetChars: 100 });
    expect(out.length).toBe(1);
    expect(out[0].content.length).toBe(5000);
  });
});
