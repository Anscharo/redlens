// chat-history.ts: the replayed-conversation window (recent verbatim, old
// truncated to lead paragraph, hard budget drops oldest).
import { describe, it, expect } from "bun:test";
import { windowHistory } from "./chat-history.ts";

const msg = (role: string, content: string) => ({ role, content });
const TRUNCATION_MARK = "\n…[earlier message truncated]";

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

  it("keeps real prose (not just the heading) for a heading-led answer", () => {
    const oldAnswer =
      "### Prime Agents vs Aligned Delegates\n\n" +
      "A Prime Agent is a strategic product-builder [Doc](/atlas/aaa). An Aligned Delegate controls delegated voting power [Doc2](/atlas/bbb).\n\n" +
      "Further detail with three more citations…";
    const h = [msg("user", "old q"), msg("assistant", oldAnswer), msg("user", "new q"), msg("assistant", "new a")];
    const out = windowHistory(h, { keepRecent: 2 });
    // The heading survives for topic context, but so does the substantive
    // paragraph with its citations — not just the title.
    expect(out[1].content).toContain("### Prime Agents vs Aligned Delegates");
    expect(out[1].content).toContain("A Prime Agent is a strategic product-builder [Doc](/atlas/aaa)");
    expect(out[1].content).toContain("[Doc2](/atlas/bbb)");
    expect(out[1].content.endsWith(TRUNCATION_MARK)).toBe(true);
    // The trailing detail paragraph is beyond the lead paragraph and must not survive.
    expect(out[1].content).not.toContain("Further detail");
  });

  it("skips past multiple stacked leading headings to reach real prose", () => {
    const oldAnswer =
      "### Heading One\n\n#### Subheading Two\n\nActual prose paragraph with the answer [Doc](/atlas/ccc).\n\nMore trailing detail.";
    const h = [msg("user", "old q"), msg("assistant", oldAnswer), msg("user", "new q"), msg("assistant", "new a")];
    const out = windowHistory(h, { keepRecent: 2 });
    expect(out[1].content).toContain("### Heading One");
    expect(out[1].content).toContain("#### Subheading Two");
    expect(out[1].content).toContain("Actual prose paragraph with the answer [Doc](/atlas/ccc).");
    expect(out[1].content).not.toContain("More trailing detail");
    expect(out[1].content.endsWith(TRUNCATION_MARK)).toBe(true);
  });

  it("does not regress plain (no-heading) old messages", () => {
    const oldAnswer = "Lead conclusion carrying the answer [Doc](/atlas/ddd).\n\nSupporting detail that should not survive.";
    const h = [msg("user", "old q"), msg("assistant", oldAnswer), msg("user", "new q"), msg("assistant", "new a")];
    const out = windowHistory(h, { keepRecent: 2 });
    expect(out[1].content).toBe("Lead conclusion carrying the answer [Doc](/atlas/ddd).\n…[earlier message truncated]");
  });

  it("degrades gracefully when the old message is only a heading", () => {
    const h = [msg("user", "old q"), msg("assistant", "### Just A Heading, No Body"), msg("user", "new q"), msg("assistant", "new a")];
    const out = windowHistory(h, { keepRecent: 2 });
    // No paragraph break to find substance beyond — returned unchanged, no
    // spurious truncation marker, no crash.
    expect(out[1].content).toBe("### Just A Heading, No Body");
  });

  it("degrades gracefully when a heading-only old message exceeds oldMaxChars", () => {
    const longHeading = "### " + "x".repeat(500);
    const h = [msg("user", "old q"), msg("assistant", longHeading), msg("user", "new q"), msg("assistant", "new a")];
    const out = windowHistory(h, { keepRecent: 2, oldMaxChars: 100 });
    expect(out[1].content).toBe(longHeading.slice(0, 100) + "\n…[earlier message truncated]");
  });
});
