import { describe, expect, it } from "bun:test";
import {
  clearContextOverflow,
  isContextOverflowError,
  noteContextOverflow,
  shouldForceCompaction,
} from "./context-overflow.ts";

const ON = { forcedThisTurn: false, compactionEnabled: true };

describe("isContextOverflowError", () => {
  it("recognizes the wordings providers actually return", () => {
    // OpenAI, via the SDK's nested error body.
    expect(isContextOverflowError({
      status: 400,
      error: { code: "context_length_exceeded", message: "This model's maximum context length is 128000 tokens." },
    })).toBe(true);
    // Anthropic, passed through by OpenRouter.
    expect(isContextOverflowError(new Error("prompt is too long: 214000 tokens > 200000 maximum"))).toBe(true);
    // OpenRouter's own endpoint message.
    expect(isContextOverflowError(new Error("This endpoint's maximum context length is 131072 tokens. However, you requested about 140000 tokens."))).toBe(true);
    expect(isContextOverflowError(new Error("Please reduce the length of the messages."))).toBe(true);
    expect(isContextOverflowError("Request too large for gpt-5.6-luna")).toBe(true);
  });

  it("leaves every other failure alone", () => {
    expect(isContextOverflowError(new Error("llm call timeout"))).toBe(false);
    expect(isContextOverflowError(new Error("rate limit exceeded"))).toBe(false);
    // An OUTPUT-token complaint is not a thread that needs compacting.
    expect(isContextOverflowError(new Error("max_tokens is too large: 200000 > 32768"))).toBe(false);
    expect(isContextOverflowError(new Error("Please reduce the number of completions"))).toBe(false);
    expect(isContextOverflowError({ error: "upstream provider is down" })).toBe(false);
    expect(isContextOverflowError(null)).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
    expect(isContextOverflowError({})).toBe(false);
  });
});

describe("the overflow state machine", () => {
  it("arms one forced compaction, then stands down", () => {
    const conv = "conv-overflow-one-compaction";
    expect(shouldForceCompaction(conv)).toBe(false);

    // First rejection: the next turn should compact, and we say so.
    const first = noteContextOverflow(conv, ON);
    expect(first).toContain("condensed first");
    expect(shouldForceCompaction(conv)).toBe(true);

    // That compaction ran and the provider rejected the turn anyway.
    const second = noteContextOverflow(conv, { ...ON, forcedThisTurn: true });
    expect(second).toContain("a new chat");
    expect(shouldForceCompaction(conv)).toBe(false);

    // Every later message: no forced summary call, and no promise of one.
    expect(noteContextOverflow(conv, ON)).toContain("a new chat");
    expect(shouldForceCompaction(conv)).toBe(false);
  });

  it("promises nothing when compaction is switched off", () => {
    const conv = "conv-overflow-no-compaction";
    clearContextOverflow(conv);
    const message = noteContextOverflow(conv, { forcedThisTurn: false, compactionEnabled: false });
    expect(message).toContain("a new chat");
    expect(message).not.toContain("condensed first");
  });

  it("a landed compaction clears both verdicts", () => {
    const conv = "conv-overflow-cleared";
    noteContextOverflow(conv, { ...ON, forcedThisTurn: true });
    clearContextOverflow(conv);
    expect(shouldForceCompaction(conv)).toBe(false);
    // Back to a clean slate: the next rejection arms a compaction again.
    expect(noteContextOverflow(conv, ON)).toContain("condensed first");
    expect(shouldForceCompaction(conv)).toBe(true);
  });

  it("does not leak across conversations and expires after a day", () => {
    const conv = "conv-overflow-expiry";
    noteContextOverflow(conv, ON, 0);
    expect(shouldForceCompaction("conv-overflow-other", 0)).toBe(false);
    expect(shouldForceCompaction(conv, 23 * 60 * 60_000)).toBe(true);
    expect(shouldForceCompaction(conv, 25 * 60 * 60_000)).toBe(false);
  });

  it("flows into the client's fixed suffix: no trailing period, no retry advice of its own", () => {
    // ErrorNote renders `{message} — send another message to try again.`
    const conv = "conv-overflow-copy";
    clearContextOverflow(conv);
    for (const message of [
      noteContextOverflow(conv, ON),
      noteContextOverflow(conv, { ...ON, forcedThisTurn: true }),
    ]) {
      expect(message.endsWith(".")).toBe(false);
      expect(message).not.toContain("try again");
    }
  });
});
